using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services.Providers;

/// <summary>What to generate: creative type, derived aspect ratio, composed prompt, optional duration/voiceover.</summary>
public sealed record MediaSpec(
    CreativeType CreativeType,
    string AspectRatio,
    string Prompt,
    int? DurationSeconds,
    string? Voiceover = null,
    string Quality = "standard");

/// <summary>Result of a provider call: media url (null for mock — frontend renders from imageSeed) + metadata.</summary>
public class GeneratedMedia
{
    public string? Url { get; set; }
    public string? ImageSeed { get; set; }
    public string Model { get; set; } = "mock";

    /// <summary>Router-set: the provider (= ModelCatalog id) that produced this, "mock" for mock output.</summary>
    public string Provider { get; set; } = "mock";

    /// <summary>Video length actually produced when the provider caps it (e.g. Gemini Omni max 15s).</summary>
    public int? DurationSeconds { get; set; }

    /// <summary>Live mode, but every real provider failed or was unconfigured and the placeholder answered.
    /// Such results are never shown and never counted as cost.</summary>
    public bool IsFallback { get; set; }
}

public interface IImageModelProvider
{
    string Name { get; }
    bool IsConfigured { get; }
    Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default);
}

public interface IVideoModelProvider
{
    string Name { get; }
    bool IsConfigured { get; }
    Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default);
}

/// <summary>Terminal image fallback: keeps today's deterministic mock composition (imageSeed + palette).</summary>
public class MockImageProvider : IImageModelProvider
{
    public string Name => "mock";
    public bool IsConfigured => true;

    public Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default) =>
        Task.FromResult(new GeneratedMedia { Model = "mock" });
}

/// <summary>Terminal video fallback: keeps today's deterministic mock video spec (voiceover + captions).</summary>
public class MockVideoProvider : IVideoModelProvider
{
    public string Name => "mock";
    public bool IsConfigured => true;

    public Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default) =>
        Task.FromResult(new GeneratedMedia { Model = "mock" });
}

/// <summary>
/// Picks the model the user chose (Generation.Model) first, then walks AI:ImageProviderChain /
/// AI:VideoProviderChain: skips unconfigured providers, catches provider failures and falls through
/// to the next; "mock" is the terminal fallback. "auto" uses the chain as-is.
/// AI:UseMockData=true (the default) short-circuits straight to mock.
/// </summary>
/// <summary>
/// Transient-error handling for provider calls. A call is retried once only when it failed *before* the provider
/// accepted the work (rate limited, server error, network) — never after a timeout, which may already be billed.
/// Status checks of running video jobs never fail on a blip: they just check again on the next tick.
/// </summary>
public static class ProviderHttp
{
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);

    public static bool IsTransientStatus(System.Net.HttpStatusCode status) => (int)status == 429 || (int)status >= 500;

    /// <summary>Rate limited, server error, or no response at all (network).</summary>
    public static bool IsRetryable(Exception ex) =>
        ex is HttpRequestException h && (h.StatusCode is null || IsTransientStatus(h.StatusCode.Value));

    /// <summary>One attempt, plus one retry after a short pause when the first failed transiently.</summary>
    public static async Task<T> RetryOnceAsync<T>(Func<Task<T>> attempt, string name, ILogger logger, CancellationToken ct)
    {
        try
        {
            return await attempt();
        }
        catch (Exception ex) when (IsRetryable(ex) && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Provider '{Name}' had a temporary error ({Error}); retrying once.", name, ex.Message);
            await Task.Delay(RetryDelay, ct);
            return await attempt();
        }
    }

    /// <summary>Status check of a running job: null on a temporary error (check again next tick), else the response.</summary>
    public static async Task<HttpResponseMessage?> TryPollAsync(HttpClient client, HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            var response = await client.SendAsync(request, ct);
            if (response.IsSuccessStatusCode || !IsTransientStatus(response.StatusCode)) return response;
            response.Dispose();
            return null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return null; // one slow status check — the job keeps running
        }
    }
}

public class ProviderRouter(
    IEnumerable<IImageModelProvider> imageProviders,
    IEnumerable<IVideoModelProvider> videoProviders,
    ImageEditRouter editor,
    MediaStore mediaStore,
    AiGate gate,
    IConfiguration configuration,
    ILogger<ProviderRouter> logger)
{
    /// <summary>
    /// Provider links expire (Seedance/Kling/fal ~24h) or need our key (Google file links), so every
    /// result is copied into our own media store before it reaches the browser.
    /// </summary>
    private async Task<GeneratedMedia> PersistAsync(GeneratedMedia media, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(media.Url) || mediaStore.IsOwn(media.Url)) return media;
        try
        {
            Dictionary<string, string>? headers = null;
            if (media.Url.Contains("generativelanguage.googleapis.com", StringComparison.OrdinalIgnoreCase)
                && configuration["AI:Google:ApiKey"] is { Length: > 0 } key)
                headers = new() { ["x-goog-api-key"] = key };

            if (await mediaStore.ImportAsync(media.Url, headers, ct) is { } local) media.Url = local;
            else logger.LogWarning("Couldn't copy {Provider} media locally; keeping the provider link.", media.Provider);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Couldn't copy {Provider} media locally; keeping the provider link.", media.Provider);
        }
        return media;
    }

    /// <summary>Edit provider for a picked image model (both GPT Image models edit on OpenAI's edit model); null = the chain.</summary>
    private static string? EditProviderFor(string? model) => model?.ToLowerInvariant() switch
    {
        "nano-banana-pro" => "nano-banana-pro",
        "nano-banana" => "nano-banana",
        "gpt-image-flare" or "gpt-image-sunburst" => "gpt-image-sunburst",
        _ => null,
    };

    private static readonly string[] DefaultImageChain = ["gpt-image-flare", "nano-banana", "mock"];
    private static readonly string[] DefaultVideoChain = ["seedance", "gemini-omni-flash", "mock"];
    private static readonly string[] DefaultUgcVideoChain = ["omnihuman", "seedance", "gemini-omni-flash", "mock"];

    public async Task<GeneratedMedia> GenerateAsync(Generation generation, Concept concept, CancellationToken cancellationToken = default)
    {
        var isVideo = generation.CreativeType == CreativeType.Video;
        var spec = new MediaSpec(
            generation.CreativeType,
            generation.AspectRatio,
            BuildPrompt(generation, concept),
            concept.Video?.DurationSeconds ?? generation.DurationSeconds,
            concept.Video?.Voiceover,
            generation.Quality);

        if (configuration.GetValue("AI:UseMockData", true))
            return await GenerateMockAsync(isVideo, generation.Brief, spec, cancellationToken);

        // Queue: wait for a free slot so the machine never runs more than a few AI jobs at once.
        using var slot = await gate.EnterAsync(isVideo, cancellationToken);

        // Ecommerce core: with a product photo, image ads are built *around the real product* by an
        // edit model (Nano Banana → GPT Image) instead of generating a look-alike from text.
        if (!isVideo && !string.IsNullOrWhiteSpace(generation.Brief.ReferenceCreativeUrl)
            && ModelCatalog.PhotoInputModels.Contains(generation.Model))
        {
            var many = generation.Brief.ReferenceImageUrls.Count > 0;
            var instruction = spec.Prompt + (many
                ? ". Use the products exactly as they appear in the photos — same shape, label, colors and proportions. " +
                  "Build the ad scene, lighting, background and headline around them."
                : ". Use the product exactly as it appears in this photo — same shape, label, colors and proportions. " +
                  "Build the ad scene, lighting, background and headline around it.");
            var anchored = await editor.TryRealAsync(
                new EditSpec(generation.Brief.ReferenceCreativeUrl, concept.ImageSeed, instruction, generation.AspectRatio,
                    ExtraImageUrls: generation.Brief.ReferenceImageUrls,
                    PreferredProvider: EditProviderFor(generation.Model),
                    SetAspectRatio: true),
                cancellationToken,
                exclusive: Picked(generation));
            if (anchored is not null) return await PersistAsync(anchored, cancellationToken);
            if (Picked(generation))
            {
                // The user chose this model: no silent swap. Fail and suggest a working one instead.
                logger.LogWarning("Picked model '{Model}' couldn't use the product photo.", generation.Model);
                return await PlaceholderAsync(isVideo, generation.Brief, spec, cancellationToken);
            }
            logger.LogInformation("No edit model could use the product photo; generating from the prompt instead.");
        }

        // Auto walks the chain (each model retried once on a temporary error). A picked model runs alone:
        // if it still fails, the generation fails and the user is offered a working alternative.
        var chain = Picked(generation) ? [generation.Model] : ChainFor(generation);

        foreach (var name in chain)
        {
            var (providerName, isConfigured, generate) = Resolve(isVideo, name);
            if (generate is null)
            {
                logger.LogWarning("Provider '{Name}' in the {Kind} chain is unknown; skipping.", name, isVideo ? "video" : "image");
                continue;
            }
            if (!isConfigured)
            {
                logger.LogInformation("Provider '{Name}' is not configured; skipping.", providerName);
                continue;
            }

            try
            {
                var media = await ProviderHttp.RetryOnceAsync(() => generate(generation.Brief, spec, cancellationToken), providerName, logger, cancellationToken);
                media.Provider = providerName;
                if (providerName == "mock")
                {
                    logger.LogWarning("No real {Kind} provider could run; returning a placeholder (not billed).", isVideo ? "video" : "image");
                    media.IsFallback = true;
                }
                return await PersistAsync(media, cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Provider '{Name}' failed; falling through to the next provider.", providerName);
            }
        }

        // Nothing could run: a placeholder the caller never bills (and drops from the result).
        return await PlaceholderAsync(isVideo, generation.Brief, spec, cancellationToken);
    }

    private async Task<GeneratedMedia> PlaceholderAsync(bool isVideo, Brief brief, MediaSpec spec, CancellationToken ct)
    {
        var placeholder = await GenerateMockAsync(isVideo, brief, spec, ct);
        placeholder.IsFallback = true;
        return placeholder;
    }

    /// <summary>The user chose a specific model (anything but Auto).</summary>
    private static bool Picked(Generation generation) =>
        !string.IsNullOrWhiteSpace(generation.Model) && !string.Equals(generation.Model, ModelCatalog.Auto, StringComparison.OrdinalIgnoreCase);

    /// <summary>The configured Auto chain for this kind of generation.</summary>
    private string[] ChainFor(Generation generation)
    {
        var isVideo = generation.CreativeType == CreativeType.Video;
        // UGC-styled video routes through the avatar model first (OmniHuman), then the scene models.
        var isUgc = isVideo && generation.StyleId?.StartsWith("ugc", StringComparison.OrdinalIgnoreCase) == true;
        var chainKey = !isVideo ? "AI:ImageProviderChain"
            : isUgc ? "AI:UgcVideoProviderChain"
            : "AI:VideoProviderChain";
        var configured = configuration.GetSection(chainKey).Get<string[]>();
        return configured is { Length: > 0 } ? configured : !isVideo ? DefaultImageChain : isUgc ? DefaultUgcVideoChain : DefaultVideoChain;
    }

    /// <summary>True when the model has what it needs to run (its API key); Auto: any real model in its chain does.</summary>
    public bool IsModelConfigured(ModelKind kind, string id)
    {
        var isVideo = kind == ModelKind.Video;
        if (!string.Equals(id, ModelCatalog.Auto, StringComparison.OrdinalIgnoreCase)) return Resolve(isVideo, id).IsConfigured;
        var chain = configuration.GetSection(isVideo ? "AI:VideoProviderChain" : "AI:ImageProviderChain").Get<string[]>();
        if (chain is not { Length: > 0 }) chain = isVideo ? DefaultVideoChain : DefaultImageChain;
        return chain.Any(n => !string.Equals(n, "mock", StringComparison.OrdinalIgnoreCase) && Resolve(isVideo, n).IsConfigured);
    }

    /// <summary>
    /// A different model that can do this generation and is set up (key configured) — offered when the picked model
    /// failed. Auto-chain order first, then the rest of the catalog. Null when nothing else is available.
    /// </summary>
    public string? SuggestAlternative(Generation generation)
    {
        var isVideo = generation.CreativeType == CreativeType.Video;
        var kind = isVideo ? ModelKind.Video : ModelKind.Image;
        var hasPhoto = !string.IsNullOrWhiteSpace(generation.Brief.ReferenceCreativeUrl);
        var candidates = ChainFor(generation).Concat(ModelCatalog.OfKind(kind).Select(m => m.Id))
            .Where(n => !string.Equals(n, "mock", StringComparison.OrdinalIgnoreCase) && !string.Equals(n, ModelCatalog.Auto, StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(n, generation.Model, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var id in candidates)
        {
            if (ModelCatalog.Find(kind, id) is not { } model) continue;
            if (model.NeedsImage && !hasPhoto) continue;
            var usable = !isVideo && hasPhoto && ModelCatalog.PhotoInputModels.Contains(id)
                ? EditProviderFor(id) is { } edit && editor.IsConfigured(edit)
                : Resolve(isVideo, id).IsConfigured;
            if (usable) return model.Id;
        }
        return null;
    }

    private (string Name, bool IsConfigured, Func<Brief, MediaSpec, CancellationToken, Task<GeneratedMedia>>? Generate)
        Resolve(bool isVideo, string name)
    {
        if (isVideo)
        {
            var provider = videoProviders.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
            return provider is null ? (name, false, null) : (provider.Name, provider.IsConfigured, provider.GenerateAsync);
        }

        var image = imageProviders.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
        return image is null ? (name, false, null) : (image.Name, image.IsConfigured, image.GenerateAsync);
    }

    private Task<GeneratedMedia> GenerateMockAsync(bool isVideo, Brief brief, MediaSpec spec, CancellationToken ct) =>
        isVideo
            ? videoProviders.First(p => p.Name == "mock").GenerateAsync(brief, spec, ct)
            : imageProviders.First(p => p.Name == "mock").GenerateAsync(brief, spec, ct);

    private static string BuildPrompt(Generation generation, Concept concept)
    {
        var brief = generation.Brief;
        var parts = new List<string>
        {
            $"{generation.AspectRatio} {generation.Platform}/{generation.Placement} ad creative for \"{brief.ProductName}\"",
        };
        if (!string.IsNullOrWhiteSpace(brief.ProductDescription)) parts.Add(brief.ProductDescription!);
        if (!string.IsNullOrWhiteSpace(brief.DocumentNotes)) parts.Add($"From the attached documents:\n{brief.DocumentNotes}");
        if (!string.IsNullOrWhiteSpace(brief.KeyBenefit)) parts.Add($"Key benefit: {brief.KeyBenefit}");
        if (!string.IsNullOrWhiteSpace(brief.TargetAudience)) parts.Add($"Audience: {brief.TargetAudience}");
        if (!string.IsNullOrWhiteSpace(brief.Tone)) parts.Add($"Tone: {brief.Tone}");
        if (!string.IsNullOrWhiteSpace(brief.Language)) parts.Add($"All ad text in {brief.Language}");
        if (!string.IsNullOrWhiteSpace(brief.TargetMarket)) parts.Add($"Market: {brief.TargetMarket}");
        if (generation.Brand is { } kit && !string.IsNullOrWhiteSpace(kit.BrandName))
        {
            parts.Add($"Brand: {kit.BrandName}");
            if (kit.Colors.Count > 0) parts.Add($"Brand colors: {string.Join(", ", kit.Colors)}");
            if (!string.IsNullOrWhiteSpace(kit.Tone)) parts.Add($"Brand voice: {kit.Tone}");
            if (!string.IsNullOrWhiteSpace(kit.Guidelines)) parts.Add($"Brand guidelines: {kit.Guidelines}");
            if (!string.IsNullOrWhiteSpace(kit.Context)) parts.Add($"Brand context: {kit.Context}");
            if (kit.Fonts.Count > 0 && !string.IsNullOrWhiteSpace(kit.Fonts[0])) parts.Add($"Typography: {string.Join(" / ", kit.Fonts.Where(f => !string.IsNullOrWhiteSpace(f)))}");
        }
        parts.Add($"Headline on the creative: \"{concept.Hook}\"");
        if (!string.IsNullOrWhiteSpace(brief.RequiredText)) parts.Add($"Must include the text: {brief.RequiredText}");
        if (!string.IsNullOrWhiteSpace(brief.ProhibitedClaims)) parts.Add($"Never claim: {brief.ProhibitedClaims}");
        return string.Join(". ", parts.Select(p => p.TrimEnd('.')));
    }
}
