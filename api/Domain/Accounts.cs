using System.Text.Json.Serialization;

namespace BackdropAds.Api.Domain;

/// <summary>Who owns the workspaces. A self-hosted instance has exactly one: the local user (there is no sign-in).</summary>
public partial class User
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Top organization layer: one brand / store / client. All content lives in a workspace.</summary>
public class Workspace
{
    public string Id { get; set; } = "";

    [JsonIgnore]
    public string OwnerId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
