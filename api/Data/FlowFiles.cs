using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Data;

/// <summary>
/// Flows as files: what "Export" writes and "Import" accepts, so a flow can be shared or moved between
/// installs. A file carries the steps, their prompts and the output settings — never attached photos,
/// documents, results or brand kits, which belong to whoever made them.
/// </summary>
public static class FlowFiles
{
    public const string Format = "backdropads-flow";
    public const int MaxNodes = 30;
    public const int MaxEdges = 60;
    public const int MaxPromptLength = 4000;

    private static readonly HashSet<string> ImageRatios = ["1:1", "4:5", "9:16", "2:3"];
    private static readonly HashSet<string> VideoRatios = ["9:16", "1:1", "16:9"];

    // The hosted and the open-source edition name a few models differently; accept either spelling.
    private static readonly (string A, string B)[] ModelAliases =
    [
        ("gpt-image-flare", "gpt-image-2.5"), ("gpt-image-sunburst", "gpt-image-2"), ("nano-banana", "nano-banana-2"),
        ("seedance", "seedance-2.0"), ("seedance-flash", "seedance-2.0-fast"), ("kling", "kling-3.0"),
        ("seedream", "seedream-5"), ("seedream-flash", "seedream-4.5"), ("flux", "flux-2-pro"), ("wan", "wan-2.6"),
        ("omnihuman", "omnihuman-1.5"),
    ];

    public sealed record Imported(string Name, List<FlowNode> Nodes, List<FlowEdge> Edges);

    /// <summary>Checks a flow file and rebuilds it with fresh ids. Error is set (and Flow null) when it can't be used.</summary>
    public static (Imported? Flow, string? Error) Read(string? format, string? name, List<FlowNode>? nodes, List<FlowEdge>? edges)
    {
        if (!string.Equals(format, Format, StringComparison.OrdinalIgnoreCase))
            return (null, "This file is not a BackdropAds flow.");
        if (nodes is not { Count: > 0 }) return (null, "This flow file has no steps.");
        if (nodes.Count > MaxNodes) return (null, $"This flow has more than {MaxNodes} cards.");
        if (nodes.Any(n => n?.Data is null || n.Type is not ("prompt" or "output")))
            return (null, "This flow file has a card this version doesn't understand.");
        if (nodes.Any(n => (n.Data.Prompt?.Length ?? 0) > MaxPromptLength))
            return (null, $"A step's prompt is longer than {MaxPromptLength} characters.");

        var ids = new Dictionary<string, string>();
        var result = new List<FlowNode>();
        foreach (var node in nodes)
        {
            var isOutput = node.Type == "output";
            var id = Ids.New(isOutput ? "out" : "step");
            if (!string.IsNullOrWhiteSpace(node.Id)) ids[node.Id] = id;
            result.Add(new FlowNode
            {
                Id = id,
                Type = node.Type,
                Position = new FlowPosition { X = Math.Clamp(node.Position?.X ?? 0, -20000, 20000), Y = Math.Clamp(node.Position?.Y ?? 0, -20000, 20000) },
                Data = isOutput ? Output(node.Data) : Step(node.Data),
            });
        }

        var links = (edges ?? [])
            .Where(e => e is not null && ids.ContainsKey(e.Source ?? "") && ids.ContainsKey(e.Target ?? "") && e.Source != e.Target)
            .Select(e => (Source: ids[e.Source], Target: ids[e.Target]))
            .Distinct()
            .Take(MaxEdges)
            .Select(e => new FlowEdge { Id = Ids.New("e"), Source = e.Source, Target = e.Target })
            .ToList();

        var title = string.IsNullOrWhiteSpace(name) ? "Imported flow" : name.Trim();
        return (new Imported(title.Length > 80 ? title[..80] : title, result, links), null);
    }

    private static string Short(string? text, string fallback) =>
        string.IsNullOrWhiteSpace(text) ? fallback : text.Trim().Length > 80 ? text.Trim()[..80] : text.Trim();

    private static FlowStepData Step(FlowStepData data) => new()
    {
        Kind = "prompt",
        Title = Short(data.Title, "Step"),
        Prompt = data.Prompt ?? "",
        Attachments = [], // photos and documents stay with their owner
        UsePrevious = data.UsePrevious ?? false,
    };

    private static FlowStepData Output(FlowStepData data)
    {
        var isVideo = data.Mode == "video";
        var ratios = isVideo ? VideoRatios : ImageRatios;
        // A platform target is kept only when it is one this version knows and it takes this kind of ad.
        string? platform = null, placement = null, targetRatio = null;
        if (Services.FlowRunner.TryTarget(data, out var p, out var pl)
            && Taxonomy.TryValidate(p, pl, isVideo ? CreativeType.Video : CreativeType.Image, out var aspect, out _))
        {
            platform = char.ToLowerInvariant(p.ToString()[0]) + p.ToString()[1..];
            placement = char.ToLowerInvariant(pl.ToString()[0]) + pl.ToString()[1..];
            targetRatio = aspect;
        }
        return new FlowStepData
        {
            Kind = "output",
            Title = Short(data.Title, "Output"),
            Prompt = string.IsNullOrWhiteSpace(data.Prompt) ? null : data.Prompt,
            Attachments = [], // photos stay with their owner
            Mode = isVideo ? "video" : "image",
            Ratio = targetRatio ?? (ratios.Contains(data.Ratio ?? "") ? data.Ratio : isVideo ? "9:16" : "4:5"),
            Platform = platform,
            Placement = placement,
            Count = Math.Clamp(data.Count ?? 1, 1, isVideo ? 2 : 6),
            Quality = data.Quality == "high" ? "high" : "standard",
            BrandKitId = string.Equals(data.BrandKitId, "none", StringComparison.OrdinalIgnoreCase) ? "none" : "primary",
            Model = KnownModel(isVideo ? ModelKind.Video : ModelKind.Image, data.Model),
            DurationSeconds = data.DurationSeconds is > 0 and <= 60 ? data.DurationSeconds : null,
        };
    }

    /// <summary>The model id as this install knows it, or null (= this install's default) when it has no such model.</summary>
    private static string? KnownModel(ModelKind kind, string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        if (ModelCatalog.Find(kind, id) is { } exact) return exact.Id;
        foreach (var (a, b) in ModelAliases)
        {
            var other = string.Equals(id, a, StringComparison.OrdinalIgnoreCase) ? b : string.Equals(id, b, StringComparison.OrdinalIgnoreCase) ? a : null;
            if (other is not null && ModelCatalog.Find(kind, other) is { } alias) return alias.Id;
        }
        return null;
    }
}
