using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

/// <summary>
/// Folders of saved ads, which can nest: list all (flat, with parentId and ad counts), create (top level or inside
/// another), rename / recolor / move, delete (with its subfolders; ads are always kept in My Ads).
/// </summary>
public static class FolderEndpoints
{
    private const int MaxFolders = 200;
    private const int MaxDepth = 6;
    private const int MaxNameLength = 60;

    public static IEndpointRouteBuilder MapFolderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/folders").WithTags("Folders");

        group.MapGet("/", (AppStore store, IUserContext userContext) =>
        {
            var folders = store.ListFolders(userContext.WorkspaceId, userContext.UserId);
            var counts = store.ListAds(userContext.WorkspaceId)
                .Where(a => a.FolderId is not null)
                .GroupBy(a => a.FolderId!)
                .ToDictionary(g => g.Key, g => g.Count());
            foreach (var f in folders) f.AdCount = counts.GetValueOrDefault(f.Id);
            return Results.Ok(folders);
        });

        group.MapPost("/", (FolderRequest request, AppStore store, IUserContext userContext) =>
        {
            if (CleanName(request.Name) is not { } name)
                return Results.BadRequest(new { error = $"Give the folder a name (up to {MaxNameLength} characters)." });
            var all = store.ListFolders(userContext.WorkspaceId, userContext.UserId);
            if (all.Count >= MaxFolders)
                return Results.BadRequest(new { error = $"That's the limit of {MaxFolders} folders. Delete one first." });

            var parentId = string.IsNullOrWhiteSpace(request.ParentId) ? null : request.ParentId;
            if (parentId is not null)
            {
                if (all.All(f => f.Id != parentId)) return Results.BadRequest(new { error = "That folder doesn't exist any more." });
                if (Depth(all, parentId) >= MaxDepth)
                    return Results.BadRequest(new { error = $"Folders go up to {MaxDepth} levels deep." });
            }
            if (NameTaken(all, parentId, name, null))
                return Results.Conflict(new { error = $"There's already a folder called \"{name}\" here." });

            var siblings = all.Count(f => f.ParentId == parentId);
            var color = request.Color is { } c && FolderColors.All.Contains(c)
                ? c
                : parentId is not null ? all.First(f => f.Id == parentId).Color : FolderColors.All[siblings % FolderColors.All.Length];
            var folder = store.AddFolder(userContext.WorkspaceId, userContext.UserId, parentId, name, color);
            return Results.Created($"/api/folders/{folder.Id}", folder);
        });

        group.MapPut("/{id}", (string id, FolderRequest request, AppStore store, IUserContext userContext) =>
        {
            var all = store.ListFolders(userContext.WorkspaceId, userContext.UserId);
            var folder = all.FirstOrDefault(f => f.Id == id);
            if (folder is null) return Results.NotFound(new { error = "Folder not found." });

            // Move: "" = to the top level; never into itself or one of its own subfolders.
            if (request.ParentId is not null)
            {
                var parentId = request.ParentId.Length == 0 ? null : request.ParentId;
                if (parentId is not null)
                {
                    if (all.All(f => f.Id != parentId)) return Results.BadRequest(new { error = "That folder doesn't exist any more." });
                    if (IsInside(all, parentId, id)) return Results.BadRequest(new { error = "A folder can't go inside itself." });
                    if (Depth(all, parentId) + Height(all, id) > MaxDepth)
                        return Results.BadRequest(new { error = $"Folders go up to {MaxDepth} levels deep." });
                }
                folder.ParentId = parentId;
            }
            if (request.Name is not null)
            {
                if (CleanName(request.Name) is not { } name)
                    return Results.BadRequest(new { error = $"Give the folder a name (up to {MaxNameLength} characters)." });
                folder.Name = name;
            }
            if (NameTaken(all, folder.ParentId, folder.Name, id))
                return Results.Conflict(new { error = $"There's already a folder called \"{folder.Name}\" here." });
            if (request.Color is not null)
            {
                if (!FolderColors.All.Contains(request.Color))
                    return Results.BadRequest(new { error = $"Color must be one of: {string.Join(", ", FolderColors.All)}." });
                folder.Color = request.Color;
            }
            store.UpdateFolder(folder);
            folder.AdCount = store.ListAds(userContext.WorkspaceId).Count(a => a.FolderId == id);
            return Results.Ok(folder);
        });

        group.MapDelete("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.RemoveFolder(id, userContext.WorkspaceId)
                ? Results.NoContent()
                : Results.NotFound(new { error = "Folder not found." }));

        return app;
    }

    /// <summary>Levels from the top down to this folder (a top-level folder is 1).</summary>
    private static int Depth(List<Folder> all, string id)
    {
        var byId = all.ToDictionary(f => f.Id);
        var depth = 0;
        for (var cur = id; cur is not null && byId.TryGetValue(cur, out var f) && depth <= MaxFolders; cur = f.ParentId) depth++;
        return depth;
    }

    /// <summary>Levels from this folder down to its deepest subfolder (no subfolders = 1).</summary>
    private static int Height(List<Folder> all, string id, int guard = 0) =>
        guard > MaxFolders ? 0 : 1 + all.Where(f => f.ParentId == id).Select(f => Height(all, f.Id, guard + 1)).DefaultIfEmpty(0).Max();

    /// <summary>Is `candidate` the folder `id` or somewhere inside it?</summary>
    private static bool IsInside(List<Folder> all, string candidate, string id)
    {
        var byId = all.ToDictionary(f => f.Id);
        var steps = 0;
        for (var cur = candidate; cur is not null && steps++ <= MaxFolders; cur = byId.TryGetValue(cur, out var f) ? f.ParentId : null)
            if (cur == id) return true;
        return false;
    }

    private static bool NameTaken(List<Folder> all, string? parentId, string name, string? exceptId) =>
        all.Any(f => f.Id != exceptId && f.ParentId == parentId && string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase));

    private static string? CleanName(string? name)
    {
        var n = string.Join(' ', (name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return n.Length is > 0 and <= MaxNameLength ? n : null;
    }

    /// <summary>"V2", " v 2 ", "2" → "v2"; anything else is kept as typed (trimmed), up to 12 characters.</summary>
    public static string? CleanVersionTag(string tag)
    {
        var t = tag.Trim();
        if (t.Length == 0) return null;
        var digits = t.TrimStart('v', 'V').Trim();
        if (digits.Length > 0 && digits.All(char.IsDigit) && digits.Length <= 4) return "v" + int.Parse(digits);
        return t.Length <= 12 ? t : null;
    }
}
