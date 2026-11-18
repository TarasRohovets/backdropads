using System.Net.Http.Headers;
using System.Text.Json;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services.Providers;

/// <summary>
/// fal.ai queue API — one key (AI:Fal:ApiKey) for the long tail of models we don't integrate directly
/// (Seedream, FLUX.2, Wan). POST https://queue.fal.run/{app} → poll status_url → GET response_url.
/// App paths live in AI:Fal:Apps:{modelId} so they can be swapped without a deploy.
/// </summary>
public abstract class FalProviderBase(IHttpClientFactory httpClientFactory, IConfiguration configuration)
{
    private const string QueueUrl = "https://queue.fal.run";
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);

    public abstract string Name { get; }
    protected abstract string DefaultApp { get; }
    protected virtual TimeSpan PollTimeout => TimeSpan.FromMinutes(3);

    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:Fal:ApiKey"]);

    protected string App => configuration[$"AI:Fal:Apps:{Name}"] is { Length: > 0 } app ? app : DefaultApp;

    /// <summary>Submits the job, waits for it and returns the result JSON.</summary>
    protected async Task<JsonDocument> RunAsync(object input, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient();
        var key = configuration["AI:Fal:ApiKey"];

        using var submit = new HttpRequestMessage(HttpMethod.Post, $"{QueueUrl}/{App}");
        submit.Headers.Authorization = new AuthenticationHeaderValue("Key", key);
        submit.Content = JsonContent.Create(input);
        using var submitResponse = await client.SendAsync(submit, cancellationToken);
        submitResponse.EnsureSuccessStatusCode();

        string statusUrl, responseUrl;
        using (var json = JsonDocument.Parse(await submitResponse.Content.ReadAsStringAsync(cancellationToken)))
        {
            statusUrl = json.RootElement.GetProperty("status_url").GetString()!;
            responseUrl = json.RootElement.GetProperty("response_url").GetString()!;
        }

        var deadline = DateTimeOffset.UtcNow + PollTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(PollInterval, cancellationToken);
            using var poll = new HttpRequestMessage(HttpMethod.Get, statusUrl);
            poll.Headers.Authorization = new AuthenticationHeaderValue("Key", key);
            using var pollResponse = await ProviderHttp.TryPollAsync(client, poll, cancellationToken);
            if (pollResponse is null) continue; // temporary error — the job is still running
            pollResponse.EnsureSuccessStatusCode();

            using var json = JsonDocument.Parse(await pollResponse.Content.ReadAsStringAsync(cancellationToken));
            var status = json.RootElement.GetProperty("status").GetString();
            if (status == "COMPLETED")
            {
                using var result = new HttpRequestMessage(HttpMethod.Get, responseUrl);
                result.Headers.Authorization = new AuthenticationHeaderValue("Key", key);
                using var resultResponse = await ProviderHttp.TryPollAsync(client, result, cancellationToken);
                if (resultResponse is null) continue; // temporary error — fetch the finished result next tick
                resultResponse.EnsureSuccessStatusCode();
                return JsonDocument.Parse(await resultResponse.Content.ReadAsStringAsync(cancellationToken));
            }
            if (status is "FAILED" or "ERROR")
                throw new InvalidOperationException($"{Name} job failed on fal.");
        }

        throw new TimeoutException($"{Name} did not finish in time.");
    }

    protected static object HighResSize(string aspectRatio) => aspectRatio switch
    {
        "1:1" => new { width = 2048, height = 2048 },
        "16:9" => new { width = 2560, height = 1440 },
        "9:16" => new { width = 1440, height = 2560 },
        "2:3" => new { width = 1664, height = 2496 },
        _ => new { width = 1792, height = 2240 }, // 4:5
    };

    protected static string ImageSize(string aspectRatio) => aspectRatio switch
    {
        "1:1" => "square_hd",
        "16:9" => "landscape_16_9",
        "9:16" => "portrait_16_9",
        _ => "portrait_4_3", // 4:5, 2:3
    };
}

public abstract class FalImageProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration)
    : FalProviderBase(httpClientFactory, configuration), IImageModelProvider
{
    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        using var json = await RunAsync(BuildRequest(spec), cancellationToken);

        var url = json.RootElement.GetProperty("images")[0].GetProperty("url").GetString();
        return new GeneratedMedia { Url = url, Model = Name };
    }

    /// <summary>Standard: fal's size presets (~1MP). High: explicit ~4MP dimensions for the aspect ratio.</summary>
    protected virtual object BuildRequest(MediaSpec spec) => new
    {
        prompt = spec.Prompt,
        image_size = spec.Quality == "high" ? HighResSize(spec.AspectRatio) : ImageSize(spec.AspectRatio),
        num_images = 1,
    };
}

/// <summary>Seedream 5.5 on fal ($0.03 per image, $0.0405 above 2.6 MP).</summary>
public class SeedreamProvider(IHttpClientFactory h, IConfiguration c) : FalImageProvider(h, c)
{
    public override string Name => "seedream";
    protected override string DefaultApp => ModelDefaults.FalSeedream;
}

/// <summary>Seedream 5 Flash on fal — the budget tier ($0.027 per image).</summary>
public class SeedreamFlashProvider(IHttpClientFactory h, IConfiguration c) : FalImageProvider(h, c)
{
    public override string Name => "seedream-flash";
    protected override string DefaultApp => ModelDefaults.FalSeedreamFlash;
}

/// <summary>
/// FLUX 3 on fal ($0.048 per megapixel). Unlike the other image models it takes an aspect ratio and a
/// resolution tier instead of pixel sizes.
/// </summary>
public class FluxProvider(IHttpClientFactory h, IConfiguration c) : FalImageProvider(h, c)
{
    public override string Name => "flux";
    protected override string DefaultApp => ModelDefaults.FalFlux;

    protected override object BuildRequest(MediaSpec spec) => new
    {
        prompt = spec.Prompt,
        aspect_ratio = spec.AspectRatio is "1:1" or "4:5" or "2:3" or "16:9" or "9:16" ? spec.AspectRatio : "4:5",
        resolution = spec.Quality == "high" ? "2k" : "1k",
    };
}

/// <summary>Wan 3.0 text-to-video on fal ($0.10/s 720p, $0.20/s 1080p). Length is a whole number of seconds.</summary>
public class WanProvider(IHttpClientFactory h, IConfiguration c) : FalProviderBase(h, c), IVideoModelProvider
{
    public override string Name => "wan";
    protected override string DefaultApp => ModelDefaults.FalWan;
    protected override TimeSpan PollTimeout => TimeSpan.FromMinutes(8);

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var duration = Math.Clamp(spec.DurationSeconds ?? 10, 5, 15);
        duration = duration >= 13 ? 15 : duration >= 8 ? 10 : 5;
        using var json = await RunAsync(new
        {
            prompt = spec.Prompt,
            aspect_ratio = spec.AspectRatio == "16:9" ? "16:9" : spec.AspectRatio == "1:1" ? "1:1" : "9:16",
            duration,
            resolution = spec.Quality == "high" ? "1080p" : "720p",
        }, cancellationToken);

        var url = json.RootElement.GetProperty("video").GetProperty("url").GetString();
        return new GeneratedMedia { Url = url, Model = Name, DurationSeconds = duration };
    }
}

/// <summary>
/// ByteDance OmniHuman 2 on fal — the UGC/spokesperson pipeline: one photo of a person (or of the
/// product held by one) plus a voiceover becomes a lip-synced talking video. The voiceover is made with
/// OpenAI TTS from the concept's script. Photo and audio go in as data URIs, so no public URL/tunnel is
/// needed. Needs AI:Fal:ApiKey + AI:OpenAI:ApiKey and a reference image in the brief.
/// </summary>
public class OmniHumanProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    SourceImageLoader loader) : FalProviderBase(httpClientFactory, configuration), IVideoModelProvider
{
    private readonly IHttpClientFactory _http = httpClientFactory;
    private readonly IConfiguration _config = configuration;

    public override string Name => "omnihuman";
    protected override string DefaultApp => ModelDefaults.FalOmniHuman;
    protected override TimeSpan PollTimeout => TimeSpan.FromMinutes(10);

    public new bool IsConfigured => base.IsConfigured && !string.IsNullOrWhiteSpace(_config["AI:OpenAI:ApiKey"]);
    bool IVideoModelProvider.IsConfigured => IsConfigured;

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(brief.ReferenceCreativeUrl))
            throw new InvalidOperationException("OmniHuman needs a photo of the person or product.");
        if (string.IsNullOrWhiteSpace(spec.Voiceover))
            throw new InvalidOperationException("OmniHuman needs a voiceover script.");

        var (imageBytes, imageMime) = await loader.LoadAsync(brief.ReferenceCreativeUrl, cancellationToken);
        var audioBytes = await SynthesizeVoiceoverAsync(spec.Voiceover!, brief.Language, cancellationToken);

        using var json = await RunAsync(new
        {
            image_url = $"data:{imageMime};base64,{Convert.ToBase64String(imageBytes)}",
            audio_url = $"data:audio/mpeg;base64,{Convert.ToBase64String(audioBytes)}",
            prompt = spec.Prompt, // OmniHuman 2 picks the resolution itself
        }, cancellationToken);

        var root = json.RootElement;
        var url = root.GetProperty("video").GetProperty("url").GetString();
        int? seconds = root.TryGetProperty("duration", out var d) && d.TryGetDouble(out var s) ? (int)Math.Ceiling(s) : null;
        return new GeneratedMedia { Url = url, Model = Name, DurationSeconds = seconds };
    }

    /// <summary>Voiceover script → mp3 bytes via OpenAI TTS.</summary>
    private async Task<byte[]> SynthesizeVoiceoverAsync(string script, string? language, CancellationToken cancellationToken)
    {
        var client = _http.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/audio/speech");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config["AI:OpenAI:ApiKey"]);
        request.Content = JsonContent.Create(new
        {
            model = _config["AI:OpenAI:TtsModel"] is { Length: > 0 } m ? m : ModelDefaults.OpenAiTts,
            voice = _config["AI:OpenAI:TtsVoice"] is { Length: > 0 } v ? v : "alloy",
            input = script,
            instructions = string.IsNullOrWhiteSpace(language)
                ? "Energetic, natural creator voice for a short social media ad."
                : $"Energetic, natural creator voice for a short social media ad. Speak in {language}.",
        });
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }
}
