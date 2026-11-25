using System.Text;
using System.Text.Json;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;

namespace BackdropAds.Api.Services;

/// <summary>What the user wants, and where the prompt will be used.</summary>
public sealed record PromptBrief(
    string Idea,
    string Mode,                 // image | video
    string? AspectRatio,
    string? Platform,
    string? ModelName,           // e.g. "Nano Banana Pro", "Veo 3.1"
    int? DurationSeconds,
    string? ProductName,
    bool HasProductPhoto,
    string? BrandName,
    IReadOnlyList<string>? BrandColors,
    string? BrandTone);

/// <summary>The prompt, whether Claude wrote it, which model did, and what the call cost (list price).</summary>
public sealed record WrittenPrompt(string Title, string Prompt, bool ByAi, string? Model = null, decimal CostUsd = 0);

/// <summary>
/// "Improve with AI": turns a rough idea ("cosy autumn ad for my candle") into a prompt written the way image and
/// video models read best: subject, setting, composition, light, camera, style; for video, the shot-by-shot action.
/// Claude writes it; without Claude (demo mode, no key, or a failure) a plain structured version is returned instead.
/// </summary>
public class PromptWriter(ClaudeText claude, ILogger<PromptWriter> logger)
{
    private const string FallbackBeta = "server-side-fallback-2026-07-01";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const string Shared =
        "You write prompts for AI image and video models that make ads. The user tells you, in their own words, the ad they want. " +
        "Rewrite it as one prompt the model will follow well.\n\n" +
        "How to write it:\n" +
        "- Keep everything the user asked for. Add only visual detail that serves it: subject, setting, composition and framing, " +
        "lighting, colour palette, mood, camera and lens, materials and textures, style.\n" +
        "- Be concrete and visual. Write \"soft window light from the left, warm late-afternoon tones\", not \"beautiful lighting\". " +
        "No filler words such as masterpiece, 8k, ultra-detailed, award-winning, trending.\n" +
        "- Plain descriptive sentences, most important first. Write it in English even when the user writes in another language, " +
        "because these models follow English best; keep any words meant to appear in the ad in the user's language, in quotes.\n" +
        "- The app adds the ad's headline and button itself. Do not write ad copy, slogans or prices into the scene. Do say where " +
        "clean space is left for the headline (for example \"clear space in the top third for a headline\").\n" +
        "- Only text the user explicitly asks to show goes in, quoted exactly.\n" +
        "- Never invent facts: no prices, discounts, deadlines, numbers, reviews, awards or health claims the user did not give.\n" +
        "- No real people's names or likenesses, no other brands' names or logos, nothing unsafe.\n" +
        "- If the user says there is a product photo, the product comes from that photo: describe how it is staged " +
        "(placement, scale, surface, props, light on it) and say to keep the product exactly as in the photo, its shape, label and colours.\n" +
        "- Fit the format: mention the aspect ratio's framing (vertical 9:16 fills a phone screen, 1:1 is centred, 16:9 is wide).\n" +
        "- Use the brand's colours and tone when given, as accents in the scene, not as text.\n" +
        "- title: 2 to 6 words naming the prompt, like \"Autumn candle, cosy window\".\n\n" +
        "Answer with JSON only, no other text: {\"title\": string, \"prompt\": string}";

    private const string ImageRules =
        "\n\nThis is for an IMAGE model. Write 60 to 130 words as one paragraph: the shot type and subject first, then setting " +
        "and props, composition and where the headline space is, light, palette and mood, then camera/lens and style " +
        "(for example \"photographed on a 50mm lens, shallow depth of field, editorial product photography\").";

    private const string VideoRules =
        "\n\nThis is for a VIDEO model. Write 80 to 170 words. Start with one line on the look (style, light, palette), then the " +
        "shots in order with rough timing, for example \"0-2s: …\", \"2-5s: …\". The first 2 seconds must stop the scroll: " +
        "motion or a surprising image straight away. For each shot say what moves and how the camera moves (slow push-in, " +
        "handheld, orbit, top-down). Keep it to what fits in the length. Last line: \"Audio:\" with music mood and sound effects " +
        "(no voiceover script unless the user asked for one). Keep space for captions and the headline in the final shot.";

    public bool Live => claude.Live;

    /// <summary>
    /// Writes the prompt with `model` (the app's text model when null). If a premium model fails (an outage, or an
    /// account setting it isn't available under), the standard model writes it instead; without Claude, the structured version.
    /// </summary>
    public async Task<WrittenPrompt> WriteAsync(PromptBrief brief, string? model, CancellationToken ct)
    {
        if (claude.Live)
        {
            var models = new[] { model ?? claude.Model, claude.Model }.Distinct();
            var spent = 0m; // every attempt counts toward the account's cost, including ones that gave nothing usable
            foreach (var m in models)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var (written, cost) = await AskAsync(brief, m, ct);
                    spent += cost;
                    if (written is not null) return written with { CostUsd = spent };
                }
                catch (Exception ex) when (ex is AnthropicException or HttpRequestException or JsonException
                                           || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    logger.LogWarning(ex, "Prompt writer ({Model}) failed.", m);
                    claude.Refused(m, ex);
                }
            }
            return Structured(brief) with { CostUsd = spent };
        }
        return Structured(brief);
    }

    private async Task<(WrittenPrompt? Written, decimal Cost)> AskAsync(PromptBrief brief, string model, CancellationToken ct)
    {
        var video = brief.Mode == "video";
        var text = new StringBuilder();
        void Line(string label, string? value) { if (!string.IsNullOrWhiteSpace(value)) text.AppendLine($"{label}: {value.Trim()}"); }
        text.AppendLine("WHAT THE USER WANTS");
        text.AppendLine(brief.Idea.Trim());
        text.AppendLine().AppendLine("WHERE IT WILL BE USED");
        Line("Kind", video ? "video ad" : "image ad");
        Line("Aspect ratio", brief.AspectRatio);
        Line("Platform", brief.Platform);
        Line("Model", brief.ModelName);
        if (video && brief.DurationSeconds is { } s) Line("Length", $"{s} seconds");
        Line("Product", brief.ProductName);
        Line("Product photo", brief.HasProductPhoto ? "yes, the user attached a photo of the product" : null);
        Line("Brand", brief.BrandName);
        if (brief.BrandColors is { Count: > 0 } colors) Line("Brand colours", string.Join(", ", colors.Take(5)));
        Line("Brand tone", brief.BrandTone);

        var response = await claude.Client.Beta.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 2000,
            System = Shared + (video ? VideoRules : ImageRules),
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
        if (string.IsNullOrWhiteSpace(parsed?.Prompt)) return (null, cost);
        return (new WrittenPrompt(Clip(parsed.Title ?? "", 60) is { Length: > 0 } t2 ? t2 : TitleFrom(brief.Idea), Clip(parsed.Prompt, 2400), true, model, cost), cost);
    }

    private sealed record Answer(string? Title, string? Prompt);

    /// <summary>Without Claude: the idea, laid out in the order image/video models read best.</summary>
    private static WrittenPrompt Structured(PromptBrief brief)
    {
        var idea = brief.Idea.Trim().TrimEnd('.');
        var video = brief.Mode == "video";
        var framing = brief.AspectRatio switch
        {
            "9:16" => "vertical 9:16 framing that fills a phone screen",
            "16:9" => "wide 16:9 framing",
            "1:1" => "centred square 1:1 framing",
            "4:5" => "portrait 4:5 framing for the feed",
            "2:3" => "tall 2:3 framing",
            { Length: > 0 } r => $"{r} framing",
            _ => "balanced framing",
        };
        var parts = new List<string>
        {
            video ? $"Short video ad: {idea}" : $"Ad photograph: {idea}",
            brief.HasProductPhoto ? "The product exactly as in the attached photo, same shape, label and colours, as the hero of the shot" : null!,
            $"{framing}, clear space in the top third for a headline",
            "soft directional light, natural shadows, a clean, considered setting",
            brief.BrandColors is { Count: > 0 } c ? $"accents in {string.Join(", ", c.Take(3))}" : null!,
            brief.BrandTone is { Length: > 0 } tone ? $"mood: {tone.ToLowerInvariant()}" : null!,
            video
                ? "0-2s: an eye-catching moving opening shot; then a slow push-in on the product; final shot holds with space for the headline. Audio: upbeat music, subtle sound effects"
                : "shot on a 50mm lens, shallow depth of field, editorial product photography",
        };
        var sentences = parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => char.ToUpperInvariant(p[0]) + p[1..]);
        return new WrittenPrompt(TitleFrom(brief.Idea), string.Join(". ", sentences) + ".", false);
    }

    private static string TitleFrom(string idea)
    {
        var words = idea.Split((char[])[' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Take(5);
        var t = string.Join(' ', words).Trim(',', '.', ';', ':');
        return t.Length == 0 ? "Untitled prompt" : char.ToUpperInvariant(t[0]) + t[1..];
    }

    private static string Clip(string s, int max)
    {
        s = s.Trim().Trim('"');
        return s.Length <= max ? s : s[..max].TrimEnd();
    }
}
