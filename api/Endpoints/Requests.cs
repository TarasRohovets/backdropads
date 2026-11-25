using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Endpoints;

public class CreateGenerationRequest
{
    public Platform Platform { get; set; }
    public Placement Placement { get; set; }
    public CreativeType CreativeType { get; set; }
    public Brief? Brief { get; set; }
    public string? RoastId { get; set; }
    public string? TemplateId { get; set; }

    /// <summary>How many concepts to generate. Images/carousels 1-4, video 1-2 (default 1).</summary>
    public int? ConceptCount { get; set; }

    /// <summary>Optional style-inspiration id picked in the wizard (e.g. "beauty-editorial").</summary>
    public string? StyleId { get; set; }

    /// <summary>Generate from a saved product anchor (Brand Kit → Products).</summary>
    public string? ProductId { get; set; }

    /// <summary>"standard" (default) or "high" (2K images / 1080p video — costs more at the provider).</summary>
    public string? Quality { get; set; }

    /// <summary>Brand kit to apply: "primary" (default when omitted), a bk_ id, or "none".</summary>
    public string? BrandKitId { get; set; }

    /// <summary>ModelCatalog id ("auto" when omitted), e.g. "nano-banana-pro", "gemini-omni-flash".</summary>
    public string? Model { get; set; }

    /// <summary>Video length in seconds; snapped to the model's allowed durations.</summary>
    public int? DurationSeconds { get; set; }
}

public class CreateAdRequest
{
    public string? GenerationId { get; set; }
    public string? ConceptId { get; set; }
    public string? Name { get; set; }

    /// <summary>Optional: save it straight into this folder.</summary>
    public string? FolderId { get; set; }
}

public class UpdateAdRequest
{
    public string? Name { get; set; }
    public string? Hook { get; set; }
    public string? PrimaryText { get; set; }
    public string? CallToAction { get; set; }
    public List<string>? Palette { get; set; }
    public AdStatus? Status { get; set; }

    /// <summary>Move it to this folder; "" takes it out of its folder; null leaves it.</summary>
    public string? FolderId { get; set; }

    /// <summary>The version label shown on the card ("v2"); "" clears it; null leaves it.</summary>
    public string? VersionTag { get; set; }
}

public class FolderRequest
{
    public string? Name { get; set; }

    /// <summary>Create inside / move into this folder; "" = top level; null = top level on create, unchanged on update.</summary>
    public string? ParentId { get; set; }
    public string? Color { get; set; }
}

public class CreateRoastRequest
{
    public string? AdId { get; set; }
    public string? SourceUrl { get; set; }
    public Platform Platform { get; set; }
    public string TargetMarket { get; set; } = "";
    public string Language { get; set; } = "";
}

public class ImproveRequest
{
    public CreativeType? CreativeType { get; set; }
}

public class RefineRequest
{
    /// <summary>Natural-language edit, e.g. "softer shadow, move the bottle a bit left".</summary>
    public string? Instruction { get; set; }
}

public class CreateProductRequest
{
    public string? Name { get; set; }
    public string? Notes { get; set; }
    /// <summary>Uploaded or reference image URL (from POST /api/uploads).</summary>
    public string? SourceImageUrl { get; set; }
    /// <summary>"Make it my brand": replace labels/branding with the brand kit (costs aiEdit).</summary>
    public bool Rebrand { get; set; }
}

public class UpdateProductRequest
{
    public string? Name { get; set; }
    public string? Notes { get; set; }
}

/// <summary>Create or update a brand kit — the same shape everywhere in the product.</summary>
public class CreateBrandKitRequest
{
    public string? BrandName { get; set; }
    public string? LogoUrl { get; set; }
    public List<string>? Colors { get; set; }
    /// <summary>[heading, body]</summary>
    public List<string>? Fonts { get; set; }
    public string? Context { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Tone { get; set; }
    public string? DefaultCta { get; set; }
    public string? Guidelines { get; set; }
}

public class ScanBrandRequest
{
    public string? Url { get; set; }
}

public class ImportProductRequest
{
    public string? Url { get; set; }
}

public class CreateFlowRequest
{
    public string? Name { get; set; }
    /// <summary>A starter flow to begin from (GET /api/flows/templates); blank when omitted.</summary>
    public string? TemplateId { get; set; }
}

/// <summary>A flow file made by "Export" (steps, prompts and output settings; no photos or results).</summary>
/// <summary>"Create with AI" in Flows: one message → a flow with one output card per image or video.</summary>
public class ComposeFlowRequest
{
    public string? Message { get; set; }
    /// <summary>Optional product photo (from the upload library) every output builds on.</summary>
    public string? PhotoUrl { get; set; }
    /// <summary>Several photos (from the upload library, max 6): each output builds on one, e.g. "edit these 3 photos…".</summary>
    public List<string>? PhotoUrls { get; set; }
    /// <summary>The Claude model that plans it (Sonnet by default; Opus or Fable when picked).</summary>
    public string? TextModel { get; set; }
}

/// <summary>Saved prompts → a flow: a prompt group, or picked prompts (one output card each).</summary>
public class FlowFromPromptsRequest
{
    public string? GroupId { get; set; }
    public List<string>? PromptIds { get; set; }
    public string? PhotoUrl { get; set; }
}

/// <summary>The chat inside a flow: what to change.</summary>
public class FlowChatRequest
{
    public string? Message { get; set; }
    public string? TextModel { get; set; }
}

public class ImportFlowRequest
{
    public string? Format { get; set; }
    public int? Version { get; set; }
    public string? Name { get; set; }
    public List<FlowNode>? Nodes { get; set; }
    public List<FlowEdge>? Edges { get; set; }
}

/// <summary>Run a flow once per photo (links from the upload library), one after another.</summary>
public class RunFlowBatchRequest
{
    public List<string> InputUrls { get; set; } = [];
}

public class UpdateFlowRequest
{
    public string? Name { get; set; }
    public List<FlowNode>? Nodes { get; set; }
    public List<FlowEdge>? Edges { get; set; }
}
