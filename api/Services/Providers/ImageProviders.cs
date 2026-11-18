using System.Net.Http.Headers;
using System.Text.Json;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services.Providers;

/// <summary>
/// OpenAI GPT Image Sunburst (the detailed model) — POST https://api.openai.com/v1/images/generations.
/// Top human-preference image model as of Aug 2026. Model overridable via AI:OpenAI:SunburstModel.
/// Only attempted when AI:OpenAI:ApiKey is configured.
/// </summary>
public class GptImageSunburstProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore) : IImageModelProvider
{
    private const string Endpoint = "https://api.openai.com/v1/images/generations";

    public virtual string Name => "gpt-image-sunburst";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:OpenAI:ApiKey"]);

    protected IConfiguration Config => configuration;
    protected virtual string ModelId => configuration["AI:OpenAI:SunburstModel"] is { Length: > 0 } m ? m : ModelDefaults.OpenAiSunburst;

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var model = ModelId;
        // Supported sizes: 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape).
        var size = spec.AspectRatio switch
        {
            "16:9" => "1536x1024",
            "1:1" => "1024x1024",
            _ => "1024x1536", // 4:5, 9:16, 2:3 → portrait
        };

        var client = httpClientFactory.CreateClient();
        // AI:OpenAI:BaseUrl overrides the endpoint (proxies, local capture in tests).
        var endpoint = configuration["AI:OpenAI:BaseUrl"] is { Length: > 0 } b ? $"{b.TrimEnd('/')}/images/generations" : Endpoint;
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["AI:OpenAI:ApiKey"]);
        request.Content = JsonContent.Create(new { model, prompt = spec.Prompt, n = 1, size, quality = spec.Quality == "high" ? "high" : "medium" });

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var first = json.RootElement.GetProperty("data")[0];

        string? url = null;
        if (first.TryGetProperty("b64_json", out var b64) && b64.ValueKind == JsonValueKind.String)
            url = await mediaStore.SaveBase64Async(b64.GetString()!, "png", cancellationToken);
        else if (first.TryGetProperty("url", out var urlProp) && urlProp.ValueKind == JsonValueKind.String)
            url = urlProp.GetString();

        return new GeneratedMedia { Url = url, Model = model };
    }
}

/// <summary>
/// Google Nano Banana 2 through the Gemini API (Imagen line retired Aug 17, 2026) —
/// POST models/{model}:generateContent with image response modality; image arrives as
/// inlineData base64. Model overridable via AI:Google:ImageModel.
/// Only attempted when AI:Google:ApiKey is configured.
/// </summary>
public class NanoBananaProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore) : IImageModelProvider
{
    private const string BaseUrl = "https://generativelanguage.googleapis.com/v1beta";

    public virtual string Name => "nano-banana";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:Google:ApiKey"]);

    protected IConfiguration Config => configuration;
    protected virtual string ModelId => configuration["AI:Google:ImageModel"] is { Length: > 0 } m ? m : ModelDefaults.GoogleImage;

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var model = ModelId;
        var client = httpClientFactory.CreateClient();

        // AI:Google:BaseUrl overrides the endpoint (proxies, local capture in tests).
        var baseUrl = (configuration["AI:Google:BaseUrl"] is { Length: > 0 } b ? b : BaseUrl).TrimEnd('/');
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/models/{model}:generateContent");
        request.Headers.Add("x-goog-api-key", configuration["AI:Google:ApiKey"]);
        request.Content = JsonContent.Create(new
        {
            contents = new[]
            {
                new { parts = new[] { new { text = $"{spec.Prompt}. Aspect ratio {spec.AspectRatio}." } } },
            },
            generationConfig = new
            {
                responseModalities = new[] { "IMAGE" },
                imageConfig = new { aspectRatio = spec.AspectRatio, imageSize = spec.Quality == "high" ? "2K" : "1K" },
            },
        });

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var parts = json.RootElement
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts");

        foreach (var part in parts.EnumerateArray())
        {
            if (part.TryGetProperty("inlineData", out var inline) &&
                inline.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.String)
            {
                var mime = inline.TryGetProperty("mimeType", out var m) ? m.GetString() : "image/png";
                var extension = mime == "image/jpeg" ? "jpg" : "png";
                var url = await mediaStore.SaveBase64Async(data.GetString()!, extension, cancellationToken);
                return new GeneratedMedia { Url = url, Model = model };
            }
        }

        throw new InvalidOperationException($"{model} returned no image data.");
    }
}

/// <summary>
/// Google Nano Banana Pro (Gemini 3 Pro Image) — same Gemini API as Nano Banana 2, higher fidelity.
/// Model overridable via AI:Google:ImageProModel.
/// </summary>
public class NanoBananaProProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    MediaStore mediaStore) : NanoBananaProvider(httpClientFactory, config, mediaStore)
{
    public override string Name => "nano-banana-pro";
    protected override string ModelId => Config["AI:Google:ImageProModel"] is { Length: > 0 } m ? m : ModelDefaults.GoogleImagePro;
}

/// <summary>
/// OpenAI GPT Image Flare (the fast model) — same endpoint and token rates as Sunburst.
/// Model overridable via AI:OpenAI:FlareModel.
/// </summary>
public class GptImageFlareProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    MediaStore mediaStore) : GptImageSunburstProvider(httpClientFactory, config, mediaStore)
{
    public override string Name => "gpt-image-flare";
    protected override string ModelId => Config["AI:OpenAI:FlareModel"] is { Length: > 0 } m ? m : ModelDefaults.OpenAiFlare;
}
