using System.Net;
using System.Text.Json;
using Anthropic.Exceptions;
using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using Dapper;

namespace BackdropAds.Api.Services;

/// <summary>One model the app can call, with the provider id it is configured to use.</summary>
public sealed record ModelProbe(
    string Id,
    string Label,
    string Kind,          // image | video | edit | voice | text
    string Provider,      // OpenAI | Google | Anthropic | fal | BytePlus | Kling
    string ProviderModelId,
    bool InAutoChain);

/// <summary>Result of checking one model with its provider.</summary>
public sealed record ModelCheckResult(
    string Id,
    string Label,
    string Kind,
    string Provider,
    string ProviderModelId,
    bool InAutoChain,
    string Status,        // available | unavailable | error | unverified | notConfigured
    string Detail);

public sealed record ModelCheckReport(long Id, DateTimeOffset CheckedAt, string Trigger, int Unavailable, List<ModelCheckResult> Results);

/// <summary>
/// Asks each provider whether the configured model ids still exist (free metadata calls, no generation).
/// Report only: it never changes a model. "Update models" (ModelUpdater) is the separate, manual step that does.
/// </summary>
public class ModelHealthService(
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    DbContext db,
    ClaudeText claude,
    ILogger<ModelHealthService> logger)
{
    private string Cfg(string key, string fallback) => configuration[key] is { Length: > 0 } v ? v : fallback;
    private bool Has(string key) => !string.IsNullOrWhiteSpace(configuration[key]);

    /// <summary>Every model the app is configured to call (the catalog plus the edit and voice models).</summary>
    public List<ModelProbe> Probes()
    {
        var auto = new HashSet<string>(
            new[] { "AI:ImageProviderChain", "AI:VideoProviderChain", "AI:UgcVideoProviderChain", "AI:ImageEditProviderChain" }
                .SelectMany(k => configuration.GetSection(k).Get<string[]>() ?? []),
            StringComparer.OrdinalIgnoreCase);
        ModelProbe P(string id, string label, string kind, string provider, string modelId) =>
            new(id, label, kind, provider, modelId, auto.Contains(id));
        string Fal(string id, string app) => Cfg($"AI:Fal:Apps:{id}", app);
        string Name(string id) => ModelCatalog.DisplayName(configuration, id);

        return
        [
            P("gpt-image-flare", Name("gpt-image-flare"), "image", "OpenAI", Cfg("AI:OpenAI:FlareModel", ModelDefaults.OpenAiFlare)),
            P("gpt-image-sunburst", Name("gpt-image-sunburst"), "image", "OpenAI", Cfg("AI:OpenAI:SunburstModel", ModelDefaults.OpenAiSunburst)),
            P("nano-banana", Name("nano-banana"), "image", "Google", Cfg("AI:Google:ImageModel", ModelDefaults.GoogleImage)),
            P("nano-banana-pro", Name("nano-banana-pro"), "image", "Google", Cfg("AI:Google:ImageProModel", ModelDefaults.GoogleImagePro)),
            P("seedream", Name("seedream"), "image", "fal", Fal("seedream", ModelDefaults.FalSeedream)),
            P("seedream-flash", Name("seedream-flash"), "image", "fal", Fal("seedream-flash", ModelDefaults.FalSeedreamFlash)),
            P("flux", Name("flux"), "image", "fal", Fal("flux", ModelDefaults.FalFlux)),
            P("gpt-image-edit", "GPT Image edit", "edit", "OpenAI", Cfg("AI:OpenAI:EditModel", ModelDefaults.OpenAiEdit)),
            P("seedance", Name("seedance"), "video", "BytePlus", Cfg("AI:Seedance:Model", ModelDefaults.Seedance)),
            P("seedance-flash", Name("seedance-flash"), "video", "BytePlus", Cfg("AI:Seedance:FlashModel", ModelDefaults.SeedanceFlash)),
            P("gemini-omni-flash", Name("gemini-omni-flash"), "video", "Google", Cfg("AI:Google:VideoModel", ModelDefaults.GoogleVideo)),
            P("kling", Name("kling"), "video", "Kling", Cfg("AI:Kling:Model", ModelDefaults.Kling)),
            P("wan", Name("wan"), "video", "fal", Fal("wan", ModelDefaults.FalWan)),
            P("omnihuman", Name("omnihuman"), "video", "fal", Fal("omnihuman", ModelDefaults.FalOmniHuman)),
            P("tts", "Voiceover (TTS)", "voice", "OpenAI", Cfg("AI:OpenAI:TtsModel", ModelDefaults.OpenAiTts)),
            P("document-reader", "Document reader (Claude)", "text", "Anthropic", claude.Model),
        ];
    }

    public async Task<ModelCheckReport> RunAsync(string trigger, CancellationToken ct = default)
    {
        var results = await Task.WhenAll(Probes().Select(p => CheckAsync(p, ct)));
        var unavailable = results.Count(r => r.Status is "unavailable" or "error");

        await using var conn = db.CreateConnection();
        var checkedAt = DateTimeOffset.UtcNow;
        var id = await conn.ExecuteScalarAsync<long>("""
            INSERT INTO backdropads.model_checks (checked_at, trigger, unavailable, results)
            VALUES (@checkedAt, @trigger, @unavailable, CAST(@results AS jsonb)) RETURNING id
            """, new { checkedAt, trigger, unavailable, results = JsonColumns.Serialize(results) });
        var report = new ModelCheckReport(id, checkedAt, trigger, unavailable, [.. results]);
        logger.LogInformation("Model check ({Trigger}): {Unavailable} of {Total} models need attention.", trigger, unavailable, results.Length);

        return report;
    }

    public async Task<ModelCheckReport?> LatestAsync(CancellationToken ct = default)
    {
        await using var conn = db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync<ReportRow>(new CommandDefinition("""
            SELECT id, checked_at, trigger, unavailable, results::text AS results FROM backdropads.model_checks
            ORDER BY checked_at DESC LIMIT 1
            """, cancellationToken: ct));
        return row is null ? null
            : new ModelCheckReport(row.Id, row.CheckedAt, row.Trigger, row.Unavailable, JsonColumns.Deserialize<List<ModelCheckResult>>(row.Results));
    }

    private sealed class ReportRow
    {
        public long Id { get; set; }
        public DateTimeOffset CheckedAt { get; set; }
        public string Trigger { get; set; } = "";
        public int Unavailable { get; set; }
        public string Results { get; set; } = "[]";
    }

    private async Task<ModelCheckResult> CheckAsync(ModelProbe p, CancellationToken ct)
    {
        ModelCheckResult R(string status, string detail) =>
            new(p.Id, p.Label, p.Kind, p.Provider, p.ProviderModelId, p.InAutoChain, status, detail);
        try
        {
            switch (p.Provider)
            {
                case "OpenAI":
                    if (!Has("AI:OpenAI:ApiKey")) return R("notConfigured", "OPENAI_API_KEY is not set");
                    return await LookupAsync(R, $"https://api.openai.com/v1/models/{Uri.EscapeDataString(p.ProviderModelId)}",
                        ("Authorization", $"Bearer {configuration["AI:OpenAI:ApiKey"]}"), ct);

                case "Google":
                    if (!Has("AI:Google:ApiKey")) return R("notConfigured", "GOOGLE_API_KEY is not set");
                    return await LookupAsync(R, $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(p.ProviderModelId)}",
                        ("x-goog-api-key", configuration["AI:Google:ApiKey"]!), ct);

                case "Anthropic":
                    if (!claude.HasKey) return R("notConfigured", "ANTHROPIC_API_KEY is not set");
                    try
                    {
                        await claude.Client.Models.Retrieve(p.ProviderModelId, cancellationToken: ct);
                        return R("available", "Listed by the provider");
                    }
                    catch (AnthropicNotFoundException) { return R("unavailable", "The provider no longer lists this model id"); }
                    catch (AnthropicUnauthorizedException) { return R("error", "API key rejected (401)"); }
                    catch (AnthropicForbiddenException) { return R("error", "API key rejected (403)"); }
                    catch (AnthropicApiException ex) { return R("error", $"Provider answered {(int)ex.StatusCode}"); }
                    catch (AnthropicIOException ex) { return R("error", $"Provider unreachable: {ex.Message}"); }

                case "fal":
                    if (!Has("AI:Fal:ApiKey")) return R("notConfigured", "FAL_API_KEY is not set");
                    return await FalAsync(R, p.ProviderModelId, ct);

                case "BytePlus":
                    return Has("AI:Seedance:ApiKey")
                        ? R("unverified", "BytePlus has no model lookup — check our usage numbers and the ModelArk changelog")
                        : R("notConfigured", "SEEDANCE_API_KEY is not set");

                case "Kling":
                    return Has("AI:Kling:ApiKey") || (Has("AI:Kling:AccessKey") && Has("AI:Kling:SecretKey"))
                        ? R("unverified", "Kling has no model lookup — check our usage numbers and Kling's changelog")
                        : R("notConfigured", "KLING_ACCESS_KEY / KLING_SECRET_KEY are not set");
            }
            return R("unverified", "No check for this provider");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return R("error", $"Provider unreachable: {ex.Message}");
        }
    }

    private HttpClient Client()
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(20);
        return client;
    }

    /// <summary>GET a model by id: 200 = exists, 404 = gone, 401/403 = key problem.</summary>
    private async Task<ModelCheckResult> LookupAsync(Func<string, string, ModelCheckResult> r, string url, (string Name, string Value) auth, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation(auth.Name, auth.Value);
        using var response = await Client().SendAsync(request, ct);
        return response.StatusCode switch
        {
            HttpStatusCode.OK => r("available", "Listed by the provider"),
            HttpStatusCode.NotFound => r("unavailable", "The provider no longer lists this model id"),
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => r("error", $"API key rejected ({(int)response.StatusCode})"),
            _ => r("error", $"Provider answered {(int)response.StatusCode}"),
        };
    }

    /// <summary>fal model search: https://api.fal.ai/v1/models?endpoint_id=… → metadata.status active | deprecated.</summary>
    private async Task<ModelCheckResult> FalAsync(Func<string, string, ModelCheckResult> r, string app, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.fal.ai/v1/models?endpoint_id={Uri.EscapeDataString(app)}");
        request.Headers.TryAddWithoutValidation("Authorization", $"Key {configuration["AI:Fal:ApiKey"]}");
        using var response = await Client().SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return r("error", $"API key rejected ({(int)response.StatusCode})");
        if (!response.IsSuccessStatusCode) return r("error", $"fal answered {(int)response.StatusCode}");

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var model = doc.RootElement.TryGetProperty("models", out var models)
            ? models.EnumerateArray().FirstOrDefault(m => m.TryGetProperty("endpoint_id", out var e) && e.GetString() == app)
            : default;
        if (model.ValueKind != JsonValueKind.Object) return r("unavailable", "fal doesn't list this endpoint any more");
        var status = model.TryGetProperty("metadata", out var meta) && meta.TryGetProperty("status", out var s) ? s.GetString() : null;
        return status == "deprecated"
            ? r("unavailable", "fal marks this endpoint as deprecated")
            : r("available", "Active on fal");
    }
}

/// <summary>
/// Runs the model check once a week. Checks hourly whether the last report is older than 7 days, so restarts and
/// deploys never skip or repeat a week; a Postgres advisory lock keeps it to one instance.
/// </summary>
public class ModelCheckJob(IServiceScopeFactory scopes, DbContext db, ILogger<ModelCheckJob> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromDays(7);
    private const long LockKey = 7_311_002; // arbitrary, unique to this job

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); // let startup finish
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await RunIfDueAsync(stoppingToken); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested) { logger.LogWarning(ex, "Weekly model check failed."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunIfDueAsync(CancellationToken ct)
    {
        await using var conn = db.CreateConnection();
        await conn.OpenAsync(ct);
        if (!await conn.ExecuteScalarAsync<bool>("SELECT pg_try_advisory_lock(@LockKey)", new { LockKey })) return;
        try
        {
            var last = await conn.ExecuteScalarAsync<DateTimeOffset?>(
                "SELECT max(checked_at) FROM backdropads.model_checks WHERE trigger = 'weekly'");
            if (last is { } at && DateTimeOffset.UtcNow - at < Interval) return;

            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ModelHealthService>().RunAsync("weekly", ct);
        }
        finally
        {
            await conn.ExecuteAsync("SELECT pg_advisory_unlock(@LockKey)", new { LockKey });
        }
    }
}
