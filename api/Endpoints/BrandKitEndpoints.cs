using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

public static class BrandKitEndpoints
{
    public static IEndpointRouteBuilder MapBrandKitEndpoints(this IEndpointRouteBuilder app)
    {
        // Legacy single-kit routes (the primary kit) — kept for compatibility.
        var group = app.MapGroup("/api/brand-kit").WithTags("Brand kit");

        group.MapGet("/", (AppStore store, IUserContext user) =>
            Results.Ok(store.GetBrandKit(user.WorkspaceId)));

        group.MapPut("/", (BrandKit kit, AppStore store, IUserContext user) =>
            Results.Ok(store.SetBrandKit(user.WorkspaceId, kit)));

        // Multiple kits: the primary kit plus any extras (one per brand/client).
        var kits = app.MapGroup("/api/brand-kits").WithTags("Brand kit");

        kits.MapGet("/", (AppStore store, IUserContext user) =>
            Results.Ok(store.ListBrandKits(user.WorkspaceId)));

        kits.MapPost("/", (CreateBrandKitRequest request, AppStore store, IUserContext user) =>
        {
            if (string.IsNullOrWhiteSpace(request.BrandName))
                return Results.BadRequest(new { error = "Give the brand a name." });

            var kit = new BrandKit { Id = Ids.New("bk"), DefaultCta = "Shop now" };
            Apply(kit, request);
            store.AddBrandKit(user.WorkspaceId, kit);
            return Results.Created($"/api/brand-kits/{kit.Id}", kit);
        });

        kits.MapPut("/{id}", (string id, CreateBrandKitRequest request, AppStore store, IUserContext user) =>
        {
            if (string.IsNullOrWhiteSpace(request.BrandName))
                return Results.BadRequest(new { error = "Give the brand a name." });

            var kit = store.FindBrandKit(user.WorkspaceId, id);
            if (kit is null) return Results.NotFound(new { error = $"Brand kit '{id}' not found." });

            Apply(kit, request);
            if (id == "primary") store.SetBrandKit(user.WorkspaceId, kit);
            return Results.Ok(kit);
        });

        kits.MapDelete("/{id}", (string id, AppStore store, IUserContext user) =>
        {
            if (id == "primary")
                return Results.BadRequest(new { error = "Your default brand kit can't be deleted — edit it instead." });
            return store.RemoveBrandKit(user.WorkspaceId, id)
                ? Results.NoContent()
                : Results.NotFound(new { error = $"Brand kit '{id}' not found." });
        });

        // Scan a website for name, logo, colors, fonts and description. Returns a draft; nothing is saved.
        kits.MapPost("/scan", async (ScanBrandRequest request, BrandScanner scanner, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Url))
                return Results.BadRequest(new { error = "Enter your website address." });
            try
            {
                return Results.Ok(await scanner.ScanAsync(request.Url, ct));
            }
            catch (BrandScanException ex)
            {
                return Results.UnprocessableEntity(new { error = ex.Message });
            }
        }).RequireRateLimiting("auth"); // scans fetch third-party sites — same tight per-IP limit as auth

        return app;
    }

    private static void Apply(BrandKit kit, CreateBrandKitRequest request)
    {
        kit.BrandName = request.BrandName!.Trim();
        kit.LogoUrl = string.IsNullOrWhiteSpace(request.LogoUrl) ? null : request.LogoUrl.Trim();
        kit.Colors = request.Colors is { Count: > 0 } colors
            ? [.. colors.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim().ToUpperInvariant()).Take(6)]
            : kit.Colors.Count > 0 ? kit.Colors : ["#8B5CF6", "#0B0A14"];
        kit.Fonts = request.Fonts is { } fonts ? [.. fonts.Select(f => f?.Trim() ?? "").Take(2)] : kit.Fonts;
        kit.Context = string.IsNullOrWhiteSpace(request.Context) ? null : request.Context.Trim();
        kit.WebsiteUrl = string.IsNullOrWhiteSpace(request.WebsiteUrl) ? kit.WebsiteUrl : request.WebsiteUrl.Trim();
        if (request.Tone is not null) kit.Tone = request.Tone.Trim();
        if (!string.IsNullOrWhiteSpace(request.DefaultCta)) kit.DefaultCta = request.DefaultCta.Trim();
        if (request.Guidelines is not null) kit.Guidelines = string.IsNullOrWhiteSpace(request.Guidelines) ? null : request.Guidelines.Trim();
    }
}
