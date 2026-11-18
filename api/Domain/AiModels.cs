namespace BackdropAds.Api.Domain;

public enum ModelKind { Image, Video }

/// <summary>
/// A user-pickable generation model. `CostUsd` / `CostUsdHigh` are the provider's list price per unit
/// (per image, or per second of video) at standard / high quality (images: 2K or high detail, video: 1080p).
/// They only feed the cost estimates shown in the app — you pay your AI providers directly.
/// `Id` doubles as the provider name in ProviderRouter.
/// </summary>
public sealed record AiModel(
    string Id,
    ModelKind Kind,
    string Name,
    string Vendor,
    string Tagline,
    decimal CostUsd,
    decimal CostUsdHigh,
    string[] Tags,
    int[]? Durations = null,
    int DefaultDuration = 0,
    bool NeedsImage = false);

/// <summary>
/// The model menu. Ids name a model family, not a version ("gpt-image-flare", "nano-banana"): the version each
/// one runs is a setting (see ModelDefaults), so a newer release is a settings change — by hand or with
/// "Update models". Names and list prices below are for the versions this release ships with (checked Nov 2026
/// against OpenAI, Google Gemini API, BytePlus, Kling and fal); treat prices as estimates.
/// </summary>
public static class ModelCatalog
{
    public const string Auto = "auto";

    /// <summary>Estimated provider cost of one image edit (refine, flow step) — Nano Banana at 1K.</summary>
    public const decimal EditCostUsd = 0.034m;

    private static readonly int[] LongDurations = [5, 10, 15];

    public static readonly AiModel[] All =
    [
        // ---- Images — cost per image: 1K standard / 2K or high ------------------------------------
        new(Auto, ModelKind.Image, "Auto", "BackdropAds", "Best model for the job, with automatic fallback",
            0.053m, 0.211m, ["Recommended"]),                                    // GPT Image Flare → Nano Banana
        new("gpt-image-flare", ModelKind.Image, "GPT Image 2.6 Flare", "OpenAI", "OpenAI's fast model — sharp text and layouts, great for ad copy",
            0.053m, 0.211m, ["New", "Best text"]),                               // medium / high, 1024²
        new("gpt-image-sunburst", ModelKind.Image, "GPT Image 2.6 Sunburst", "OpenAI", "OpenAI's most detailed model — for intricate, polished visuals",
            0.053m, 0.211m, []),
        new("nano-banana", ModelKind.Image, "Nano Banana 2.1", "Google", "Google's everyday model — fast, photoreal, strong product consistency",
            0.034m, 0.05m, ["Fast"]),                                            // 1K / 2K
        new("nano-banana-pro", ModelKind.Image, "Nano Banana Pro", "Google", "Highest fidelity and reasoning for complex scenes",
            0.134m, 0.134m, ["Premium"]),                                        // 1K and 2K same price
        new("seedream", ModelKind.Image, "Seedream 5.5", "ByteDance", "Rich, stylised visuals and posters",
            0.03m, 0.0405m, []),                                                 // via fal
        new("seedream-flash", ModelKind.Image, "Seedream 5 Flash", "ByteDance", "Budget option for quick explorations",
            0.027m, 0.027m, ["Cheapest"]),
        new("flux", ModelKind.Image, "FLUX 3", "Black Forest Labs", "Photorealism and lifestyle scenes",
            0.048m, 0.192m, []),                                                 // $0.048 per megapixel: 1K / 2K

        // ---- Video — cost per second: 720p / 1080p -------------------------------------------------
        new(Auto, ModelKind.Video, "Auto", "BackdropAds", "Best model for the job, with automatic fallback",
            0.231m, 0.569m, ["Recommended"], LongDurations, 10),                // Seedance → Gemini Omni Flash
        new("seedance", ModelKind.Video, "Seedance 2.5", "ByteDance", "Top-ranked motion, multi-shot scenes, native audio",
            0.231m, 0.569m, ["Top rated"], LongDurations, 10),                  // BytePlus direct
        new("seedance-flash", ModelKind.Video, "Seedance 2.5 Flash", "ByteDance", "Seedance quality, quicker and cheaper (720p)",
            0.15m, 0.15m, ["Fast"], LongDurations, 10),
        new("gemini-omni-flash", ModelKind.Video, "Gemini Omni 1.2 Flash", "Google", "Google's video model — native audio, works with just a Google key",
            0.07m, 0.104m, [], LongDurations, 10),
        new("kling", ModelKind.Video, "Kling 3.0", "Kuaishou", "Realistic people and product motion (1080p adds native audio)",
            0.084m, 0.168m, [], LongDurations, 10),
        new("wan", ModelKind.Video, "Wan 3.0", "Alibaba", "Open model with smooth, natural motion",
            0.10m, 0.20m, [], LongDurations, 10),                               // via fal
        new("omnihuman", ModelKind.Video, "OmniHuman 2", "ByteDance", "Talking-avatar UGC from one photo, lip-synced",
            0.105m, 0.105m, ["UGC"], LongDurations, 10, NeedsImage: true),    // via fal, incl. voiceover
    ];

    /// <summary>
    /// The name to show for a model: the one "Update models" saved when it moved the family to a newer version
    /// (AI:ModelNames:{id}), otherwise the name of the version this release ships with.
    /// </summary>
    public static string DisplayName(IConfiguration configuration, string id, ModelKind? kind = null)
    {
        if (!string.Equals(id, Auto, StringComparison.OrdinalIgnoreCase)
            && configuration[$"AI:ModelNames:{id}"] is { Length: > 0 } updated) return updated;
        var model = kind is { } k ? Find(k, id) : All.FirstOrDefault(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase));
        return model?.Name ?? id;
    }

    public static AiModel? Find(ModelKind kind, string? id) =>
        All.FirstOrDefault(m => m.Kind == kind && string.Equals(m.Id, string.IsNullOrWhiteSpace(id) ? Auto : id, StringComparison.OrdinalIgnoreCase));

    /// <summary>Auto: walks the configured provider chain.</summary>
    public static AiModel Default(ModelKind kind) => Find(kind, Auto)!;

    /// <summary>Pre-selected model for new generations and flow outputs (AI:DefaultModels:Image / Video).</summary>
    public static string DefaultImageModel { get; private set; } = "nano-banana-pro";
    public static string DefaultVideoModel { get; private set; } = Auto;

    /// <summary>Set at startup from config; unknown ids are ignored.</summary>
    public static void ConfigureDefaults(string? image, string? video)
    {
        if (Find(ModelKind.Image, image) is { } i && !string.IsNullOrWhiteSpace(image)) DefaultImageModel = i.Id;
        if (Find(ModelKind.Video, video) is { } v && !string.IsNullOrWhiteSpace(video)) DefaultVideoModel = v.Id;
    }

    /// <summary>The model a generation uses when it doesn't name one.</summary>
    public static AiModel Preferred(ModelKind kind) =>
        Find(kind, kind == ModelKind.Image ? DefaultImageModel : DefaultVideoModel) ?? Default(kind);

    public static IEnumerable<AiModel> OfKind(ModelKind kind) => All.Where(m => m.Kind == kind);

    /// <summary>Image models that take attached photos as input (Gemini / OpenAI edit route).</summary>
    public static readonly HashSet<string> PhotoInputModels =
        new(StringComparer.OrdinalIgnoreCase) { Auto, "gpt-image-flare", "gpt-image-sunburst", "nano-banana", "nano-banana-pro" };

    /// <summary>True when the model uses attached photos (photo-input image models, and video models that animate a photo).</summary>
    public static bool AcceptsImages(AiModel m) => m.NeedsImage || (m.Kind == ModelKind.Image && PhotoInputModels.Contains(m.Id));

    public static bool IsHigh(string? quality) => string.Equals(quality, "high", StringComparison.OrdinalIgnoreCase);

    /// <summary>Snap a requested length to the model's allowed durations (nearest, ties go shorter).</summary>
    public static int Duration(AiModel model, int? requested)
    {
        if (model.Durations is not { Length: > 0 } options) return 0;
        if (requested is null) return model.DefaultDuration;
        return options.OrderBy(d => Math.Abs(d - requested.Value)).ThenBy(d => d).First();
    }

    /// <summary>Estimated provider cost of one image / one clip.</summary>
    public static decimal UnitCostUsd(AiModel model, string? quality, int durationSeconds)
    {
        var rate = IsHigh(quality) ? model.CostUsdHigh : model.CostUsd;
        return model.Kind == ModelKind.Video ? rate * Math.Max(1, durationSeconds) : rate;
    }

    public static decimal CostUsd(AiModel model, string? quality, int durationSeconds, int count) =>
        UnitCostUsd(model, quality, durationSeconds) * Math.Max(1, count);
}
