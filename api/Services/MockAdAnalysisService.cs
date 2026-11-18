using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>
/// Fills a roast with deterministic mock analysis: witty, specific, constructive —
/// and stable across reads because everything is derived from the roast id.
/// </summary>
public class MockAdAnalysisService : IAdAnalysisService
{
    /// <summary>{0} = platform display name.</summary>
    private static readonly string[] RoastTexts =
    [
        "Let's start with the hook — or rather, the place where a hook should have been. The first line currently reads like the terms and conditions of a mattress warranty: technically words, emotionally invisible. On {0} you get about 1.3 seconds before the thumb keeps moving, and this creative politely waves it goodbye.\n\nThe visual is carrying the whole team on its back. It's decent — good contrast, clear subject — but it's advertising a vibe, not a product. Nowhere in the first glance do I learn what this does, who it's for, or why today. And the offer? It's hiding in the last line like it's embarrassed to be seen. Offers are the extroverts of ad copy. Let them talk first.\n\nThe good news: the bones are here. The product is photogenic, the tone is right for the audience, and the CTA verb is strong. Fix the opening line, drag the offer into the light, and this goes from scroll-past to screenshot-and-send.",
        "This ad is doing that thing where it introduces itself with its job title. \"Premium quality. Trusted results.\" — so says every ad ever made. On {0}, generic praise is wallpaper; specificity is the doorbell. One concrete number, one real outcome, one line a customer actually said would outperform this entire headline.\n\nVisually, we need to talk about the text overlay. There's a paragraph living on this image, and paragraphs don't survive a feed. The eye gets three to five words for free — everything past that costs attention the ad hasn't earned yet. Meanwhile the CTA is playing hide and seek in the corner, in a color the background almost agrees with.\n\nNone of this is fatal. The audience targeting instinct is clearly right, the product shot is genuinely strong, and there's a real benefit buried in line three that deserves the top slot. Promote it, cut the overlay to one punchy line, give the CTA a color with some self-respect — and re-run it.",
        "Scrolling past this ad, my first thought was: beautiful. My second thought was: no idea what it's selling. That's the whole diagnosis, really — it's dressed for the awards show, not for the checkout. On {0}, pretty gets you a pause; clarity gets you a click. Right now this creative earns the pause and then spends it explaining nothing.\n\nThe copy commits the classic triple-CTA felony: \"Learn more\", \"Shop the collection\", and \"Sign up\" are all waving from the same frame. Three doors, no signage — so people pick the fourth option, which is leaving. And the message wants to be everything at once: aspirational, technical, and playful in a single breath. Pick a lane; the algorithm rewards conviction.\n\nHere's the encouraging part: the palette is on-brand, the platform fit is real, and the underlying offer is genuinely competitive — it's just whispering. One message, one CTA, the offer in the opening line, and this stops being a mood board and starts being an ad.",
    ];

    private static readonly (string Title, string Problem, string Rec, string? Improved)[] RecommendationPool =
    [
        ("Lead with the offer",
         "The discount is buried in the final line, where almost nobody reads.",
         "Move the offer into the first line of the hook so it's the first thing the eye hits.",
         "Get 20% off your first order — this week only."),
        ("Sharpen the hook",
         "The opening line is a category description, not a reason to stop scrolling.",
         "Rewrite the hook around the single most concrete outcome, stated in the customer's words.",
         "Visibly calmer skin in 14 days — or your money back."),
        ("Commit to one CTA",
         "Three competing calls to action split the click and depress conversion on every one of them.",
         "Keep a single CTA and repeat it once at the end of the primary text. Cut the rest.",
         "Shop now"),
        ("Add proof, not adjectives",
         "\"Premium\" and \"trusted\" are claims every competitor also makes; they carry zero information.",
         "Replace one adjective with one number: a rating, a customer count, or a measured result.",
         "Rated 4.8/5 by 12,400+ verified customers."),
        ("Cut the text overlay",
         "The image carries a full paragraph; feeds give you three to five words before the eye bails.",
         "Reduce the overlay to a single line of five words or fewer and move the detail into primary text.",
         null),
        ("Match the platform's native style",
         "The creative looks like a repurposed banner, which platforms and people both scroll past.",
         "Reshoot in a native format for the placement — handheld, vertical, first-frame product-in-hand.",
         null),
    ];

    private static readonly (string Hook, string PrimaryText)[] ImprovedCopyPool =
    [
        ("Get 20% off — and an ad you'd actually stop for.",
         "We rebuilt this creative around one idea: the thing your customers actually buy. One clear promise up top, proof in the middle, a single unmissable CTA at the end. The offer now does the talking from line one."),
        ("One promise. One proof point. One button.",
         "The rewritten version leads with the outcome your audience cares about, backs it with a real number, and ends with a single CTA. Everything that wasn't earning its pixels is gone."),
        ("The same product. An ad that finally sells it.",
         "This version opens on the strongest concrete benefit, moves the offer into the hook, and cuts the overlay to five words. It reads native to the feed instead of interrupting it."),
    ];

    public void CompleteRoast(Roast roast)
    {
        var id = roast.Id;
        var overall = Determinism.Range($"{id}:overall", 42, 68);

        roast.OverallScore = overall;
        roast.Scores = new RoastScores
        {
            Hook = SubScore(id, "hook", overall),
            Visual = SubScore(id, "visual", overall),
            Offer = SubScore(id, "offer", overall),
            Message = SubScore(id, "message", overall),
            Cta = SubScore(id, "cta", overall),
            PlatformFit = SubScore(id, "platformFit", overall),
        };

        var platformName = roast.Platform switch
        {
            Platform.GoogleDisplay => "the Google Display Network",
            Platform.Tiktok => "TikTok",
            Platform.Youtube => "YouTube",
            var p => p.ToString(),
        };
        roast.RoastText = string.Format(RoastTexts[Determinism.Pick($"{id}:text", RoastTexts.Length)], platformName);

        // Pick 3 distinct recommendations, priorities 1-3.
        var start = Determinism.Pick($"{id}:recs", RecommendationPool.Length);
        var step = 1 + Determinism.Pick($"{id}:recstep", 2); // 1 or 2, both coprime-safe walks below
        roast.Recommendations = [];
        for (var i = 0; i < 3; i++)
        {
            var (title, problem, rec, improved) = RecommendationPool[(start + i * step) % RecommendationPool.Length];
            roast.Recommendations.Add(new Recommendation
            {
                Id = $"rec_{Determinism.Hex($"{id}:rec:{i}")}{i}",
                Priority = i + 1,
                Title = title,
                Problem = problem,
                RecommendationText = rec,
                ImprovedText = improved,
            });
        }

        var (hook, primaryText) = ImprovedCopyPool[Determinism.Pick($"{id}:improved", ImprovedCopyPool.Length)];
        roast.Improved = new ImprovedCopy
        {
            Hook = hook,
            PrimaryText = primaryText,
            CallToAction = CopyLibrary.FallbackCtas[Determinism.Pick($"{id}:improvedcta", CopyLibrary.FallbackCtas.Length)],
            ImageSeed = $"improved-{Determinism.Hex($"{id}:improvedimg")}",
            Palette = CopyLibrary.Palette($"{id}:improvedpalette"),
        };

        roast.Status = GenerationStatus.Completed;
    }

    private static int SubScore(string id, string dimension, int overall) =>
        Math.Clamp(overall + Determinism.Range($"{id}:score:{dimension}", -18, 18), 5, 95);
}
