using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>Embedded brief object (not an entity).</summary>
public class Brief
{
    public string ProductName { get; set; } = "";
    public string? ProductUrl { get; set; }
    public string? ProductDescription { get; set; }
    public string TargetAudience { get; set; } = "";
    public string TargetMarket { get; set; } = "";
    public string Language { get; set; } = "";
    public string Tone { get; set; } = "";
    public string? Offer { get; set; }
    public string KeyBenefit { get; set; } = "";
    public string CallToAction { get; set; } = "";
    public string? ReferenceCreativeUrl { get; set; }

    /// <summary>More reference images after ReferenceCreativeUrl, in order (a second product, a style, a logo…).
    /// The prompt can refer to them as image 2, image 3, …</summary>
    public List<string> ReferenceImageUrls { get; set; } = [];

    /// <summary>Attached PDFs / text files. An LLM reads them first (DocumentReader); only its notes reach the prompt.</summary>
    public List<string> DocumentUrls { get; set; } = [];

    /// <summary>What the LLM took from DocumentUrls — filled once, when the generation runs.</summary>
    public string? DocumentNotes { get; set; }
    public string? RequiredText { get; set; }
    public string? ProhibitedClaims { get; set; }
}

public class Generation
{
    public string Id { get; set; } = "";

    /// <summary>Owner. Internal — never serialized (responses stay contract-exact).</summary>
    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>Owning workspace (internal).</summary>
    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public Platform Platform { get; set; }
    public Placement Placement { get; set; }
    public CreativeType CreativeType { get; set; }
    public string AspectRatio { get; set; } = "";
    public Brief Brief { get; set; } = new();
    public string? RoastId { get; set; }
    public string? TemplateId { get; set; }
    public int ConceptCount { get; set; } = 1;
    /// <summary>"standard" or "high" — passed to providers that support a quality knob.</summary>
    public string Quality { get; set; } = "standard";
    public string? StyleId { get; set; }

    /// <summary>Model the user picked (ModelCatalog id, "auto" by default). Concepts record the model actually used.</summary>
    public string Model { get; set; } = ModelCatalog.Auto;
    /// <summary>Video clip length in seconds (null for images).</summary>
    public int? DurationSeconds { get; set; }
    /// <summary>Estimated provider cost in USD at list prices: the quote while it runs, then what really ran.</summary>
    public decimal EstimatedCostUsd { get; set; }

    /// <summary>Why the generation (or part of it) failed — shown to the user.</summary>
    public string? Error { get; set; }

    /// <summary>A working model to try instead when the picked one failed (catalog id), or null.</summary>
    public string? SuggestedModel { get; set; }

    /// <summary>Set by the request that completes this generation (atomic claim), so providers run once
    /// even when several reads race — and across API instances.</summary>
    [JsonIgnore]
    public DateTimeOffset? ClaimedAt { get; set; }

    /// <summary>Product anchor this generation was built from (null for free-form briefs).</summary>
    public string? ProductId { get; set; }
    /// <summary>Snapshot of the product hero for consistent mock/real output.</summary>
    public string? ProductImageSeed { get; set; }
    public List<string>? ProductPalette { get; set; }
    /// <summary>Brand kit applied to this generation (snapshot), or null for none.</summary>
    public BrandKit? Brand { get; set; }
    public GenerationStatus Status { get; set; } = GenerationStatus.Processing;
    public DateTimeOffset CreatedAt { get; set; }
    public List<Concept> Concepts { get; set; } = [];
}

/// <summary>One generated variation inside a generation.</summary>
public class Concept
{
    public string Id { get; set; } = "";
    public string GenerationId { get; set; } = "";
    public CreativeType CreativeType { get; set; }
    public string AspectRatio { get; set; } = "";
    public string Hook { get; set; } = "";
    public string PrimaryText { get; set; } = "";
    public string CallToAction { get; set; } = "";
    public int Score { get; set; }
    public string ImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];
    public VideoSpec? Video { get; set; }
    public List<Slide>? Slides { get; set; }

    /// <summary>Which model produced the media: "mock", "gpt-image-sunburst", "nano-banana", "seedance", "gemini-omni-flash".</summary>
    public string Model { get; set; } = "mock";

    /// <summary>Media URL returned by a real provider; null in mock mode (frontend renders from imageSeed).</summary>
    public string? MediaUrl { get; set; }

    /// <summary>Refine loop: the concept this one was edited from (null for originals).</summary>
    public string? ParentConceptId { get; set; }

    /// <summary>1 for an original; parent.Version + 1 for each refinement.</summary>
    public int Version { get; set; } = 1;

    /// <summary>The instruction that produced this version ("softer shadow, move bottle left").</summary>
    public string? EditInstruction { get; set; }
}

/// <summary>One saved state of an ad's creative — the refine loop's history.</summary>
public class AdVersion
{
    public string Id { get; set; } = "";
    public int Version { get; set; }
    public string ImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];
    public string? MediaUrl { get; set; }
    public string Model { get; set; } = "mock";
    public string? EditInstruction { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class VideoSpec
{
    public int DurationSeconds { get; set; }
    public string Voiceover { get; set; } = "";
    public List<string> Captions { get; set; } = [];
}

public class Slide
{
    public string Id { get; set; } = "";
    public int Order { get; set; }
    public string ImageSeed { get; set; } = "";
    public string Headline { get; set; } = "";
    public string Text { get; set; } = "";
}

/// <summary>A saved concept.</summary>
public class Ad
{
    public string Id { get; set; } = "";

    /// <summary>Owner. Internal — never serialized.</summary>
    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>Owning workspace (internal).</summary>
    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public Platform Platform { get; set; }
    public Placement Placement { get; set; }
    public CreativeType CreativeType { get; set; }
    public string AspectRatio { get; set; } = "";
    public AdStatus Status { get; set; } = AdStatus.Draft;
    public string Hook { get; set; } = "";
    public string PrimaryText { get; set; } = "";
    public string CallToAction { get; set; } = "";
    public string ImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];
    public VideoSpec? Video { get; set; }
    public List<Slide>? Slides { get; set; }
    public int? Score { get; set; }

    /// <summary>Real media carried over from the saved concept; null in mock mode.</summary>
    public string? MediaUrl { get; set; }
    /// <summary>Product anchor, carried from the generation; enables My Ads filtering by product.</summary>
    public string? ProductId { get; set; }
    public string Model { get; set; } = "mock";

    /// <summary>Refine history, oldest first. Empty until the first refinement.</summary>
    public List<AdVersion> Versions { get; set; } = [];

    /// <summary>Which version is currently shown (matches an entry in Versions once any exist).</summary>
    public int CurrentVersion { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
}

public class Roast
{
    public string Id { get; set; } = "";

    /// <summary>Owner. Internal — never serialized.</summary>
    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>Owning workspace (internal).</summary>
    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public string? AdId { get; set; }
    public string? SourceUrl { get; set; }
    public string SourceImageSeed { get; set; } = "";
    public Platform Platform { get; set; }
    public string TargetMarket { get; set; } = "";
    public string Language { get; set; } = "";
    public GenerationStatus Status { get; set; } = GenerationStatus.Processing;
    public DateTimeOffset CreatedAt { get; set; }

    // Everything below is null/empty until the roast completes.
    public int? OverallScore { get; set; }
    public RoastScores? Scores { get; set; }
    public string? RoastText { get; set; }
    public List<Recommendation> Recommendations { get; set; } = [];
    public ImprovedCopy? Improved { get; set; }
}

public class RoastScores
{
    public int Hook { get; set; }
    public int Visual { get; set; }
    public int Offer { get; set; }
    public int Message { get; set; }
    public int Cta { get; set; }
    public int PlatformFit { get; set; }
}

public class Recommendation
{
    public string Id { get; set; } = "";
    public int Priority { get; set; }
    public string Title { get; set; } = "";
    public string Problem { get; set; } = "";

    /// <summary>Serialized as "recommendation" (a C# member cannot share its enclosing type's name).</summary>
    [JsonPropertyName("recommendation")]
    public string RecommendationText { get; set; } = "";
    public string? ImprovedText { get; set; }
}

public class ImprovedCopy
{
    public string Hook { get; set; } = "";
    public string PrimaryText { get; set; } = "";
    public string CallToAction { get; set; } = "";
    public string ImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];
}

public class Template
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public Platform Platform { get; set; }
    public Placement Placement { get; set; }
    public CreativeType CreativeType { get; set; }
    public string Category { get; set; } = "";
    public string Description { get; set; } = "";
    public string ImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];
    public string Hook { get; set; } = "";
    public string CallToAction { get; set; } = "";
}

/// <summary>Singleton per user.</summary>
public class BrandKit
{
    /// <summary>"primary" for the user's main kit; bk_xxx for additional kits.</summary>
    public string Id { get; set; } = "primary";
    public string BrandName { get; set; } = "";
    public string? LogoUrl { get; set; }
    public List<string> Colors { get; set; } = [];
    public List<string> Fonts { get; set; } = [];
    public string Tone { get; set; } = "";
    public string DefaultCta { get; set; } = "";
    public string? ProductInfo { get; set; }
    public string? Guidelines { get; set; }

    /// <summary>Free-form brand context the AI reads before every generation (voice, audience, do's and don'ts).</summary>
    public string? Context { get; set; }

    /// <summary>Website this kit was scanned from, if any.</summary>
    public string? WebsiteUrl { get; set; }
}

/// <summary>
/// A product anchor: the hero image everything else references (Phase 2 of the product workflow).
/// Created from an upload, optionally rebranded ("Make it my brand") through the edit chain.
/// </summary>
public class Product
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>Owning workspace (internal).</summary>
    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Notes { get; set; }

    /// <summary>The uploaded/reference image this product was created from.</summary>
    public string? SourceImageUrl { get; set; }

    /// <summary>The hero shot used as the reference for generations; null in mock mode (renders from seed).</summary>
    public string? HeroImageUrl { get; set; }
    public string HeroImageSeed { get; set; } = "";
    public List<string> Palette { get; set; } = [];

    /// <summary>True when the labels/branding were replaced with the brand kit.</summary>
    public bool Rebranded { get; set; }
    public string Model { get; set; } = "mock";
    public DateTimeOffset CreatedAt { get; set; }
}
