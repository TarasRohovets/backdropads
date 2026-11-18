using BackdropAds.Api.Domain;
using BackdropAds.Api.Services.Providers;

namespace BackdropAds.Api.Endpoints;

/// <summary>The model menu the composer and flow cards read: every model, its estimated cost, and whether it can run.</summary>
public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/catalog", (ProviderRouter router, IConfiguration configuration) =>
        {
            var mock = configuration.GetValue("AI:UseMockData", false);
            object Model(AiModel m) => new
            {
                id = m.Id,
                // "GPT Image 2.6 Flare" — or the newer version "Update models" switched to.
                name = ModelCatalog.DisplayName(configuration, m.Id, m.Kind),
                vendor = m.Vendor,
                tagline = m.Tagline,
                // Provider list price per image, or per second of video (standard / high quality). An estimate.
                costUsd = m.CostUsd,
                costUsdHigh = m.CostUsdHigh,
                unit = m.Kind == ModelKind.Video ? "second" : "image",
                durations = m.Durations ?? [],
                defaultDuration = m.DefaultDuration,
                tags = m.Tags,
                needsImage = m.NeedsImage,
                acceptsImages = ModelCatalog.AcceptsImages(m),
                // false = its API key isn't set (Settings → API keys shows which one).
                configured = mock || router.IsModelConfigured(m.Kind, m.Id),
            };
            return Results.Ok(new
            {
                models = new
                {
                    image = ModelCatalog.OfKind(ModelKind.Image).Select(Model),
                    video = ModelCatalog.OfKind(ModelKind.Video).Select(Model),
                },
                // Pre-selected in the composer and new flow outputs (AI:DefaultModels).
                defaultModels = new { image = ModelCatalog.DefaultImageModel, video = ModelCatalog.DefaultVideoModel },
                editCostUsd = ModelCatalog.EditCostUsd,
                // Demo mode: nothing is sent to a provider and results are placeholders.
                mockMode = mock,
            });
        }).WithTags("Catalog");

        return app;
    }
}
