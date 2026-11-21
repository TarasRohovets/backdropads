using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Data;

/// <summary>
/// Starter flows: ready-made pipelines a new flow can begin from. Each one starts from a photo in its first
/// step, so it also works with "Run on photos" (one run per photo). Prompts are plain instructions the user is
/// expected to edit.
/// </summary>
public static class FlowTemplates
{
    public sealed record Step(string Title, string Prompt);

    public sealed record Template(
        string Id,
        string Name,
        string Description,
        Step[] Steps,
        /// <summary>"image" | "video"</summary>
        string Mode,
        string Ratio);

    /// <summary>The empty start: one step, one output.</summary>
    public static readonly Template Blank = new("blank", "Blank", "One step and one output. Build it your way.", [new("Step 1", "")], "image", "4:5");

    public static readonly Template[] All =
    [
        Blank,

        new("product-hero", "Product hero", "A clean studio shot with one bold promise. The always-on ad.",
        [
            new("Clean backdrop", "Keep the product exactly as it is. Remove the background and place it on a clean, softly lit studio backdrop with a gentle shadow."),
            new("Headline", "Add one bold headline about the main benefit at the top and a small call-to-action button at the bottom. Keep the product untouched."),
        ], "image", "4:5"),

        new("lifestyle", "Lifestyle scene", "The product in the moment it is used, without a photoshoot.",
        [
            new("Stage the scene", "Place the product in a real-life setting where it is used, with natural light and a shallow depth of field. Keep its shape, label and colors exactly."),
        ], "image", "4:5"),

        new("offer", "Offer or discount", "A loud, simple ad for a sale, a bundle or a launch price.",
        [
            new("Bold backdrop", "Put the product on a bold single-color background that fits the brand colors. Keep the product exactly as it is."),
            new("Offer", "Add a large offer badge (for example \"20% off this week\") and a clear call-to-action button. Keep the product untouched."),
        ], "image", "1:1"),

        new("review", "Customer review", "Social proof up front: stars and a short quote next to the product.",
        [
            new("Soft scene", "Place the product on a calm, neutral surface with soft daylight. Keep the product exactly as it is."),
            new("Review", "Add a five-star rating and a short customer quote in large, readable type next to the product. Keep the product untouched."),
        ], "image", "4:5"),

        new("product-video", "Product video", "A short vertical clip that starts from a strong first frame.",
        [
            new("First frame", "Place the product on a clean surface with dramatic side lighting, as the opening frame of a video. Keep the product exactly as it is."),
        ], "video", "9:16"),
    ];

    public static Template? Find(string? id) =>
        string.IsNullOrWhiteSpace(id) ? null : All.FirstOrDefault(t => string.Equals(t.Id, id.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>The cards and arrows of a new flow made from this template: steps left to right, then the output.</summary>
    public static (List<FlowNode> Nodes, List<FlowEdge> Edges) Build(Template template)
    {
        var nodes = new List<FlowNode>();
        var edges = new List<FlowEdge>();
        for (var i = 0; i < template.Steps.Length; i++)
        {
            var step = template.Steps[i];
            nodes.Add(new FlowNode
            {
                Id = Ids.New("step"),
                Type = "prompt",
                Position = new FlowPosition { X = i * 380, Y = 80 },
                Data = new FlowStepData { Kind = "prompt", Title = step.Title, Prompt = step.Prompt, Attachments = [], UsePrevious = i > 0 },
            });
            if (i > 0) edges.Add(new FlowEdge { Id = Ids.New("e"), Source = nodes[i - 1].Id, Target = nodes[i].Id });
        }

        var isVideo = template.Mode == "video";
        var output = new FlowNode
        {
            Id = Ids.New("out"),
            Type = "output",
            Position = new FlowPosition { X = template.Steps.Length * 380, Y = 60 },
            Data = new FlowStepData
            {
                Kind = "output", Title = "Output", Mode = template.Mode, Ratio = template.Ratio, Count = 1, Quality = "standard",
                BrandKitId = "primary", Model = isVideo ? ModelCatalog.DefaultVideoModel : ModelCatalog.DefaultImageModel,
            },
        };
        edges.Add(new FlowEdge { Id = Ids.New("e"), Source = nodes[^1].Id, Target = output.Id });
        nodes.Add(output);
        return (nodes, edges);
    }
}
