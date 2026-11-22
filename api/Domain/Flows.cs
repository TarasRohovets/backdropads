using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>
/// A flow: prompt steps connected by edges, ending in one or more output cards.
/// Shape mirrors the frontend board (React Flow): nodes { id, type, position, data } + edges.
/// </summary>
public class Flow
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>Owning workspace (internal).</summary>
    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public string Name { get; set; } = "";
    public List<FlowNode> Nodes { get; set; } = [];
    public List<FlowEdge> Edges { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Most recent run (results per step); null until the flow is run.</summary>
    public FlowRun? LastRun { get; set; }

    /// <summary>Most recent run on several photos (one run per photo, queued); null until used.</summary>
    public FlowBatch? LastBatch { get; set; }
}

public class FlowNode
{
    public string Id { get; set; } = "";
    /// <summary>"prompt" | "output"</summary>
    public string Type { get; set; } = "prompt";
    public FlowPosition Position { get; set; } = new();
    public FlowStepData Data { get; set; } = new();
}

public class FlowPosition
{
    public double X { get; set; }
    public double Y { get; set; }
}

/// <summary>Flat step settings; prompt fields apply to prompt steps, output fields to output cards.</summary>
public class FlowStepData
{
    /// <summary>"prompt" | "output"</summary>
    public string Kind { get; set; } = "prompt";
    public string Title { get; set; } = "";

    // Prompt step
    public string? Prompt { get; set; }
    public List<FlowAttachment>? Attachments { get; set; }
    public bool? UsePrevious { get; set; }

    // Output card
    /// <summary>"image" | "video"</summary>
    public string? Mode { get; set; }
    public string? Ratio { get; set; }
    /// <summary>Where the ad will run, when the card targets a platform ("instagram"); null = any, sized by Ratio.</summary>
    public string? Platform { get; set; }
    /// <summary>The format on that platform ("feed", "story", "reel", …). Set together with Platform.</summary>
    public string? Placement { get; set; }
    public int? Count { get; set; }
    /// <summary>"standard" | "high"</summary>
    public string? Quality { get; set; }
    public string? BrandKitId { get; set; }
    /// <summary>ModelCatalog id; "auto" when omitted.</summary>
    public string? Model { get; set; }
    /// <summary>Video outputs: clip length in seconds.</summary>
    public int? DurationSeconds { get; set; }
}

public class FlowAttachment
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>"image" | "pdf" | "text"</summary>
    public string Kind { get; set; } = "image";
    public long Size { get; set; }
    public string? Url { get; set; }
}

public class FlowEdge
{
    public string Id { get; set; } = "";
    public string Source { get; set; } = "";
    public string Target { get; set; } = "";
}

/// <summary>One execution of a flow. Polled by the board while it runs.</summary>
public class FlowRun
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";
    public string FlowId { get; set; } = "";
    /// <summary>"running" | "completed" | "failed"</summary>
    public string Status { get; set; } = "running";
    public string? Error { get; set; }
    /// <summary>Estimated provider cost of the whole run in USD (list prices).</summary>
    public decimal EstimatedCostUsd { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public List<FlowRunStep> Steps { get; set; } = [];
}

public class FlowRunStep
{
    public string NodeId { get; set; } = "";
    /// <summary>"queued" | "running" | "done" | "failed"</summary>
    public string Status { get; set; } = "queued";
    public string? Error { get; set; }
    public string? Model { get; set; }

    // Prompt step result (becomes the next step's input)
    public string? ResultSeed { get; set; }
    public string? MediaUrl { get; set; }

    // Output card result — a real Generation (open it to save concepts to My Ads)
    public string? GenerationId { get; set; }
    public List<string> ResultSeeds { get; set; } = [];
    public List<string?> ResultUrls { get; set; } = [];
}

/// <summary>The same flow run once for each input photo, one after another. Polled by the board.</summary>
public class FlowBatch
{
    public string Id { get; set; } = "";
    public string FlowId { get; set; } = "";
    /// <summary>"running" | "completed" | "failed" (failed = no photo produced a result)</summary>
    public string Status { get; set; } = "running";
    /// <summary>Estimated provider cost of all photos in USD: the quote while running, what really ran once finished.</summary>
    public decimal EstimatedCostUsd { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public List<FlowBatchItem> Items { get; set; } = [];
}

public class FlowBatchItem
{
    /// <summary>The photo this run starts from (replaces the first step's photo).</summary>
    public string InputUrl { get; set; } = "";
    /// <summary>"queued" | "running" | "done" | "failed"</summary>
    public string Status { get; set; } = "queued";
    public string? Error { get; set; }
    /// <summary>The run for this photo; null while it is still queued.</summary>
    public FlowRun? Run { get; set; }
}
