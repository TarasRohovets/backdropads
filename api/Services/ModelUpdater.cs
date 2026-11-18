using System.Text.Json;
using System.Text.RegularExpressions;

namespace BackdropAds.Api.Services;

/// <summary>One model that was moved to a newer version.</summary>
public sealed record ModelUpdateChange(string Id, string Label, string Provider, string From, string To);

/// <summary>A provider (or model) the update could not check, and why.</summary>
public sealed record ModelUpdateSkip(string Provider, string Reason);

public sealed record ModelUpdateResult(
    DateTimeOffset CheckedAt, List<ModelUpdateChange> Changes, int UpToDate, List<ModelUpdateSkip> Skipped);

/// <summary>
/// "Update models": asks each provider which models it offers right now (free listing calls, nothing is generated),
/// finds the newest version of every model family the app uses, and saves it as the setting to use from now on.
/// It only ever moves forward inside the same family (GPT Image Flare 2.6 → 2.7, Nano Banana 2.1 → 2.2), or off a
/// version the provider no longer lists. Providers without a listing API (BytePlus, Kling) are reported, not guessed.
/// </summary>
public partial class ModelUpdater(
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    ModelSettingsStore settings,
    ILogger<ModelUpdater> logger)
{
    /// <summary>A model family: where its version is configured and how to recognise its members in a provider's list.</summary>
    private sealed record Family(
        string Id,            // catalog / probe id ("gpt-image-flare"); null-like "" = no display name to keep
        string Label,         // family name without a version ("GPT Image Flare")
        string Provider,      // OpenAI | Google | fal
        string SettingKey,    // AI:OpenAI:FlareModel
        string Default,       // version that ships with the app
        Regex Pattern,        // matches a member; group 1 = version
        bool MatchDisplayName = false,
        string? NameFormat = null,   // "GPT Image {0} Flare"; null = use the provider's own display name
        string? Query = null);       // fal: search term

    private sealed record Listed(string Id, string DisplayName);

    [GeneratedRegex(@"^gpt-image-(\d+(?:\.\d+)?)-flare$")] private static partial Regex OpenAiFlare();
    [GeneratedRegex(@"^gpt-image-(\d+(?:\.\d+)?)-sunburst$")] private static partial Regex OpenAiSunburst();
    [GeneratedRegex(@"^Nano Banana (\d+(?:\.\d+)?)$")] private static partial Regex NanoBanana();
    [GeneratedRegex(@"^gemini-(\d+(?:\.\d+)?)-pro-image$")] private static partial Regex NanoBananaPro();
    [GeneratedRegex(@"^gemini-omni-(\d+(?:\.\d+)?)-flash$")] private static partial Regex OmniFlash();
    [GeneratedRegex(@"^gemini-(\d+(?:\.\d+)?)-flash$")] private static partial Regex GeminiFlash();
    [GeneratedRegex(@"^bytedance/seedream/v(\d+(?:\.\d+)?)(?:/pro)?/text-to-image$")] private static partial Regex Seedream();
    [GeneratedRegex(@"^bytedance/seedream/v(\d+(?:\.\d+)?)/flash/text-to-image$")] private static partial Regex SeedreamFlash();
    [GeneratedRegex(@"^blackforestlabs/flux-(\d+(?:\.\d+)?)/text-to-image$")] private static partial Regex Flux();
    [GeneratedRegex(@"^alibaba/wan-(\d+(?:\.\d+)?)/text-to-video$")] private static partial Regex Wan();
    [GeneratedRegex(@"^bytedance/omnihuman/v(\d+(?:\.\d+)?)$")] private static partial Regex OmniHuman();

    private static readonly Family[] Families =
    [
        new("gpt-image-flare", "GPT Image Flare", "OpenAI", "AI:OpenAI:FlareModel", ModelDefaults.OpenAiFlare, OpenAiFlare(), NameFormat: "GPT Image {0} Flare"),
        new("gpt-image-sunburst", "GPT Image Sunburst", "OpenAI", "AI:OpenAI:SunburstModel", ModelDefaults.OpenAiSunburst, OpenAiSunburst(), NameFormat: "GPT Image {0} Sunburst"),
        new("", "GPT Image edit", "OpenAI", "AI:OpenAI:EditModel", ModelDefaults.OpenAiEdit, OpenAiSunburst()),
        new("nano-banana", "Nano Banana", "Google", "AI:Google:ImageModel", ModelDefaults.GoogleImage, NanoBanana(), MatchDisplayName: true),
        new("nano-banana-pro", "Nano Banana Pro", "Google", "AI:Google:ImageProModel", ModelDefaults.GoogleImagePro, NanoBananaPro(), NameFormat: "Nano Banana Pro"),
        new("gemini-omni-flash", "Gemini Omni Flash", "Google", "AI:Google:VideoModel", ModelDefaults.GoogleVideo, OmniFlash()),
        new("", "Document reader", "Google", "AI:Google:TextModel", ModelDefaults.GoogleText, GeminiFlash()),
        new("seedream", "Seedream", "fal", "AI:Fal:Apps:seedream", ModelDefaults.FalSeedream, Seedream(), NameFormat: "Seedream {0}", Query: "seedream"),
        new("seedream-flash", "Seedream Flash", "fal", "AI:Fal:Apps:seedream-flash", ModelDefaults.FalSeedreamFlash, SeedreamFlash(), NameFormat: "Seedream {0} Flash", Query: "seedream"),
        new("flux", "FLUX", "fal", "AI:Fal:Apps:flux", ModelDefaults.FalFlux, Flux(), NameFormat: "FLUX {0}", Query: "flux"),
        new("wan", "Wan", "fal", "AI:Fal:Apps:wan", ModelDefaults.FalWan, Wan(), NameFormat: "Wan {0}", Query: "wan"),
        new("omnihuman", "OmniHuman", "fal", "AI:Fal:Apps:omnihuman", ModelDefaults.FalOmniHuman, OmniHuman(), NameFormat: "OmniHuman {0}", Query: "omnihuman"),
    ];

    public async Task<ModelUpdateResult> RunAsync(CancellationToken ct = default)
    {
        var changes = new List<ModelUpdateChange>();
        var skipped = new List<ModelUpdateSkip>();
        var save = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var upToDate = 0;

        foreach (var group in Families.GroupBy(f => f.Provider))
        {
            Dictionary<string, List<Listed>> lists; // fal: one list per search term; others: one list under ""
            try
            {
                lists = group.Key switch
                {
                    "OpenAI" => Has("AI:OpenAI:ApiKey") ? new() { [""] = await OpenAiModelsAsync(ct) } : [],
                    "Google" => Has("AI:Google:ApiKey") ? new() { [""] = await GoogleModelsAsync(ct) } : [],
                    _ => Has("AI:Fal:ApiKey") ? await FalModelsAsync(group.Select(f => f.Query!).Distinct(), ct) : [],
                };
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                logger.LogWarning(ex, "Model update: couldn't read the model list from {Provider}.", group.Key);
                skipped.Add(new(group.Key, "Couldn't read its model list right now. Try again later."));
                continue;
            }
            if (lists.Count == 0)
            {
                skipped.Add(new(group.Key, "No API key set, so its models aren't in use."));
                continue;
            }

            foreach (var family in group)
            {
                var listed = lists.GetValueOrDefault(family.Query ?? "") ?? [];
                var current = configuration[family.SettingKey] is { Length: > 0 } v ? v : family.Default;
                var newest = Newest(family, listed);
                if (newest is null) { upToDate++; continue; } // the provider lists nothing of this family: leave it alone

                var (model, version) = newest.Value;
                var currentListed = listed.FirstOrDefault(l => l.Id == current);
                var currentVersion = currentListed is null ? null : VersionOf(family, currentListed);
                // Move only forward, or off a version the provider no longer offers.
                if (model.Id == current || (currentVersion is not null && version <= currentVersion)) { upToDate++; continue; }

                save[family.SettingKey] = model.Id;
                var name = family.NameFormat is null ? model.DisplayName : string.Format(family.NameFormat, Trim(version));
                if (family.Id.Length > 0) save[ModelSettingsStore.NameKey(family.Id)] = name;
                changes.Add(new(family.Id.Length > 0 ? family.Id : family.SettingKey, family.Id.Length > 0 ? name : family.Label, family.Provider, current, model.Id));
            }
        }

        // No listing API: these can only be checked by hand.
        if (Has("AI:Seedance:ApiKey")) skipped.Add(new("BytePlus (Seedance)", "Has no model listing; check the BytePlus console for a newer id."));
        if (Has("AI:Kling:AccessKey") || Has("AI:Kling:ApiKey")) skipped.Add(new("Kling", "Has no model listing; check Kling's developer docs for a newer id."));

        await settings.SaveAsync(save, ct);
        logger.LogInformation("Model update: {Changed} switched to a newer version, {Same} already current.", changes.Count, upToDate);
        return new ModelUpdateResult(DateTimeOffset.UtcNow, changes, upToDate, skipped);
    }

    private bool Has(string key) => !string.IsNullOrWhiteSpace(configuration[key]);

    private static string Trim(Version v) => v.Minor == 0 ? v.Major.ToString() : $"{v.Major}.{v.Minor}";

    private static Version? VersionOf(Family family, Listed model)
    {
        var match = family.Pattern.Match(family.MatchDisplayName ? model.DisplayName : model.Id);
        if (!match.Success) return null;
        var text = match.Groups.Cast<Group>().Skip(1).FirstOrDefault(g => g.Success)?.Value;
        if (text is null) return null;
        return Version.TryParse(text.Contains('.') ? text : text + ".0", out var version) ? version : null;
    }

    private static (Listed Model, Version Version)? Newest(Family family, List<Listed> listed)
    {
        (Listed, Version)? best = null;
        foreach (var model in listed)
        {
            // Previews and experiments come and go; only settle on released versions.
            if (model.Id.Contains("preview", StringComparison.OrdinalIgnoreCase) || model.Id.Contains("-exp", StringComparison.OrdinalIgnoreCase)) continue;
            if (VersionOf(family, model) is not { } version) continue;
            if (best is null || version > best.Value.Item2) best = (model, version);
        }
        return best;
    }

    private HttpClient Client()
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        return client;
    }

    private async Task<JsonDocument> GetAsync(string url, (string Name, string Value)? auth, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (auth is { } a) request.Headers.TryAddWithoutValidation(a.Name, a.Value);
        using var response = await Client().SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
    }

    private async Task<List<Listed>> OpenAiModelsAsync(CancellationToken ct)
    {
        var baseUrl = (configuration["AI:OpenAI:BaseUrl"] is { Length: > 0 } b ? b : "https://api.openai.com/v1").TrimEnd('/');
        using var doc = await GetAsync($"{baseUrl}/models", ("Authorization", $"Bearer {configuration["AI:OpenAI:ApiKey"]}"), ct);
        return [.. doc.RootElement.GetProperty("data").EnumerateArray()
            .Select(m => m.GetProperty("id").GetString() ?? "").Where(id => id.Length > 0).Select(id => new Listed(id, id))];
    }

    private async Task<List<Listed>> GoogleModelsAsync(CancellationToken ct)
    {
        var baseUrl = (configuration["AI:Google:BaseUrl"] is { Length: > 0 } b ? b : "https://generativelanguage.googleapis.com/v1beta").TrimEnd('/');
        using var doc = await GetAsync($"{baseUrl}/models?pageSize=1000", ("x-goog-api-key", configuration["AI:Google:ApiKey"]!), ct);
        var models = new List<Listed>();
        if (!doc.RootElement.TryGetProperty("models", out var list)) return models;
        foreach (var m in list.EnumerateArray())
        {
            var id = (m.GetProperty("name").GetString() ?? "").Replace("models/", "");
            var display = m.TryGetProperty("displayName", out var d) ? d.GetString() ?? id : id;
            if (id.Length > 0) models.Add(new Listed(id, display));
        }
        return models;
    }

    /// <summary>fal's model registry: active endpoints matching each search term.</summary>
    private async Task<Dictionary<string, List<Listed>>> FalModelsAsync(IEnumerable<string> queries, CancellationToken ct)
    {
        var result = new Dictionary<string, List<Listed>>();
        foreach (var query in queries)
        {
            using var doc = await GetAsync($"https://api.fal.ai/v1/models?q={Uri.EscapeDataString(query)}&limit=100",
                ("Authorization", $"Key {configuration["AI:Fal:ApiKey"]}"), ct);
            var models = new List<Listed>();
            if (doc.RootElement.TryGetProperty("models", out var list))
                foreach (var m in list.EnumerateArray())
                {
                    var id = m.TryGetProperty("endpoint_id", out var e) ? e.GetString() ?? "" : "";
                    var meta = m.TryGetProperty("metadata", out var md) ? md : default;
                    var status = meta.ValueKind == JsonValueKind.Object && meta.TryGetProperty("status", out var s) ? s.GetString() : null;
                    if (id.Length > 0 && status != "deprecated") models.Add(new Listed(id, id));
                }
            result[query] = models;
        }
        return result;
    }
}

/// <summary>The model versions that ship with the app — the newest of each family when this release was cut (Nov 2026).</summary>
public static class ModelDefaults
{
    public const string OpenAiFlare = "gpt-image-2.6-flare";
    public const string OpenAiSunburst = "gpt-image-2.6-sunburst";
    public const string OpenAiEdit = "gpt-image-2.6-sunburst";
    public const string OpenAiTts = "gpt-4o-mini-tts";
    public const string GoogleImage = "gemini-nano-banana-2.1";
    public const string GoogleImagePro = "gemini-3-pro-image";
    public const string GoogleVideo = "gemini-omni-1.2-flash";
    public const string GoogleText = "gemini-3.8-flash";
    public const string Seedance = "dreamina-seedance-2-5-260628";
    public const string SeedanceFlash = "dreamina-seedance-2-5-flash-261115";
    public const string Kling = "kling-v3";
    public const string FalSeedream = "bytedance/seedream/v5.5/text-to-image";
    public const string FalSeedreamFlash = "bytedance/seedream/v5/flash/text-to-image";
    public const string FalFlux = "blackforestlabs/flux-3/text-to-image";
    public const string FalWan = "alibaba/wan-3.0/text-to-video";
    public const string FalOmniHuman = "bytedance/omnihuman/v2";
}
