using BackdropAds.Api.Data;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

/// <summary>
/// Settings → System: which AI providers have a key, whether each model still exists at its provider, updating
/// models to their newest version, and what has been generated. API keys are never returned — only whether each one is set.
/// </summary>
public static class SettingsEndpoints
{
    /// <summary>A provider, the environment variable(s) that hold its key, and what it powers.</summary>
    private sealed record Provider(string Id, string Name, string[] EnvVars, string[] ConfigKeys, string Powers, string KeyUrl);

    private static readonly Provider[] Providers =
    [
        new("google", "Google Gemini API", ["GOOGLE_API_KEY"], ["AI:Google:ApiKey"],
            "Nano Banana, Nano Banana Pro, Gemini Omni video, reading PDFs and text", "https://aistudio.google.com/apikey"),
        new("openai", "OpenAI", ["OPENAI_API_KEY"], ["AI:OpenAI:ApiKey"],
            "GPT Image Flare and Sunburst, image edits, voiceover", "https://platform.openai.com/api-keys"),
        new("seedance", "BytePlus ModelArk", ["SEEDANCE_API_KEY"], ["AI:Seedance:ApiKey"],
            "Seedance video", "https://console.byteplus.com/ark"),
        new("kling", "Kling", ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"], ["AI:Kling:AccessKey", "AI:Kling:SecretKey"],
            "Kling video", "https://app.klingai.com/global/dev"),
        new("fal", "fal", ["FAL_API_KEY"], ["AI:Fal:ApiKey"],
            "Seedream, FLUX, Wan, OmniHuman", "https://fal.ai/dashboard/keys"),
    ];

    public static IEndpointRouteBuilder MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").WithTags("Settings");

        group.MapGet("/system", async (ModelHealthService health, UsageQueries usage, MediaStore media, ModelSettingsStore modelSettings, IConfiguration configuration) =>
        {
            var probes = health.Probes();
            var latest = await health.LatestAsync();
            string[] Chain(string key) => configuration.GetSection(key).Get<string[]>() ?? [];
            return Results.Ok(new
            {
                mockMode = configuration.GetValue("AI:UseMockData", false),
                storage = media.Backend,
                providers = Providers.Select(p => new
                {
                    p.Id,
                    p.Name,
                    p.EnvVars,
                    p.Powers,
                    p.KeyUrl,
                    configured = p.ConfigKeys.All(k => !string.IsNullOrWhiteSpace(configuration[k])),
                }),
                models = probes,
                // true once "Update models" has moved a model past the version this release ships with.
                modelsUpdated = modelSettings.HasOverrides,
                usage = await usage.ByModelAsync(probes),
                totals = await usage.TotalsAsync(),
                lastCheck = latest,
                // The weekly job runs when the last weekly report is 7 days old (checked hourly).
                nextWeeklyCheckAfter = latest?.CheckedAt.AddDays(7),
                chains = new
                {
                    image = Chain("AI:ImageProviderChain"),
                    imageEdit = Chain("AI:ImageEditProviderChain"),
                    video = Chain("AI:VideoProviderChain"),
                    ugcVideo = Chain("AI:UgcVideoProviderChain"),
                },
            });
        });

        // Run the model check now (free provider metadata calls). Reports only — never switches a model.
        group.MapPost("/models/check", async (ModelHealthService health, CancellationToken ct) =>
            Results.Ok(await health.RunAsync("manual", ct)));

        // "Update models": find the newest version of every model family at its provider (free listing calls),
        // switch the settings to it, then re-run the check so the page shows the new state.
        group.MapPost("/models/update", async (ModelUpdater updater, ModelHealthService health, CancellationToken ct) =>
        {
            var update = await updater.RunAsync(ct);
            var check = await health.RunAsync("manual", ct);
            return Results.Ok(new { update.CheckedAt, update.Changes, update.UpToDate, update.Skipped, unavailable = check.Unavailable });
        });

        // Undo: forget the updated versions and go back to the ones this release ships with.
        group.MapPost("/models/reset", async (ModelSettingsStore modelSettings, ModelHealthService health, CancellationToken ct) =>
        {
            await modelSettings.ClearAsync(ct);
            return Results.Ok(await health.RunAsync("manual", ct));
        });

        return app;
    }
}
