using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Endpoints;

public static class TemplateEndpoints
{
    public static IEndpointRouteBuilder MapTemplateEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/templates", (string? platform, string? creativeType, string? category, AppStore store) =>
        {
            IEnumerable<Template> templates = store.ListTemplates();

            if (!string.IsNullOrWhiteSpace(platform))
            {
                if (!Enum.TryParse<Platform>(platform, true, out var p))
                    return Results.BadRequest(new { error = $"Unknown platform '{platform}'." });
                templates = templates.Where(t => t.Platform == p);
            }

            if (!string.IsNullOrWhiteSpace(creativeType))
            {
                if (!Enum.TryParse<CreativeType>(creativeType, true, out var ct))
                    return Results.BadRequest(new { error = $"Unknown creativeType '{creativeType}'." });
                templates = templates.Where(t => t.CreativeType == ct);
            }

            if (!string.IsNullOrWhiteSpace(category))
                templates = templates.Where(t => string.Equals(t.Category, category, StringComparison.OrdinalIgnoreCase));

            return Results.Ok(templates.ToList());
        }).WithTags("Templates");

        return app;
    }
}
