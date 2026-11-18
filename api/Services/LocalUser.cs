using BackdropAds.Api.Data;

namespace BackdropAds.Api.Services;

/// <summary>
/// There is no sign-in: whoever can open the app is the owner. Every request acts as the instance's one
/// local user (created on first start), in the workspace named by the X-Workspace-Id header.
/// </summary>
public class LocalUserContext(IHttpContextAccessor accessor, AppStore store) : IUserContext
{
    public const string WorkspaceHeader = "X-Workspace-Id";

    /// <summary>Id of the instance's user; set once at startup.</summary>
    public static string LocalUserId { get; set; } = "";

    public string UserId => LocalUserId;

    private string? _workspaceId;

    public string WorkspaceId => _workspaceId ??= Resolve();

    private string Resolve()
    {
        var requested = accessor.HttpContext?.Request.Headers[WorkspaceHeader].ToString();
        var ws = string.IsNullOrWhiteSpace(requested) ? null : store.GetWorkspace(requested, UserId);
        return (ws ?? store.DefaultWorkspace(UserId)).Id;
    }
}
