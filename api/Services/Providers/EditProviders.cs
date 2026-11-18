using System.Net.Http.Headers;
using System.Text.Json;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Services.Providers;

/// <summary>An image edit: take an existing creative and apply an instruction, keeping everything else.</summary>
public sealed record EditSpec(
    string? SourceMediaUrl,
    string SourceImageSeed,
    string Instruction,
    string AspectRatio,
    IReadOnlyList<string>? ExtraImageUrls = null,
    // Edit provider to try before the chain (the model the user picked).
    string? PreferredProvider = null,
    // Render at AspectRatio (new ads from photos) instead of keeping the source image's shape (edits).
    bool SetAspectRatio = false)
{
    /// <summary>Main image first, then the extra references, in order.</summary>
    public IReadOnlyList<string> AllImageUrls =>
        [.. new[] { SourceMediaUrl }.Concat(ExtraImageUrls ?? []).Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u!).Distinct()];

    /// <summary>Tells the model how the numbered images relate to the instruction.</summary>
    public string ImagesNote => AllImageUrls.Count > 1
        ? $" You are given {AllImageUrls.Count} images, in order: image 1 is the main one, then image 2" +
          (AllImageUrls.Count > 2 ? $" to image {AllImageUrls.Count}" : "") +
          ". Use every image the way the instructions describe; keep each product exactly as it appears in its photo."
        : "";
}

public interface IImageEditProvider
{
    string Name { get; }
    bool IsConfigured { get; }
    Task<GeneratedMedia> EditAsync(EditSpec spec, CancellationToken cancellationToken = default);
}

/// <summary>
/// Loads the source creative bytes for edit calls: local /media files straight from disk,
/// anything else over HTTP. Mock creatives (no mediaUrl) have no bytes: real providers throw
/// and the chain falls through to mock.
/// </summary>
public class SourceImageLoader(IHttpClientFactory httpClientFactory, MediaStore mediaStore)
{
    public async Task<(byte[] Bytes, string MimeType)> LoadAsync(string? mediaUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(mediaUrl))
            throw new InvalidOperationException("This creative has no real media to edit yet. Generate it first.");

        // Our own media (storage folder or Azure Blob) — read directly, never over HTTP.
        if (mediaStore.IsOwn(mediaUrl) && await mediaStore.TryReadOwnAsync(mediaUrl, cancellationToken) is { } own)
            return own;

        // Remote images (product photos from a store's CDN) are user-supplied: public hosts only,
        // redirects re-checked hop by hop, size capped.
        if (!Uri.TryCreate(mediaUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("That image address isn't a web link.");

        var client = httpClientFactory.CreateClient(ProductImporter.ClientName);
        for (var hop = 0; hop < 4; hop++)
        {
            try { await ProductImporter.EnsurePublicHostAsync(uri, cancellationToken); }
            catch (ProductImportException ex) { throw new InvalidOperationException(ex.Message); }

            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
            {
                uri = new Uri(uri, location);
                if (uri.Scheme is not ("http" or "https")) break;
                continue;
            }
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > MaxBytes)
                throw new InvalidOperationException("That image is too large (max 20 MB).");
            var mime = response.Content.Headers.ContentType?.MediaType ?? "image/png";
            if (!mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("That link isn't an image.");
            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (bytes.Length > MaxBytes) throw new InvalidOperationException("That image is too large (max 20 MB).");
            return (bytes, mime);
        }
        throw new InvalidOperationException("That image link redirects too many times.");
    }

    private const long MaxBytes = 20 * 1024 * 1024;

    private static string MimeFromPath(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => "image/png",
        };
}

/// <summary>
/// Nano Banana 2 (Gemini API) reference-based edit: the strongest model at "change only X,
/// keep everything else". Image inline + instruction becomes an edited image. First in the chain.
/// </summary>
public class NanoBananaEditProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore,
    SourceImageLoader loader) : IImageEditProvider
{
    private const string BaseUrl = "https://generativelanguage.googleapis.com/v1beta";

    public virtual string Name => "nano-banana";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:Google:ApiKey"]);
    protected IConfiguration Config => configuration;
    protected virtual string ModelId => configuration["AI:Google:ImageModel"] is { Length: > 0 } m ? m : ModelDefaults.GoogleImage;

    public async Task<GeneratedMedia> EditAsync(EditSpec spec, CancellationToken cancellationToken = default)
    {
        var model = ModelId;
        var images = new List<object>();
        foreach (var url in spec.AllImageUrls)
        {
            var (bytes, mime) = await loader.LoadAsync(url, cancellationToken);
            images.Add(new { inlineData = new { mimeType = mime, data = Convert.ToBase64String(bytes) } });
        }
        if (images.Count == 0) await loader.LoadAsync(spec.SourceMediaUrl, cancellationToken); // throws the friendly "no media" error
        var client = httpClientFactory.CreateClient();
        var text = spec.SetAspectRatio
            ? $"{spec.Instruction}.{spec.ImagesNote} Aspect ratio {spec.AspectRatio}."
            : $"Edit this ad creative: {spec.Instruction}.{spec.ImagesNote} Keep the product, composition, text and aspect ratio ({spec.AspectRatio}) unchanged unless the instruction says otherwise.";

        // AI:Google:BaseUrl overrides the endpoint (proxies, local capture in tests).
        var baseUrl = (configuration["AI:Google:BaseUrl"] is { Length: > 0 } b ? b : BaseUrl).TrimEnd('/');
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/models/{model}:generateContent");
        request.Headers.Add("x-goog-api-key", configuration["AI:Google:ApiKey"]);
        request.Content = JsonContent.Create(new
        {
            contents = new[]
            {
                new
                {
                    parts = images.Append(new { text }).ToArray(),
                },
            },
            generationConfig = spec.SetAspectRatio
                ? new { responseModalities = new[] { "IMAGE" }, imageConfig = (object?)new { aspectRatio = spec.AspectRatio } }
                : new { responseModalities = new[] { "IMAGE" }, imageConfig = (object?)null },
        }, options: new System.Text.Json.JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var parts = json.RootElement.GetProperty("candidates")[0].GetProperty("content").GetProperty("parts");
        foreach (var part in parts.EnumerateArray())
        {
            if (part.TryGetProperty("inlineData", out var inline) &&
                inline.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.String)
            {
                var outMime = inline.TryGetProperty("mimeType", out var m) ? m.GetString() : "image/png";
                var url = await mediaStore.SaveBase64Async(data.GetString()!, outMime == "image/jpeg" ? "jpg" : "png", cancellationToken);
                return new GeneratedMedia { Url = url, Model = model };
            }
        }

        throw new InvalidOperationException($"{model} returned no edited image.");
    }
}

/// <summary>Nano Banana Pro (Gemini 3 Pro Image) with photos as input — used when the user picks Nano Banana Pro.</summary>
public class NanoBananaProEditProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore,
    SourceImageLoader loader) : NanoBananaEditProvider(httpClientFactory, configuration, mediaStore, loader)
{
    public override string Name => "nano-banana-pro";
    protected override string ModelId => Config["AI:Google:ImageProModel"] is { Length: > 0 } m ? m : ModelDefaults.GoogleImagePro;
}

/// <summary>
/// OpenAI GPT Image edit (Sunburst): POST https://api.openai.com/v1/images/edits (multipart image + prompt).
/// Second in the edit chain.
/// </summary>
public class GptImageEditProvider(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore,
    SourceImageLoader loader) : IImageEditProvider
{
    private const string Endpoint = "https://api.openai.com/v1/images/edits";

    public string Name => "gpt-image-sunburst";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:OpenAI:ApiKey"]);

    public async Task<GeneratedMedia> EditAsync(EditSpec spec, CancellationToken cancellationToken = default)
    {
        // Sunburst is OpenAI's precision-edit model — best at keeping the product intact.
        var model = configuration["AI:OpenAI:EditModel"] is { Length: > 0 } m ? m : ModelDefaults.OpenAiEdit;
        var urls = spec.AllImageUrls.Count > 0 ? spec.AllImageUrls : [spec.SourceMediaUrl ?? ""];
        var client = httpClientFactory.CreateClient();

        using var form = new MultipartFormDataContent();
        for (var i = 0; i < urls.Count; i++)
        {
            var (bytes, mime) = await loader.LoadAsync(urls[i], cancellationToken);
            var image = new ByteArrayContent(bytes);
            image.Headers.ContentType = new MediaTypeHeaderValue(mime);
            // Several input images go as image[] (in order); a single one as image.
            form.Add(image, urls.Count > 1 ? "image[]" : "image", $"image{i + 1}{(mime == "image/jpeg" ? ".jpg" : ".png")}");
        }
        form.Add(new StringContent(model), "model");
        form.Add(new StringContent(spec.SetAspectRatio
            ? $"{spec.Instruction}.{spec.ImagesNote}"
            : $"{spec.Instruction}.{spec.ImagesNote} Keep the product, composition and text unchanged unless instructed."), "prompt");
        form.Add(new StringContent("1"), "n");

        // AI:OpenAI:BaseUrl overrides the endpoint (proxies, local capture in tests).
        var endpoint = configuration["AI:OpenAI:BaseUrl"] is { Length: > 0 } b ? $"{b.TrimEnd('/')}/images/edits" : Endpoint;
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["AI:OpenAI:ApiKey"]);

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var first = json.RootElement.GetProperty("data")[0];
        string? url = null;
        if (first.TryGetProperty("b64_json", out var b64) && b64.ValueKind == JsonValueKind.String)
            url = await mediaStore.SaveBase64Async(b64.GetString()!, "png", cancellationToken);
        else if (first.TryGetProperty("url", out var urlProp))
            url = urlProp.GetString();

        return new GeneratedMedia { Url = url, Model = model };
    }
}

/// <summary>Terminal edit fallback: shifts the deterministic mock composition so the loop is visible.</summary>
public class MockEditProvider : IImageEditProvider
{
    public string Name => "mock";
    public bool IsConfigured => true;

    public Task<GeneratedMedia> EditAsync(EditSpec spec, CancellationToken cancellationToken = default) =>
        Task.FromResult(new GeneratedMedia
        {
            Model = "mock",
            ImageSeed = $"{spec.SourceImageSeed}-v{Determinism.Hex($"{spec.SourceImageSeed}:{spec.Instruction}")[..6]}",
        });
}

/// <summary>Walks AI:ImageEditProviderChain (default nano-banana, then gpt-image-sunburst, then mock).</summary>
public class ImageEditRouter(
    IEnumerable<IImageEditProvider> providers,
    IConfiguration configuration,
    ILogger<ImageEditRouter> logger)
{
    private static readonly string[] DefaultChain = ["nano-banana", "gpt-image-sunburst", "mock"];

    public async Task<GeneratedMedia> EditAsync(EditSpec spec, CancellationToken cancellationToken = default)
    {
        var mock = providers.First(p => p.Name == "mock");
        if (configuration.GetValue("AI:UseMockData", true))
            return await mock.EditAsync(spec, cancellationToken);

        if (await TryRealAsync(spec, cancellationToken) is { } real) return real;
        var placeholder = await mock.EditAsync(spec, cancellationToken);
        placeholder.IsFallback = true; // live mode, no edit model could run — callers report it
        return placeholder;
    }

    public bool IsConfigured(string name) =>
        providers.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) is { IsConfigured: true } p && p.Name != "mock";

    /// <summary>Real edit providers only; null when none is configured or all fail (callers pick their own fallback).</summary>
    public async Task<GeneratedMedia?> TryRealAsync(EditSpec spec, CancellationToken cancellationToken = default, bool exclusive = false)
    {
        var chain = configuration.GetSection("AI:ImageEditProviderChain").Get<string[]>();
        if (chain is null || chain.Length == 0) chain = DefaultChain;
        if (!string.IsNullOrWhiteSpace(spec.PreferredProvider))
            chain = exclusive
                ? [spec.PreferredProvider] // the user's model only — no silent swap
                : [spec.PreferredProvider, .. chain.Where(n => !string.Equals(n, spec.PreferredProvider, StringComparison.OrdinalIgnoreCase))];

        foreach (var name in chain)
        {
            // "mock" in the configured chain is the placeholder, never a real editor.
            if (string.Equals(name, "mock", StringComparison.OrdinalIgnoreCase)) continue;
            var provider = providers.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
            if (provider is null) { logger.LogWarning("Edit provider '{Name}' unknown; skipping.", name); continue; }
            if (!provider.IsConfigured) { logger.LogInformation("Edit provider '{Name}' not configured; skipping.", name); continue; }
            try
            {
                var media = await ProviderHttp.RetryOnceAsync(() => provider.EditAsync(spec, cancellationToken), provider.Name, logger, cancellationToken);
                media.Provider = provider.Name;
                return media;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Edit provider '{Name}' failed; falling through.", provider.Name);
            }
        }

        return null;
    }
}
