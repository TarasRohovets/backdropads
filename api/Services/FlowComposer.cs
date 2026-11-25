using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;

namespace BackdropAds.Api.Services;

/// <summary>One image (or video) the user asked for: a short name, the prompt for the model, and which attached photo it builds on (1-based).</summary>
public sealed record ComposedItem(string Title, string Prompt, int? Photo = null);

/// <summary>The plan for a flow: its name, image or video, the size, and one item per output.</summary>
public sealed record ComposedFlow(string Name, string Mode, string Ratio, List<ComposedItem> Items, bool ByAi, string? Model = null, decimal CostUsd = 0);

/// <summary>
/// "Create with AI" in Flows: turns one message ("3 Instagram images of my candle: cosy at home, as a gift, 20% off")
/// into separate outputs, each with its own prompt written the way image and video models read best. Claude writes it;
/// without Claude (demo mode, no key, or a failure) the message is split by hand instead.
/// </summary>
public partial class FlowComposer(ClaudeText claude, ILogger<FlowComposer> logger)
{
    public const int MaxImages = 6;
    public const int MaxVideos = 2;
    private const string FallbackBeta = "server-side-fallback-2026-07-01";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] Ratios = ["4:5", "1:1", "9:16", "16:9", "2:3"];

    private static readonly string Instructions =
        "You plan a batch of ads. The user describes, in their own words, the images or videos they want. Split the request " +
        "into separate outputs and write one prompt per output for an AI image or video model.\n\n" +
        "Deciding the outputs:\n" +
        $"- Make exactly as many as the user asks for, at most {MaxImages} images or {MaxVideos} videos. If they list ideas " +
        "without a number, make one per idea. If they give a number and fewer ideas, add distinct ideas that fit what they want " +
        "(a different setting, angle, moment or offer each), never near-copies. With no number and no list, make 3.\n" +
        "- mode is \"video\" only when they ask for video, a clip, a reel or a TikTok; otherwise \"image\".\n" +
        "- ratio: 9:16 for stories, reels, TikTok and vertical video; 1:1 for square; 16:9 for YouTube, landscape or banners; " +
        "2:3 for Pinterest; 4:5 for Instagram or Facebook feed and when nothing is said (9:16 for video).\n\n" +
        "Writing each prompt:\n" +
        "- Keep everything the user asked for that output. Add only concrete visual detail that serves it: subject, setting, " +
        "composition, light, colour, mood, camera, style. For video: a timed shot list (\"0-2s: …\") whose first 2 seconds stop " +
        "the scroll, the camera movement, and an \"Audio:\" line.\n" +
        "- 50 to 120 words, in English (quote any words meant to appear in the ad in the user's language).\n" +
        "- The app adds the headline and button itself: no slogans or prices in the scene; say where clean space for the headline is.\n" +
        "- Never invent facts: no prices, discounts, deadlines, numbers, reviews or claims the user did not give. A discount the " +
        "user names may be shown as text, quoted exactly.\n" +
        "- If the user says there is a product photo, the product comes from it: describe how it is staged and say to keep it " +
        "exactly as in the photo.\n" +
        "- Several photos: they are numbered in the order shown (photo 1, photo 2…). Set \"photo\" on every output to the photo it " +
        "builds on. When the user asks to edit several photos (\"edit these 3 photos…\"), make one output per photo in the same order " +
        "unless they say otherwise, and write each prompt as a concrete edit of that photo: what stays exactly (the product, its " +
        "shape, label and colours) and what changes (background, setting, light, props, mood). Look at each photo and name what is " +
        "in it, so the edit fits that photo.\n" +
        "- No real people's names or likenesses, no other brands' names or logos.\n" +
        "- If a target model is named, write each prompt the way that model follows best (its strengths, how it reads text and references).\n" +
        "- title: 2 to 5 words naming that output. name: 2 to 5 words naming the whole batch (usually the product).\n\n" +
        "Answer with JSON only, no other text: " +
        "{\"name\": string, \"mode\": \"image\" | \"video\", \"ratio\": string, \"items\": [{\"title\": string, \"prompt\": string, \"photo\"?: number}]}";

    private sealed record Answer(string? Name, string? Mode, string? Ratio, List<AnswerItem>? Items);
    private sealed record AnswerItem(string? Title, string? Prompt, int? Photo);

    /// <summary>Plans the flow with `model` (the app's text model when null); falls back to the standard model, then to splitting by hand.</summary>
    /// <param name="forcedMode">"image" or "video" when the user already chose; null = decide from the message.</param>
    /// <param name="targetModelName">The image or video model the prompts are for ("Nano Banana Pro"), when chosen.</param>
    /// <param name="photos">The attached product photos, in order, for Claude to look at (may be fewer than photoCount when some are too big).</param>
    public async Task<ComposedFlow> ComposeAsync(string message, int photoCount, IReadOnlyList<(byte[] Bytes, string MimeType)> photos,
        string? brandName, string? model, CancellationToken ct, string? forcedMode = null, string? targetModelName = null)
    {
        if (claude.Live)
        {
            var spent = 0m;
            foreach (var m in new[] { model ?? claude.Model, claude.Model }.Distinct())
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var (plan, cost) = await AskAsync(message, photoCount, photos, brandName, m, ct, forcedMode, targetModelName);
                    spent += cost;
                    if (plan is not null) return plan with { CostUsd = spent };
                }
                catch (Exception ex) when (ex is AnthropicException or HttpRequestException
                                           || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    logger.LogWarning(ex, "Flow composer ({Model}) failed.", m);
                    claude.Refused(m, ex);
                }
            }
            return Forced(Split(message, photoCount), forcedMode) with { CostUsd = spent };
        }
        return Forced(Split(message, photoCount), forcedMode);
    }

    /// <summary>The user chose image or video: keep to it (prompts keep their wording; the size follows the kind).</summary>
    private static ComposedFlow Forced(ComposedFlow plan, string? mode) =>
        mode is not ("image" or "video") || plan.Mode == mode ? plan
            : plan with { Mode = mode, Ratio = mode == "video" ? "9:16" : "4:5", Items = plan.Items.Take(mode == "video" ? MaxVideos : MaxImages).ToList() };

    private async Task<(ComposedFlow? Plan, decimal Cost)> AskAsync(string message, int photoCount, IReadOnlyList<(byte[] Bytes, string MimeType)> photos,
        string? brandName, string model, CancellationToken ct, string? forcedMode, string? targetModelName)
    {
        var text = new StringBuilder();
        text.AppendLine("WHAT THE USER WANTS").AppendLine(message.Trim());
        if (photoCount == 1) text.AppendLine().AppendLine("Product photo: yes, the user attached a photo of the product (photo 1).");
        else if (photoCount > 1)
            text.AppendLine().AppendLine($"Product photos: {photoCount}, numbered 1 to {photoCount} in the order " +
                                         (photos.Count == photoCount ? "shown above." : "they were attached (some could not be shown)."));
        if (!string.IsNullOrWhiteSpace(brandName)) text.AppendLine($"Brand: {brandName.Trim()}");
        if (forcedMode is "image" or "video") text.AppendLine($"Kind: {forcedMode}s only.");
        if (!string.IsNullOrWhiteSpace(targetModelName)) text.AppendLine($"Target model: {targetModelName.Trim()}");

        var response = await claude.Client.Beta.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 6000,
            System = Instructions,
            OutputConfig = new BetaOutputConfig { Effort = Effort.Low },
            // If Claude's safety checks decline the request, the API retries it on its default fallback model.
            Betas = [FallbackBeta],
            Fallbacks = new Default(),
            Messages = [new BetaUserMessageParam { Content = Content(photos, text.ToString()) }],
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

        var mode = parsed?.Mode == "video" ? "video" : "image";
        var items = (parsed?.Items ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i.Prompt))
            .Take(mode == "video" ? MaxVideos : MaxImages)
            .Select((i, n) => new ComposedItem(Clip(i.Title, 60) is { Length: > 0 } t ? t : $"Ad {n + 1}", Clip(i.Prompt, 2000)!,
                photoCount == 0 ? null : i.Photo is >= 1 && i.Photo <= photoCount ? i.Photo : n % photoCount + 1))
            .ToList();
        if (items.Count == 0) return (null, cost);
        var ratio = Ratios.Contains(parsed!.Ratio) && !(mode == "video" && parsed.Ratio is "4:5" or "2:3") ? parsed.Ratio! : mode == "video" ? "9:16" : "4:5";
        return (Forced(new ComposedFlow(Clip(parsed.Name, 60) is { Length: > 0 } name ? name : TitleFrom(message), mode, ratio, items, true, model, cost), forcedMode), cost);
    }

    /// <summary>The photos first (Claude sees them in order), then the request.</summary>
    private static List<BetaContentBlockParam> Content(IReadOnlyList<(byte[] Bytes, string MimeType)> photos, string text)
    {
        var content = new List<BetaContentBlockParam>();
        for (var i = 0; i < photos.Count; i++)
        {
            content.Add(new BetaTextBlockParam { Text = $"Photo {i + 1}:" });
            content.Add(new BetaImageBlockParam { Source = new BetaBase64ImageSource { Data = Convert.ToBase64String(photos[i].Bytes), MediaType = photos[i].MimeType } });
        }
        content.Add(new BetaTextBlockParam { Text = text });
        return content;
    }

    // ---- Without Claude: split the message by hand --------------------------------------------------------------

    private static readonly Dictionary<string, int> NumberWords = new(StringComparer.OrdinalIgnoreCase)
    {
        ["one"] = 1, ["a"] = 1, ["an"] = 1, ["two"] = 2, ["three"] = 3, ["four"] = 4, ["five"] = 5, ["six"] = 6, ["couple"] = 2, ["few"] = 3,
    };

    // "3 images", "4 square ads", "two short TikTok videos": a number, up to two describing words, then what.
    [GeneratedRegex(@"\b(\d{1,2}|one|two|three|four|five|six|a couple of|a few)\s+(?:[a-z0-9-]+\s+){0,2}?(images?|pictures?|photos?|ads?|creatives?|variations?|versions?|videos?|clips?|reels?)\b", RegexOptions.IgnoreCase)]
    private static partial Regex CountPhrase();

    /// <summary>"3 images that do x, y and z" → three outputs: x, y, z. Lists by line, bullet, comma, "and" or ";".</summary>
    public static ComposedFlow Split(string message, int photoCount)
    {
        var hasPhoto = photoCount > 0;
        var text = message.Trim();
        var count = 0;
        var video = Regex.IsMatch(text, @"\b(videos?|clips?|reels?|tiktoks?)\b", RegexOptions.IgnoreCase);
        var match = CountPhrase().Match(text);
        if (match.Success)
        {
            var word = match.Groups[1].Value.Replace("a couple of", "couple", StringComparison.OrdinalIgnoreCase).Replace("a few", "few", StringComparison.OrdinalIgnoreCase);
            count = int.TryParse(word, out var n) ? n : NumberWords.GetValueOrDefault(word, 0);
            video = Regex.IsMatch(match.Groups[2].Value, "video|clip|reel", RegexOptions.IgnoreCase);
        }
        var max = video ? MaxVideos : MaxImages;

        // What comes after "that / showing / of / :" is the list of ideas; before it is the shared subject.
        var rest = match.Success ? text[(match.Index + match.Length)..] : text;
        var subject = match.Success ? text[..match.Index] : "";
        var lead = Regex.Match(rest, @"^\s*(?:that|which|showing|show|with|of|for|about|:|-)\s*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var listText = lead.Success ? lead.Groups[1].Value : rest;
        // "my candle that show it cosy, as a gift…": the product before "that / showing / :", the ideas after it.
        var split = Regex.Match(listText, @"^(.*?)\s*(?:\b(?:that|which)\s+(?:show|shows|do|does|are|is|have)\b|\bshowing\b|:)\s*(.+)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (split.Success && split.Groups[1].Value.Trim().Length > 0)
        {
            subject = $"{subject} {split.Groups[1].Value}";
            listText = split.Groups[2].Value;
        }
        var parts = Regex.Split(listText, @"\r?\n|;|,\s*(?:and\s+)?|\s+and\s+|\s*•\s*|^\s*[-*\d.)]+\s+", RegexOptions.Multiline)
            .Select(p => Regex.Replace(p, @"^\s*(?:[-*•]|\d+[.)]|one|another|the (?:first|second|third|last)|it|them)\s+", "", RegexOptions.IgnoreCase).Trim(' ', '.', ':'))
            .Where(p => p.Length >= 3)
            .ToList();
        // "Edit these photos" with no number: one per photo.
        if (count == 0) count = parts.Count > 1 ? parts.Count : photoCount > 1 ? photoCount : 3;
        count = Math.Clamp(count, 1, max);
        var shared = Regex.Replace(subject, @"\b(i want|i need|make me|create me|give me|edit these|edit this|edit my|edit|these|this|create|make|generate|please|me)\b", "", RegexOptions.IgnoreCase).Trim(' ', ',', '.', ':');
        if (shared.Length == 0 && parts.Count <= 1) shared = listText.Trim(' ', '.');

        var angles = new[] { "a clean studio scene", "a real-life moment where it is used", "a bold, colourful close-up", "a calm, minimal flat lay", "a dramatic, moody scene", "an outdoor, natural-light scene" };
        var items = new List<ComposedItem>();
        for (var i = 0; i < count; i++)
        {
            var idea = i < parts.Count && parts.Count > 1 ? parts[i] : null;
            var what = string.Join(", ", new[] { shared, idea ?? angles[i % angles.Length] }.Where(s => !string.IsNullOrWhiteSpace(s)));
            var prompt = (video ? $"Short vertical video ad: {what}. 0-2s: an eye-catching moving opening shot; then a slow push-in on the product; final shot holds with space for the headline. Audio: upbeat music, subtle sound effects."
                                : $"Ad photograph: {what}. Clear space in the top third for a headline. Soft directional light, natural shadows, editorial product photography.")
                         + (hasPhoto ? " Keep the product exactly as in the attached photo, same shape, label and colours." : "");
            items.Add(new ComposedItem(TitleFrom(idea ?? (photoCount > 1 ? $"Photo {i % photoCount + 1}" : $"{(video ? "Video" : "Image")} {i + 1}")), prompt,
                photoCount == 0 ? null : i % photoCount + 1));
        }
        var ratio = video ? "9:16" : Regex.IsMatch(text, @"\b(story|stories|reel|tiktok|vertical)\b", RegexOptions.IgnoreCase) ? "9:16"
            : Regex.IsMatch(text, @"\bsquare\b", RegexOptions.IgnoreCase) ? "1:1"
            : Regex.IsMatch(text, @"\b(youtube|landscape|banner)\b", RegexOptions.IgnoreCase) ? "16:9"
            : Regex.IsMatch(text, @"\bpinterest\b", RegexOptions.IgnoreCase) ? "2:3" : "4:5";
        var name = shared.Length > 0 ? TitleFrom(shared) : photoCount > 1 ? $"{photoCount} photo edits" : TitleFrom(text);
        return new ComposedFlow(name, video ? "video" : "image", ratio, items, false);
    }

    private static string TitleFrom(string text)
    {
        var words = text.Split((char[])[' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Take(5);
        var t = string.Join(' ', words).Trim(',', '.', ';', ':');
        if (t.Length > 60) t = t[..60];
        return t.Length == 0 ? "AI flow" : char.ToUpperInvariant(t[0]) + t[1..];
    }

    private static string? Clip(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim().Trim('"');
        return s.Length <= max ? s : s[..max].TrimEnd();
    }
}
