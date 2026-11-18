using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;
using BackdropAds.Api.Services.Providers;

namespace BackdropAds.Api.Endpoints;

/// <summary>
/// Products: the hero-image anchors that generations reference (Brand Kit → Products).
/// "Make it my brand" runs the edit chain with the brand kit as the instruction.
/// </summary>
public static class ProductEndpoints
{
    public static IEndpointRouteBuilder MapProductEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/products").WithTags("Products");

        group.MapGet("/", (AppStore store, IUserContext userContext) =>
            Results.Ok(store.ListProducts(userContext.WorkspaceId)));

        group.MapGet("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.GetProduct(id, userContext.WorkspaceId) is { } product
                ? Results.Ok(product)
                : Results.NotFound(new { error = $"Product '{id}' not found." }));

        // Paste-a-product-link: title, description, price and photos from any product page (Shopify first-class).
        group.MapPost("/import", async (ImportProductRequest request, ProductImporter importer, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Url))
                return Results.BadRequest(new { error = "Paste a product link." });
            try
            {
                return Results.Ok(await importer.ImportAsync(request.Url, ct));
            }
            catch (ProductImportException ex)
            {
                return Results.UnprocessableEntity(new { error = ex.Message });
            }
        }).RequireRateLimiting("auth"); // fetches third-party pages — same tight per-IP limit as brand scans

        group.MapPost("/", async (CreateProductRequest request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits, ImageEditRouter editor, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length < 2)
                return Results.BadRequest(new { error = "Give the product a name." });
            if (string.IsNullOrWhiteSpace(request.SourceImageUrl))
                return Results.BadRequest(new { error = "Upload a product or reference image first." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            var name = request.Name.Trim();
            var seed = $"product-{Determinism.Hex($"{userContext.UserId}:{name}:{request.SourceImageUrl}")}";
            var kit = store.GetBrandKit(userContext.WorkspaceId);

            var product = new Product
            {
                Id = Ids.New("prd"),
                UserId = user.Id,
                WorkspaceId = userContext.WorkspaceId,
                Name = name,
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                SourceImageUrl = request.SourceImageUrl,
                HeroImageUrl = request.SourceImageUrl,
                HeroImageSeed = seed,
                Palette = kit.Colors.Count >= 2 ? [.. kit.Colors.Take(2)] : ["#1A1A22", "#101014"],
                CreatedAt = DateTimeOffset.UtcNow,
            };

            if (request.Rebrand)
            {
                var guard = Guards.CheckEdit(http, limits, user);
                if (guard is not null) return guard;

                var brand = string.IsNullOrWhiteSpace(kit.BrandName) ? name : kit.BrandName;
                var colors = kit.Colors.Count > 0 ? string.Join(", ", kit.Colors) : "the brand colors";
                var instruction =
                    $"Replace every label, logo and brand text on the product with the brand \"{brand}\" " +
                    $"using colors {colors}. Keep the product shape, materials, lighting, camera angle and background exactly as they are. " +
                    (string.IsNullOrWhiteSpace(kit.LogoUrl) ? "" : $"Reference logo: {kit.LogoUrl}. ") +
                    (string.IsNullOrWhiteSpace(product.Notes) ? "" : $"Product notes: {product.Notes}.");

                var media = await editor.EditAsync(
                    new EditSpec(request.SourceImageUrl, seed, instruction, "1:1"), cancellationToken);

                if (media.IsFallback)
                {
                    // No edit model could run: keep the product as uploaded.
                    store.AddProduct(product);
                    return Results.Created($"/api/products/{product.Id}", product);
                }

                product.Rebranded = true;
                product.Model = media.Model;
                product.HeroImageSeed = media.ImageSeed ?? seed;
                // Real edit → new hero URL. Mock edit → keep the uploaded image as the hero so the card still shows it.
                product.HeroImageUrl = media.Url ?? request.SourceImageUrl;
            }

            store.AddProduct(product);
            return Results.Created($"/api/products/{product.Id}", product);
        });

        group.MapPut("/{id}", (string id, UpdateProductRequest request, AppStore store, IUserContext userContext) =>
        {
            var product = store.GetProduct(id, userContext.WorkspaceId);
            if (product is null) return Results.NotFound(new { error = $"Product '{id}' not found." });
            if (!string.IsNullOrWhiteSpace(request.Name)) product.Name = request.Name.Trim();
            if (request.Notes is not null) product.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
            return Results.Ok(product);
        });

        group.MapDelete("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.RemoveProduct(id, userContext.WorkspaceId)
                ? Results.NoContent()
                : Results.NotFound(new { error = $"Product '{id}' not found." }));

        return app;
    }
}
