using BackdropAds.Api.Services;
using Dapper;

namespace BackdropAds.Api.Data;

public sealed record ModelUsage(string Id, int Picked7d, int Picked30d, int FellBack30d, int Served7d, int Served30d);

public sealed record UsageTotals(int Images7d, int Videos7d, decimal CostUsd7d, int Images30d, int Videos30d, decimal CostUsd30d);

/// <summary>Read-only usage numbers for Settings (Dapper, plain SQL): what was generated and what it roughly cost.</summary>
public class UsageQueries(DbContext db)
{
    /// <summary>Generated images / videos and their estimated provider cost over the last 7 and 30 days.</summary>
    public async Task<UsageTotals> TotalsAsync()
    {
        await using var conn = db.CreateConnection();
        return await conn.QuerySingleAsync<UsageTotals>("""
            WITH g AS (
                SELECT creative_type, created_at,
                       jsonb_array_length(coalesce(data->'Concepts', '[]'::jsonb)) AS made,
                       coalesce((data->>'EstimatedCostUsd')::numeric, 0) AS cost
                FROM backdropads.generations
                WHERE status = 'Completed' AND created_at >= now() - interval '30 days')
            SELECT
              coalesce(sum(made) FILTER (WHERE creative_type <> 'Video' AND created_at >= now() - interval '7 days'), 0)::int AS images7d,
              coalesce(sum(made) FILTER (WHERE creative_type = 'Video' AND created_at >= now() - interval '7 days'), 0)::int AS videos7d,
              coalesce(sum(cost) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS cost_usd7d,
              coalesce(sum(made) FILTER (WHERE creative_type <> 'Video'), 0)::int AS images30d,
              coalesce(sum(made) FILTER (WHERE creative_type = 'Video'), 0)::int AS videos30d,
              coalesce(sum(cost), 0) AS cost_usd30d
            FROM g
            """);
    }

    /// <summary>Completed generations per model (30 days): picked, served, and how often a pick fell back.</summary>
    public async Task<List<ModelUsage>> ByModelAsync(IReadOnlyList<ModelProbe> probes)
    {
        await using var conn = db.CreateConnection();
        var rows = (await conn.QueryAsync<UsageRow>("""
            SELECT g.data->>'Model' AS requested, c->>'Model' AS served,
                   (g.created_at >= now() - interval '7 days') AS recent, count(*)::int AS n
            FROM backdropads.generations g CROSS JOIN LATERAL jsonb_array_elements(g.data->'Concepts') c
            WHERE g.status = 'Completed' AND g.created_at >= now() - interval '30 days'
            GROUP BY 1, 2, 3
            """)).ToList();

        // A concept records either our catalog id or the provider's model id — both count as "this model".
        bool Is(ModelProbe p, string? value) =>
            string.Equals(value, p.Id, StringComparison.OrdinalIgnoreCase) || string.Equals(value, p.ProviderModelId, StringComparison.OrdinalIgnoreCase);

        return [.. probes.Select(p => new ModelUsage(
            p.Id,
            Picked7d: rows.Where(r => r.Recent && Is(p, r.Requested)).Sum(r => r.N),
            Picked30d: rows.Where(r => Is(p, r.Requested)).Sum(r => r.N),
            FellBack30d: rows.Where(r => Is(p, r.Requested) && !Is(p, r.Served)).Sum(r => r.N),
            Served7d: rows.Where(r => r.Recent && Is(p, r.Served)).Sum(r => r.N),
            Served30d: rows.Where(r => Is(p, r.Served)).Sum(r => r.N)))];
    }

    private sealed class UsageRow
    {
        public string? Requested { get; set; }
        public string? Served { get; set; }
        public bool Recent { get; set; }
        public int N { get; set; }
    }
}
