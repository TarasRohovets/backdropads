using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>A folder of saved ads in a workspace. Ads point at it with <see cref="Ad.FolderId"/>.</summary>
public class Folder
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";

    /// <summary>The folder it sits in; null = top level.</summary>
    public string? ParentId { get; set; }
    public string Name { get; set; } = "";

    /// <summary>One of <see cref="FolderColors.All"/>; shown as the folder's dot.</summary>
    public string Color { get; set; } = "violet";
    public int Position { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>How many ads are in it (filled in by the endpoint, not stored).</summary>
    public int AdCount { get; set; }
}

public static class FolderColors
{
    public static readonly string[] All = ["violet", "pink", "lime", "sky", "honey", "mint"];

    /// <summary>The starter set every workspace gets once.</summary>
    public static readonly (string Name, string Color)[] Starter =
    [
        ("Instagram ads", "pink"),
        ("TikTok ads", "sky"),
        ("Facebook ads", "violet"),
        ("Website ads", "lime"),
    ];
}
