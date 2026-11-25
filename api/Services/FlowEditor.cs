using System.Text;
using System.Text.Json;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>One card as AI returns it: an existing card (id) or a new one (no id), with only what changes.</summary>
public sealed record EditedCard(string? Id, string Title, string Prompt, string? Ratio, int? Count, string? Model);

/// <summary>AI's answer: a short reply and the full list of cards after the change.</summary>
public sealed record FlowEdit(string Reply, List<EditedCard> Cards, bool ByAi, string? Model = null, decimal CostUsd = 0);

/// <summary>
/// The chat inside a flow: "keep the 3 images, but now add x, y, z" → Claude rewrites the cards' prompts (and, when asked,
/// adds or removes images, or changes their size, count or model), in the context of this flow and its chat so far.
/// Without Claude the instruction is added to every card as a note, and the reply says so.
/// </summary>
public class FlowEditor(ClaudeText claude, ILogger<FlowEditor> logger)
{
    public const int MaxCards = 12;
    private const string FallbackBeta = "server-side-fallback-2026-07-01";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] Ratios = ["4:5", "1:1", "9:16", "16:9", "2:3"];

    private static readonly string Instructions =
        "You edit an ad flow for the user. The flow is a set of cards; each output card makes images (or videos) from its prompt, " +
        "and prompt steps feed the cards after them. The user tells you what to change, in their own words.\n\n" +
        "Rules:\n" +
        "- Change only what the user asks. Keep everything else in each card exactly as it is, word for word.\n" +
        "- When they ask for something in all images (\"add x, y, z\"), work it into every relevant prompt naturally, not as an appended list.\n" +
        "- Prompts stay concrete and visual, written for an image or video model, in English (quote words meant to appear in the ad in " +
        "the user's language). The app adds the headline and button itself. Never invent prices, discounts, numbers or claims.\n" +
        $"- To add an image, add a card without an id. To remove one, leave it out (only output cards can be removed; always keep prompt steps). At most {MaxCards} cards.\n" +
        "- ratio (4:5, 1:1, 9:16, 16:9, 2:3), count (images per card, 1 to 4) and model (an id from the list) only when the user asks to change them.\n" +
        "- reply: one or two short sentences saying what you changed, in the user's language. If the request is unclear, change nothing and ask.\n\n" +
        "Answer with JSON only, no other text: " +
        "{\"reply\": string, \"cards\": [{\"id\": string | null, \"title\": string, \"prompt\": string, \"ratio\"?: string, \"count\"?: number, \"model\"?: string}]}";

    private sealed record Answer(string? Reply, List<AnswerCard>? Cards);
    private sealed record AnswerCard(string? Id, string? Title, string? Prompt, string? Ratio, int? Count, string? Model);

    public async Task<FlowEdit> EditAsync(Flow flow, string instruction, string? model, CancellationToken ct)
    {
        if (claude.Live)
        {
            var spent = 0m;
            foreach (var m in new[] { model ?? claude.Model, claude.Model }.Distinct())
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var (edit, cost) = await AskAsync(flow, instruction, m, ct);
                    spent += cost;
                    if (edit is not null) return edit with { CostUsd = spent };
                }
                catch (Exception ex) when (ex is AnthropicException or HttpRequestException
                                           || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    logger.LogWarning(ex, "Flow editor ({Model}) failed.", m);
                    claude.Refused(m, ex);
                }
            }
            return Note(flow, instruction) with { CostUsd = spent };
        }
        return Note(flow, instruction);
    }

    private async Task<(FlowEdit? Edit, decimal Cost)> AskAsync(Flow flow, string instruction, string model, CancellationToken ct)
    {
        var text = new StringBuilder();
        text.AppendLine($"THE FLOW: \"{flow.Name}\"");
        foreach (var n in flow.Nodes)
        {
            var d = n.Data;
            text.AppendLine(n.Type == "output"
                ? $"- id {n.Id} · output card \"{d.Title}\" · {d.Mode} · {d.Ratio} · ×{d.Count ?? 1} · model {d.Model ?? "auto"}" +
                  (flow.Edges.Any(e => e.Target == n.Id) ? " · fed by the steps before it" : "")
                : $"- id {n.Id} · prompt step \"{d.Title}\"");
            if (!string.IsNullOrWhiteSpace(d.Prompt)) text.AppendLine($"  prompt: {d.Prompt.Trim()}");
        }
        if (flow.Edges.Count > 0)
            text.AppendLine("Arrows: " + string.Join(", ", flow.Edges.Select(e => $"{e.Source} → {e.Target}")));
        var kinds = flow.Nodes.Where(n => n.Type == "output").Select(n => n.Data.Mode == "video" ? ModelKind.Video : ModelKind.Image).Distinct().ToList();
        if (kinds.Count == 0) kinds.Add(ModelKind.Image);
        text.AppendLine().AppendLine("MODELS (id: name): " + string.Join("; ",
            ModelCatalog.All.Where(m => kinds.Contains(m.Kind)).Select(m => $"{m.Id}: {m.Name}")));
        var history = flow.Chat.TakeLast(12).ToList();
        if (history.Count > 0)
        {
            text.AppendLine().AppendLine("THE CHAT SO FAR");
            foreach (var t in history) text.AppendLine($"{(t.Role == "user" ? "User" : "You")}: {t.Text}");
        }
        text.AppendLine().AppendLine("WHAT THE USER WANTS NOW").AppendLine(instruction.Trim());

        var response = await claude.Client.Beta.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 12000,
            System = Instructions,
            OutputConfig = new BetaOutputConfig { Effort = Effort.Low },
            // If Claude's safety checks decline the request, the API retries it on its default fallback model.
            Betas = [FallbackBeta],
            Fallbacks = new Default(),
            Messages = [new BetaUserMessageParam { Content = new List<BetaContentBlockParam> { new BetaTextBlockParam { Text = text.ToString() } } }],
        }, ct);
        claude.Spent(model, response.Usage.InputTokens, response.Usage.OutputTokens);
        var cost = ClaudeText.Cost(model, response.Usage.InputTokens, response.Usage.OutputTokens);
        if (response.StopReason == BetaStopReason.Refusal) return (null, cost);

        var answer = string.Concat(response.Content.Select(b => b.TryPickText(out var t) ? t.Text : null));
        var (start, end) = (answer.IndexOf('{'), answer.LastIndexOf('}'));
        if (start < 0 || end <= start) return (null, cost);
        Answer? parsed;
        try { parsed = JsonSerializer.Deserialize<Answer>(answer[start..(end + 1)], Json); }
        catch (JsonException) { return (null, cost); }
        if (parsed?.Cards is null) return (null, cost);

        var cards = parsed.Cards
            .Where(c => !string.IsNullOrWhiteSpace(c.Prompt) || flow.Nodes.Any(n => n.Id == c.Id && n.Type == "prompt"))
            .Take(MaxCards)
            .Select(c => new EditedCard(
                string.IsNullOrWhiteSpace(c.Id) ? null : c.Id.Trim(),
                TextLimits.Cut(c.Title, 80) ?? "",
                TextLimits.Cut(c.Prompt, TextLimits.Prompt) ?? "",
                Ratios.Contains(c.Ratio) ? c.Ratio : null,
                c.Count is >= 1 and <= 4 ? c.Count : null,
                string.IsNullOrWhiteSpace(c.Model) ? null : c.Model.Trim()))
            .ToList();
        var reply = TextLimits.Cut(parsed.Reply, 600) ?? "Done.";
        return (new FlowEdit(reply, cards, true, model, cost), cost);
    }

    /// <summary>Without Claude: the instruction is added to every card's prompt, so the next run uses it.</summary>
    private static FlowEdit Note(Flow flow, string instruction)
    {
        var note = instruction.Trim().TrimEnd('.');
        var cards = flow.Nodes.Select(n => new EditedCard(n.Id, n.Data.Title,
            string.IsNullOrWhiteSpace(n.Data.Prompt) ? n.Data.Prompt ?? "" : $"{n.Data.Prompt.Trim()}\n\nAlso: {note}.", null, null, null)).ToList();
        return new FlowEdit("AI editing is unavailable right now, so your note was added to every card as written.", cards, false);
    }
}
