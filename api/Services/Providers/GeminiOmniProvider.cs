using System.Text.Json;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services.Providers;

/// <summary>
/// Google Gemini Omni Flash (video with native audio, 3–15 s) through the Gemini API's Interactions endpoint.
/// It replaced Veo, which Google shut down on 22 Oct 2026. One call: POST /v1beta/interactions returns the
/// finished video — as a Files API link we then wait on, or inline for short clips.
/// Model via AI:Google:VideoModel. Only attempted when AI:Google:ApiKey is configured.
/// </summary>
public class GeminiOmniProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration, MediaStore mediaStore) : IVideoModelProvider
{
    private const string DefaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private static readonly TimeSpan CallTimeout = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan FileTimeout = TimeSpan.FromMinutes(3);

    public string Name => "gemini-omni-flash";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:Google:ApiKey"]);

    private string ModelId => configuration["AI:Google:VideoModel"] is { Length: > 0 } m ? m : "gemini-omni-1.2-flash";
    private string BaseUrl => (configuration["AI:Google:BaseUrl"] is { Length: > 0 } b ? b : DefaultBaseUrl).TrimEnd('/');

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var apiKey = configuration["AI:Google:ApiKey"]!;
        var aspectRatio = spec.AspectRatio == "16:9" ? "16:9" : "9:16"; // the only two it renders
        var duration = Math.Clamp(spec.DurationSeconds ?? 10, 3, 15);
        // The video is rendered inside this one call, so it needs far longer than the default 100 s.
        var client = httpClientFactory.CreateClient();
        client.Timeout = CallTimeout;

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/interactions");
        request.Headers.Add("x-goog-api-key", apiKey);
        request.Content = JsonContent.Create(new
        {
            model = ModelId,
            input = spec.Prompt,
            response_format = new
            {
                type = "video",
                aspect_ratio = aspectRatio,
                resolution = spec.Quality == "high" ? "1080p" : "720p",
                duration = $"{duration}s",
                delivery = "uri", // a file link instead of megabytes of base64 in the response
            },
        });

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Gemini Omni answered {(int)response.StatusCode}: {(detail.Length > 400 ? detail[..400] : detail)}", null, response.StatusCode);
        }

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var root = json.RootElement;
        if (root.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String
            && !string.Equals(status.GetString(), "completed", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Gemini Omni did not finish the video (status: {status.GetString()}).");

        var video = FindVideoPart(root)
            ?? throw new InvalidOperationException("Gemini Omni returned no video (it may have been blocked by the safety filter).");

        if (video.TryGetProperty("uri", out var uriProp) && uriProp.GetString() is { Length: > 0 } uri)
            return new GeneratedMedia { Url = await WaitForFileAsync(client, uri, apiKey, cancellationToken), Model = Name, DurationSeconds = duration };

        if (video.TryGetProperty("data", out var data) && data.GetString() is { Length: > 0 } base64)
        {
            var url = await mediaStore.SaveAsync(Convert.FromBase64String(base64), ".mp4", MediaStore.GeneratedFolder, cancellationToken);
            return new GeneratedMedia { Url = url, Model = Name, DurationSeconds = duration };
        }

        throw new InvalidOperationException("Gemini Omni returned a video part without a link or data.");
    }

    /// <summary>The video sits in a model_output step as a content part of type "video"; search the whole answer for it.</summary>
    private static JsonElement? FindVideoPart(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                if (element.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "video"
                    && (element.TryGetProperty("uri", out _) || element.TryGetProperty("data", out _)))
                    return element;
                foreach (var property in element.EnumerateObject())
                    if (FindVideoPart(property.Value) is { } inObject) return inObject;
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                    if (FindVideoPart(item) is { } inArray) return inArray;
                break;
        }
        return null;
    }

    /// <summary>
    /// Waits until the Files API marks the video ACTIVE and returns its download link. The link needs our key,
    /// so the router copies the file into our own storage before the browser sees it.
    /// </summary>
    private async Task<string> WaitForFileAsync(HttpClient client, string uri, string apiKey, CancellationToken ct)
    {
        var fileId = uri.TrimEnd('/').Split('/').Last().Split('?')[0].Split(':')[0];
        var deadline = DateTimeOffset.UtcNow + FileTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            using var poll = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}/files/{fileId}");
            poll.Headers.Add("x-goog-api-key", apiKey);
            using var pollResponse = await ProviderHttp.TryPollAsync(client, poll, ct);
            if (pollResponse is not null)
            {
                pollResponse.EnsureSuccessStatusCode();
                using var file = JsonDocument.Parse(await pollResponse.Content.ReadAsStringAsync(ct));
                var state = file.RootElement.TryGetProperty("state", out var s) ? s.GetString() : null;
                if (state == "FAILED") throw new InvalidOperationException("Gemini Omni could not prepare the video file.");
                if (state is null or "ACTIVE") return $"{BaseUrl}/files/{fileId}:download?alt=media";
            }
            await Task.Delay(PollInterval, ct);
        }
        throw new TimeoutException("The Gemini Omni video file was not ready in time.");
    }
}
