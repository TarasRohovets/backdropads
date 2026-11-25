using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>A prompt the user saved to reuse in Create.</summary>
public class SavedPrompt
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";

    /// <summary>image | video: which kind of model it was written for.</summary>
    public string Kind { get; set; } = "image";

    /// <summary>The ModelCatalog model it was written for ("nano-banana-pro"); null = any.</summary>
    public string? TargetModel { get; set; }

    /// <summary>The group it was written in (see <see cref="PromptGroup"/>); null = a prompt on its own.</summary>
    public string? GroupId { get; set; }

    /// <summary>Order inside its group.</summary>
    public int Position { get; set; }
    public int UseCount { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Prompts written together from one message ("3 photos: cosy, gift, sale"): sent to Flows as one image each.</summary>
public class PromptGroup
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>image | video</summary>
    public string Kind { get; set; } = "image";
    public string Ratio { get; set; } = "4:5";
    public string? TargetModel { get; set; }

    /// <summary>What the user asked for.</summary>
    public string? Message { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
