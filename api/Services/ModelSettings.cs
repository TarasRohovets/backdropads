using BackdropAds.Api.Data;
using Dapper;

namespace BackdropAds.Api.Services;

/// <summary>
/// A configuration layer on top of appsettings.json and the environment that holds the model versions picked by
/// "Update models". Providers keep reading plain settings (AI:OpenAI:FlareModel, AI:Google:ImageModel, …); a
/// value saved here simply wins, and takes effect immediately — no restart.
/// </summary>
public sealed class ModelSettingsProvider : ConfigurationProvider, IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) => this;

    public void Replace(IEnumerable<KeyValuePair<string, string>> values)
    {
        Data = values.ToDictionary(v => v.Key, v => (string?)v.Value, StringComparer.OrdinalIgnoreCase);
        OnReload();
    }

    public IReadOnlyDictionary<string, string?> Current => new Dictionary<string, string?>(Data, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Stores those overrides in the database (backdropads.model_settings) and keeps the configuration layer in sync.</summary>
public class ModelSettingsStore(DbContext db, ModelSettingsProvider provider)
{
    /// <summary>Display name of a model after an update picked a newer version ("GPT Image 2.7 Flare").</summary>
    public static string NameKey(string modelId) => $"AI:ModelNames:{modelId}";

    public bool HasOverrides => provider.Current.Count > 0;

    public async Task LoadAsync(CancellationToken ct = default)
    {
        await using var conn = db.CreateConnection();
        var rows = await conn.QueryAsync<(string Key, string Value)>(
            new CommandDefinition("SELECT key, value FROM backdropads.model_settings", cancellationToken: ct));
        provider.Replace(rows.Select(r => new KeyValuePair<string, string>(r.Key, r.Value)));
    }

    public async Task SaveAsync(IReadOnlyDictionary<string, string> values, CancellationToken ct = default)
    {
        if (values.Count == 0) return;
        await using var conn = db.CreateConnection();
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        foreach (var (key, value) in values)
            await conn.ExecuteAsync("""
                INSERT INTO backdropads.model_settings (key, value, updated_at) VALUES (@key, @value, @now)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                """, new { key, value, now = DateTimeOffset.UtcNow }, tx);
        await tx.CommitAsync(ct);
        await LoadAsync(ct);
    }

    /// <summary>Back to the versions that ship with the app (appsettings.json / environment).</summary>
    public async Task ClearAsync(CancellationToken ct = default)
    {
        await using var conn = db.CreateConnection();
        await conn.ExecuteAsync(new CommandDefinition("DELETE FROM backdropads.model_settings", cancellationToken: ct));
        await LoadAsync(ct);
    }
}
