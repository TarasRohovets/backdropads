using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;
using BackdropAds.Api.Services.Providers;

namespace BackdropAds.Api.Endpoints;

public static class AdEndpoints
{
    public static IEndpointRouteBuilder MapAdEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/ads").WithTags("Ads");

        group.MapGet("/", (string? platform, string? creativeType, string? status, string? search, string? productId, string? folderId,
            AppStore store, IUserContext userContext) =>
        {
            IEnumerable<Ad> ads = store.ListAds(userContext.WorkspaceId);

            if (!string.IsNullOrWhiteSpace(productId))
                ads = ads.Where(a => a.ProductId == productId);

            if (!string.IsNullOrWhiteSpace(folderId))
                ads = ads.Where(a => a.FolderId == folderId);

            if (!string.IsNullOrWhiteSpace(platform))
            {
                if (!Enum.TryParse<Platform>(platform, true, out var p))
                    return Results.BadRequest(new { error = $"Unknown platform '{platform}'." });
                ads = ads.Where(a => a.Platform == p);
            }

            if (!string.IsNullOrWhiteSpace(creativeType))
            {
                if (!Enum.TryParse<CreativeType>(creativeType, true, out var ct))
                    return Results.BadRequest(new { error = $"Unknown creativeType '{creativeType}'." });
                ads = ads.Where(a => a.CreativeType == ct);
            }

            if (!string.IsNullOrWhiteSpace(status))
            {
                if (!Enum.TryParse<AdStatus>(status, true, out var s))
                    return Results.BadRequest(new { error = $"Unknown status '{status}'." });
                ads = ads.Where(a => a.Status == s);
            }

            if (!string.IsNullOrWhiteSpace(search))
                ads = ads.Where(a =>
                    a.Name.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                    a.Hook.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                    a.PrimaryText.Contains(search, StringComparison.OrdinalIgnoreCase));

            return Results.Ok(ads.ToList());
        });

        group.MapGet("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.GetAd(id, userContext.WorkspaceId) is { } ad
                ? Results.Ok(ad)
                : Results.NotFound(new { error = $"Ad '{id}' not found." }));

        // Save a generated concept as an ad.
        group.MapPost("/", (CreateAdRequest request, AppStore store, IUserContext userContext) =>
        {
            if (string.IsNullOrWhiteSpace(request.GenerationId) || string.IsNullOrWhiteSpace(request.ConceptId))
                return Results.BadRequest(new { error = "generationId and conceptId are required." });

            var generation = store.GetGeneration(request.GenerationId, userContext.WorkspaceId);
            if (generation is null)
                return Results.NotFound(new { error = $"Generation '{request.GenerationId}' not found." });

            var concept = generation.Concepts.FirstOrDefault(c => c.Id == request.ConceptId);
            if (concept is null)
                return Results.NotFound(new { error = $"Concept '{request.ConceptId}' not found in generation '{generation.Id}'." });

            var folderId = string.IsNullOrWhiteSpace(request.FolderId) ? null : request.FolderId;
            if (folderId is not null && store.GetFolder(folderId, userContext.WorkspaceId) is null)
                return Results.BadRequest(new { error = "That folder doesn't exist any more." });

            var ad = store.AddAd(new Ad
            {
                Id = Ids.New("ad"),
                UserId = userContext.UserId,
                WorkspaceId = userContext.WorkspaceId,
                Name = string.IsNullOrWhiteSpace(request.Name)
                    ? $"{generation.Brief.ProductName} — {concept.Hook}"
                    : request.Name,
                Platform = generation.Platform,
                Placement = generation.Placement,
                CreativeType = concept.CreativeType,
                AspectRatio = concept.AspectRatio,
                Status = AdStatus.Ready,
                Hook = concept.Hook,
                PrimaryText = concept.PrimaryText,
                CallToAction = concept.CallToAction,
                ImageSeed = concept.ImageSeed,
                Palette = [.. concept.Palette],
                Video = concept.Video,
                Slides = concept.Slides,
                Score = concept.Score,
                MediaUrl = concept.MediaUrl,
                Model = concept.Model,
                ProductId = generation.ProductId,
                FolderId = folderId,
                CreatedAt = DateTimeOffset.UtcNow,
            });

            return Results.Created($"/api/ads/{ad.Id}", ad);
        });

        group.MapPut("/{id}", (string id, UpdateAdRequest request, AppStore store, IUserContext userContext) =>
        {
            var ad = store.GetAd(id, userContext.WorkspaceId);
            if (ad is null)
                return Results.NotFound(new { error = $"Ad '{id}' not found." });

            if (request.Name is not null) ad.Name = TextLimits.Cut(request.Name, TextLimits.Name)!;
            if (request.Hook is not null) ad.Hook = TextLimits.Cut(request.Hook, TextLimits.ShortText)!;
            if (request.PrimaryText is not null) ad.PrimaryText = TextLimits.Cut(request.PrimaryText, 1000)!;
            if (request.CallToAction is not null) ad.CallToAction = TextLimits.Cut(request.CallToAction, 60)!;
            if (request.Palette is not null) ad.Palette = request.Palette;
            if (request.Status is not null) ad.Status = request.Status.Value;

            if (request.FolderId is not null)
            {
                if (request.FolderId.Length == 0) ad.FolderId = null;
                else if (store.GetFolder(request.FolderId, userContext.WorkspaceId) is null)
                    return Results.BadRequest(new { error = "That folder doesn't exist any more." });
                else ad.FolderId = request.FolderId;
            }

            if (request.VersionTag is not null)
            {
                if (request.VersionTag.Trim().Length == 0) ad.VersionTag = null;
                else if (FolderEndpoints.CleanVersionTag(request.VersionTag) is { } tag) ad.VersionTag = tag;
                else return Results.BadRequest(new { error = "Keep the version label short, like v2 (up to 12 characters)." });
            }

            return Results.Ok(ad);
        });

        group.MapPost("/{id}/duplicate", (string id, AppStore store, IUserContext userContext) =>
        {
            var source = store.GetAd(id, userContext.WorkspaceId);
            if (source is null)
                return Results.NotFound(new { error = $"Ad '{id}' not found." });

            var copy = store.AddAd(new Ad
            {
                Id = Ids.New("ad"),
                UserId = userContext.UserId,
                WorkspaceId = userContext.WorkspaceId,
                Name = source.Name + " (copy)",
                Platform = source.Platform,
                Placement = source.Placement,
                CreativeType = source.CreativeType,
                AspectRatio = source.AspectRatio,
                Status = AdStatus.Draft,
                Hook = source.Hook,
                PrimaryText = source.PrimaryText,
                CallToAction = source.CallToAction,
                ImageSeed = source.ImageSeed,
                Palette = [.. source.Palette],
                Video = source.Video,
                Slides = source.Slides,
                Score = source.Score,
                MediaUrl = source.MediaUrl,
                Model = source.Model,
                ProductId = source.ProductId,
                FolderId = source.FolderId,
                CreatedAt = DateTimeOffset.UtcNow,
            });

            return Results.Created($"/api/ads/{copy.Id}", copy);
        });

        // Refine loop on a saved ad: apply an instruction → new current version, history kept.
        group.MapPost("/{id}/refine", async (string id, RefineRequest request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits, ImageEditRouter editor, CancellationToken cancellationToken) =>
        {
            if (request.Instruction is { Length: > TextLimits.Instruction })
                return Results.BadRequest(new { error = $"Keep the change under {TextLimits.Instruction} characters." });
            if (string.IsNullOrWhiteSpace(request.Instruction) || request.Instruction.Trim().Length < 3)
                return Results.BadRequest(new { error = "Tell us what to change (at least a few words)." });

            var ad = store.GetAd(id, userContext.WorkspaceId);
            if (ad is null) return Results.NotFound(new { error = $"Ad '{id}' not found." });
            if (ad.CreativeType == CreativeType.Video)
                return Results.BadRequest(new { error = "Refine works on image and carousel ads. Regenerate video instead." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            var instruction = request.Instruction.Trim();
            var guard = Guards.CheckEdit(http, limits, user);
            if (guard is not null) return guard;

            var media = await editor.EditAsync(new EditSpec(ad.MediaUrl, ad.ImageSeed, instruction, ad.AspectRatio), cancellationToken);
            if (media.IsFallback)
                return Results.Json(new { error = "No image-edit model is responding right now. Check your API keys in Settings." },
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            // First refinement: capture the original as v1 so it can be restored.
            if (ad.Versions.Count == 0)
                ad.Versions.Add(Snapshot(ad, 1, null, ad.CreatedAt));

            var next = ad.Versions.Max(v => v.Version) + 1;
            ad.ImageSeed = media.ImageSeed ?? ad.ImageSeed;
            ad.MediaUrl = media.Url ?? (media.ImageSeed is null ? ad.MediaUrl : null);
            ad.Model = media.Model;
            ad.CurrentVersion = next;
            ad.Versions.Add(Snapshot(ad, next, instruction, DateTimeOffset.UtcNow));

            return Results.Ok(ad);
        });

        // Roll the ad back (or forward) to any saved version.
        group.MapPost("/{id}/versions/{version:int}/restore", (string id, int version, AppStore store, IUserContext userContext) =>
        {
            var ad = store.GetAd(id, userContext.WorkspaceId);
            if (ad is null) return Results.NotFound(new { error = $"Ad '{id}' not found." });

            var target = ad.Versions.FirstOrDefault(v => v.Version == version);
            if (target is null) return Results.NotFound(new { error = $"Version {version} not found." });

            ad.ImageSeed = target.ImageSeed;
            ad.Palette = [.. target.Palette];
            ad.MediaUrl = target.MediaUrl;
            ad.Model = target.Model;
            ad.CurrentVersion = target.Version;
            return Results.Ok(ad);
        });

        group.MapDelete("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.RemoveAd(id, userContext.WorkspaceId)
                ? Results.NoContent()
                : Results.NotFound(new { error = $"Ad '{id}' not found." }));

        return app;
    }

    private static AdVersion Snapshot(Ad ad, int version, string? instruction, DateTimeOffset createdAt) => new()
    {
        Id = Ids.New("ver"),
        Version = version,
        ImageSeed = ad.ImageSeed,
        Palette = [.. ad.Palette],
        MediaUrl = ad.MediaUrl,
        Model = ad.Model,
        EditInstruction = instruction,
        CreatedAt = createdAt,
    };
}
