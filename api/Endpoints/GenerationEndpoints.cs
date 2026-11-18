using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;
using BackdropAds.Api.Services.Providers;

namespace BackdropAds.Api.Endpoints;

public static class GenerationEndpoints
{
    public static IEndpointRouteBuilder MapGenerationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/generations").WithTags("Generations");

        group.MapPost("/", (CreateGenerationRequest request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits, MediaStore media) =>
        {
            if (request.Brief is null)
                return Results.BadRequest(new { error = "A brief is required." });

            if (!Taxonomy.TryValidate(request.Platform, request.Placement, request.CreativeType,
                    out var aspectRatio, out var error))
                return Results.BadRequest(new { error });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            // Product anchor: the hero image becomes the reference; name/notes fill brief gaps.
            Product? product = null;
            if (!string.IsNullOrWhiteSpace(request.ProductId))
            {
                product = store.GetProduct(request.ProductId, userContext.WorkspaceId);
                if (product is null)
                    return Results.NotFound(new { error = $"Product '{request.ProductId}' not found." });
                if (string.IsNullOrWhiteSpace(request.Brief.ProductName)) request.Brief.ProductName = product.Name;
                if (string.IsNullOrWhiteSpace(request.Brief.ProductDescription)) request.Brief.ProductDescription = product.Notes;
                if (string.IsNullOrWhiteSpace(request.Brief.ReferenceCreativeUrl)) request.Brief.ReferenceCreativeUrl = product.HeroImageUrl;
            }

            // Reference images: first one is the main photo, the rest follow in order (max 8, no duplicates).
            var references = new[] { request.Brief.ReferenceCreativeUrl }.Concat(request.Brief.ReferenceImageUrls ?? [])
                .Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u!.Trim()).Distinct().Take(8).ToList();
            request.Brief.ReferenceCreativeUrl = references.FirstOrDefault();
            request.Brief.ReferenceImageUrls = references.Skip(1).ToList();
            request.Brief.DocumentUrls = (request.Brief.DocumentUrls ?? []).Where(media.IsOwn).Distinct().Take(DocumentReader.MaxDocuments).ToList();
            request.Brief.DocumentNotes = null; // always produced server-side

            BrandKit? brand = null;
            if (!string.Equals(request.BrandKitId, "none", StringComparison.OrdinalIgnoreCase))
            {
                brand = store.FindBrandKit(userContext.WorkspaceId, string.IsNullOrWhiteSpace(request.BrandKitId) ? "primary" : request.BrandKitId);
                if (brand is null)
                    return Results.NotFound(new { error = $"Brand kit '{request.BrandKitId}' not found." });
            }

            var isVideo = request.CreativeType == CreativeType.Video;
            // Video is expensive: 1-2 concepts (default 1). Images/carousels: 1-4 (default 3).
            var conceptCount = Math.Clamp(request.ConceptCount ?? 1, 1, isVideo ? 2 : 4);
            var quality = ModelCatalog.IsHigh(request.Quality) ? "high" : "standard";

            // Model pick: images price per image, video per second (see ModelCatalog).
            var kind = isVideo ? ModelKind.Video : ModelKind.Image;
            var model = string.IsNullOrWhiteSpace(request.Model) ? ModelCatalog.Preferred(kind) : ModelCatalog.Find(kind, request.Model);
            if (model is null)
                return Results.BadRequest(new { error = $"Unknown {(isVideo ? "video" : "image")} model '{request.Model}'." });
            if (model.NeedsImage && string.IsNullOrWhiteSpace(request.Brief.ReferenceCreativeUrl))
                return Results.BadRequest(new { error = $"{model.Name} animates a photo — attach an image of the person or product." });
            var duration = isVideo ? ModelCatalog.Duration(model, request.DurationSeconds) : 0;

            var guard = Guards.CheckGeneration(http, store, limits, user, isVideo);
            if (guard is not null) return guard;

            var generation = store.AddGeneration(new Generation
            {
                Id = Ids.New("gen"),
                UserId = user.Id,
                WorkspaceId = userContext.WorkspaceId,
                Platform = request.Platform,
                Placement = request.Placement,
                CreativeType = request.CreativeType,
                AspectRatio = aspectRatio,
                Brief = request.Brief,
                RoastId = request.RoastId,
                TemplateId = request.TemplateId,
                ConceptCount = conceptCount,
                Quality = quality,
                StyleId = model.Id == "omnihuman" ? request.StyleId ?? "ugc" : request.StyleId,
                Model = model.Id,
                DurationSeconds = isVideo ? duration : null,
                EstimatedCostUsd = ModelCatalog.CostUsd(model, quality, duration, conceptCount),
                ProductId = product?.Id,
                ProductImageSeed = product?.HeroImageSeed,
                ProductPalette = product is null ? null : [.. product.Palette],
                Brand = brand,
                Status = GenerationStatus.Processing,
                CreatedAt = DateTimeOffset.UtcNow,
                Concepts = [],
            });

            return Results.Created($"/api/generations/{generation.Id}", generation);
        });

        group.MapGet("/", (AppStore store, IUserContext userContext) =>
            Results.Ok(store.ListGenerations(userContext.WorkspaceId)));

        group.MapGet("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.GetGeneration(id, userContext.WorkspaceId) is { } generation
                ? Results.Ok(generation)
                : Results.NotFound(new { error = $"Generation '{id}' not found." }));

        // Refine loop: edit one concept with an instruction → a new version appended to the generation.
        group.MapPost("/{id}/concepts/{conceptId}/refine", async (string id, string conceptId, RefineRequest request,
            HttpContext http, AppStore store, IUserContext userContext, RateLimitService limits,
            ImageEditRouter editor, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Instruction) || request.Instruction.Trim().Length < 3)
                return Results.BadRequest(new { error = "Tell us what to change (at least a few words)." });

            var generation = store.GetGeneration(id, userContext.WorkspaceId);
            if (generation is null) return Results.NotFound(new { error = $"Generation '{id}' not found." });
            if (generation.CreativeType == CreativeType.Video)
                return Results.BadRequest(new { error = "Refine works on image and carousel concepts. Regenerate video instead." });

            var source = generation.Concepts.FirstOrDefault(c => c.Id == conceptId);
            if (source is null) return Results.NotFound(new { error = $"Concept '{conceptId}' not found." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            var guard = Guards.CheckEdit(http, limits, user);
            if (guard is not null) return guard;

            var media = await editor.EditAsync(
                new EditSpec(source.MediaUrl, source.ImageSeed, request.Instruction.Trim(), source.AspectRatio),
                cancellationToken);
            if (media.IsFallback)
                return Results.Json(new { error = "No image-edit model is responding right now. Check your API keys in Settings." },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            if (media.Provider != "mock") generation.EstimatedCostUsd += ModelCatalog.EditCostUsd;

            var version = new Concept
            {
                Id = Ids.New("con"),
                GenerationId = generation.Id,
                CreativeType = source.CreativeType,
                AspectRatio = source.AspectRatio,
                Hook = source.Hook,
                PrimaryText = source.PrimaryText,
                CallToAction = source.CallToAction,
                Score = source.Score,
                ImageSeed = media.ImageSeed ?? source.ImageSeed,
                Palette = [.. source.Palette],
                Slides = source.Slides,
                Model = media.Model,
                MediaUrl = media.Url ?? (media.ImageSeed is null ? source.MediaUrl : null),
                ParentConceptId = source.Id,
                Version = source.Version + 1,
                EditInstruction = request.Instruction.Trim(),
            };
            generation.Concepts.Add(version);

            return Results.Created($"/api/generations/{generation.Id}", version);
        });

        group.MapPost("/{id}/regenerate", (string id, [Microsoft.AspNetCore.Mvc.FromBody] RegenerateRequest? request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits) =>
        {
            var source = store.GetGeneration(id, userContext.WorkspaceId);
            if (source is null)
                return Results.NotFound(new { error = $"Generation '{id}' not found." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            // Regenerate = the same generation again (same length, quality) — with the same model, or another one
            // (`model`, e.g. the suggestion after a failure).
            var isVideo = source.CreativeType == CreativeType.Video;
            var kind = isVideo ? ModelKind.Video : ModelKind.Image;
            var model = string.IsNullOrWhiteSpace(request?.Model)
                ? ModelCatalog.Find(kind, source.Model) ?? ModelCatalog.Default(kind)
                : ModelCatalog.Find(kind, request.Model);
            if (model is null)
                return Results.BadRequest(new { error = $"Unknown {(isVideo ? "video" : "image")} model '{request?.Model}'." });
            if (model.NeedsImage && string.IsNullOrWhiteSpace(source.Brief.ReferenceCreativeUrl))
                return Results.BadRequest(new { error = $"{model.Name} animates a photo — this generation has none." });
            var duration = isVideo ? ModelCatalog.Duration(model, source.DurationSeconds) : 0;
            var guard = Guards.CheckGeneration(http, store, limits, user, isVideo);
            if (guard is not null) return guard;

            var generation = store.AddGeneration(new Generation
            {
                Id = Ids.New("gen"),
                UserId = user.Id,
                WorkspaceId = userContext.WorkspaceId,
                Platform = source.Platform,
                Placement = source.Placement,
                CreativeType = source.CreativeType,
                AspectRatio = source.AspectRatio,
                Brief = source.Brief,
                RoastId = source.RoastId,
                TemplateId = source.TemplateId,
                ConceptCount = source.ConceptCount,
                Quality = source.Quality,
                StyleId = source.StyleId,
                Model = model.Id,
                DurationSeconds = isVideo ? duration : null,
                EstimatedCostUsd = ModelCatalog.CostUsd(model, source.Quality, duration, source.ConceptCount),
                ProductId = source.ProductId,
                ProductImageSeed = source.ProductImageSeed,
                ProductPalette = source.ProductPalette,
                Brand = source.Brand,
                Status = GenerationStatus.Processing,
                CreatedAt = DateTimeOffset.UtcNow,
                Concepts = [],
            });

            return Results.Created($"/api/generations/{generation.Id}", generation);
        });

        // Delete one generated image/video (one version). Later versions move up to its parent; the generation goes when
        // its last concept does. The file is deleted unless something else (a saved ad, a flow…) still uses it.
        group.MapDelete("/{id}/concepts/{conceptId}", async (string id, string conceptId, AppStore store, MediaStore media,
            IUserContext userContext, CancellationToken ct) =>
        {
            var generation = store.GetGeneration(id, userContext.WorkspaceId);
            if (generation is null) return Results.NotFound(new { error = $"Generation '{id}' not found." });
            if (generation.Status == GenerationStatus.Processing)
                return Results.Conflict(new { error = "Still generating — try again when it's done." });
            var concept = generation.Concepts.FirstOrDefault(c => c.Id == conceptId);
            if (concept is null) return Results.NotFound(new { error = $"Concept '{conceptId}' not found." });

            generation.Concepts.Remove(concept);
            foreach (var child in generation.Concepts.Where(c => c.ParentConceptId == concept.Id))
                child.ParentConceptId = concept.ParentConceptId;
            var generationDeleted = generation.Concepts.Count == 0 && store.RemoveGeneration(id, userContext.WorkspaceId);
            store.Save();

            if (!string.IsNullOrWhiteSpace(concept.MediaUrl) && !store.IsMediaReferenced(concept.MediaUrl))
                await media.DeleteAsync(concept.MediaUrl, ct);
            return Results.Ok(new { deleted = conceptId, generationDeleted });
        });

        return app;
    }
}

public sealed record RegenerateRequest(string? Model);
