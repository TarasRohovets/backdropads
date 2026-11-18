using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

/// <summary>
/// Workspaces: the top organization layer (one per brand / store / client). Content is scoped to the
/// workspace sent in X-Workspace-Id.
/// </summary>
public static class WorkspaceEndpoints
{
    public static IEndpointRouteBuilder MapWorkspaceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/workspaces").WithTags("Workspaces");

        group.MapGet("/", (IUserContext userContext, AppStore store) =>
        {
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            return Results.Ok(Summary(user, store, userContext.WorkspaceId));
        });

        group.MapPost("/", (WorkspaceRequest request, IUserContext userContext, AppStore store) =>
        {
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            var name = request.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length > 60)
                return Results.BadRequest(new { error = "Give the workspace a name (up to 60 characters)." });

            store.DefaultWorkspace(user.Id); // make sure the first workspace exists

            var workspace = store.AddWorkspace(new Workspace
            {
                Id = Ids.New("ws"),
                OwnerId = user.Id,
                Name = name,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            return Results.Created($"/api/workspaces/{workspace.Id}", workspace);
        });

        group.MapPut("/{id}", (string id, WorkspaceRequest request, IUserContext userContext, AppStore store) =>
        {
            var workspace = store.GetWorkspace(id, userContext.UserId);
            if (workspace is null) return Results.NotFound(new { error = "Workspace not found." });
            var name = request.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length > 60)
                return Results.BadRequest(new { error = "Give the workspace a name (up to 60 characters)." });
            workspace.Name = name;
            return Results.Ok(workspace);
        });

        group.MapDelete("/{id}", (string id, IUserContext userContext, AppStore store) =>
        {
            if (store.GetWorkspace(id, userContext.UserId) is null)
                return Results.NotFound(new { error = "Workspace not found." });
            return store.RemoveWorkspace(id, userContext.UserId)
                ? Results.NoContent()
                : Results.Conflict(new { error = "You need at least one workspace." });
        });

        return app;
    }

    private static object Summary(User user, AppStore store, string currentId) => new
    {
        workspaces = store.ListWorkspaces(user.Id),
        currentId,
        limit = (int?)null, // unlimited
    };
}

public class WorkspaceRequest
{
    public string? Name { get; set; }
}
