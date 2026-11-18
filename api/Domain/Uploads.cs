using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>A file the user uploaded, kept in their workspace's library so they can reuse it.</summary>
public class Upload
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string WorkspaceId { get; set; } = "";

    [JsonIgnore]
    public string UserId { get; set; } = "";
    public string Url { get; set; } = "";

    /// <summary>image | video | pdf | text</summary>
    public string Kind { get; set; } = "image";

    /// <summary>source (a photo to build ads from) | attachment | ad (analyzed) | logo</summary>
    public string Purpose { get; set; } = "source";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
