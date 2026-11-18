using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

public static class RoastEndpoints
{
    private static readonly string[] VideoExtensions = [".mp4", ".mov", ".webm", ".m4v"];

    public static IEndpointRouteBuilder MapRoastEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/roasts").WithTags("Roasts");

        group.MapPost("/", (CreateRoastRequest request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdId) && string.IsNullOrWhiteSpace(request.SourceUrl))
                return Results.BadRequest(new { error = "Provide either adId or sourceUrl." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            string sourceImageSeed;
            bool isVideo;
            if (!string.IsNullOrWhiteSpace(request.AdId))
            {
                var ad = store.GetAd(request.AdId, userContext.WorkspaceId);
                if (ad is null)
                    return Results.NotFound(new { error = $"Ad '{request.AdId}' not found." });
                sourceImageSeed = ad.ImageSeed;
                isVideo = ad.CreativeType == CreativeType.Video;
            }
            else
            {
                sourceImageSeed = $"source-{Determinism.Hex(request.SourceUrl!)}";
                isVideo = VideoExtensions.Any(ext => request.SourceUrl!.Split('?', '#')[0].EndsWith(ext, StringComparison.OrdinalIgnoreCase));
            }

            if (!limits.TryAcquireRoast(userContext.UserId, out var retryAfterSeconds))
                return Guards.TooManyRequests(http, "You've hit the analysis rate limit. Give it a minute.", retryAfterSeconds);

            var roast = store.AddRoast(new Roast
            {
                Id = Ids.New("roast"),
                UserId = userContext.UserId,
                WorkspaceId = userContext.WorkspaceId,
                AdId = string.IsNullOrWhiteSpace(request.AdId) ? null : request.AdId,
                SourceUrl = string.IsNullOrWhiteSpace(request.SourceUrl) ? null : request.SourceUrl,
                SourceImageSeed = sourceImageSeed,
                Platform = request.Platform,
                TargetMarket = request.TargetMarket,
                Language = request.Language,
                Status = GenerationStatus.Processing,
                CreatedAt = DateTimeOffset.UtcNow,
            });

            return Results.Created($"/api/roasts/{roast.Id}", roast);
        });

        group.MapGet("/", (AppStore store, IUserContext userContext) =>
            Results.Ok(store.ListRoasts(userContext.WorkspaceId)));

        group.MapGet("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.GetRoast(id, userContext.WorkspaceId) is { } roast
                ? Results.Ok(roast)
                : Results.NotFound(new { error = $"Roast '{id}' not found." }));

        // Create a new generation prefilled from the roast's recommendations + improved copy.
        group.MapPost("/{id}/improve", (string id, ImproveRequest? request, HttpContext http,
            AppStore store, IUserContext userContext, RateLimitService limits,
            IAdImprovementService improvementService) =>
        {
            var roast = store.GetRoast(id, userContext.WorkspaceId);
            if (roast is null)
                return Results.NotFound(new { error = $"Roast '{id}' not found." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            // Improving requires analysis results; complete on demand if still processing.
            store.EnsureRoastCompleted(roast);

            // Build first: the placement can turn an "image" request into video (e.g. TikTok).
            var sourceAd = roast.AdId is null ? null : store.GetAd(roast.AdId, userContext.WorkspaceId);
            var generation = improvementService.BuildImprovedGeneration(roast, request?.CreativeType, sourceAd);

            // Improve = one rebuilt concept on the Auto model.
            var isVideo = generation.CreativeType == CreativeType.Video;
            var model = ModelCatalog.Default(isVideo ? ModelKind.Video : ModelKind.Image);
            var guard = Guards.CheckGeneration(http, store, limits, user, isVideo);
            if (guard is not null) return guard;

            generation.UserId = userContext.UserId;
            generation.WorkspaceId = userContext.WorkspaceId;
            generation.ConceptCount = 1;
            generation.Model = ModelCatalog.Auto;
            generation.DurationSeconds = isVideo ? model.DefaultDuration : null;
            generation.EstimatedCostUsd = ModelCatalog.CostUsd(model, "standard", isVideo ? model.DefaultDuration : 0, 1);
            store.AddGeneration(generation);

            return Results.Created($"/api/generations/{generation.Id}", generation);
        });

        return app;
    }
}
