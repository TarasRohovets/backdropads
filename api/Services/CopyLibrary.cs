using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>
/// Hand-written mock copy, organized by product vertical, so generated content reads
/// like a real ad platform. Selection is always driven by Determinism.Pick over an
/// entity id, never by Random.
/// </summary>
public static class CopyLibrary
{
    public static readonly string[][] Palettes =
    [
        ["#5B4BC4", "#1B1824"],
        ["#0E7C66", "#F4EFE6"],
        ["#D9483B", "#22252B"],
        ["#1F6FEB", "#0B1220"],
        ["#C2803E", "#241A12"],
        ["#8A4FFF", "#101018"],
        ["#E4572E", "#17223B"],
        ["#2A9D8F", "#264653"],
    ];

    public static readonly string[] FallbackCtas =
        ["Shop now", "Try it free", "Get 20% off", "Learn more", "Start today"];

    private static readonly Dictionary<string, string[]> HooksByVertical = new()
    {
        ["skincare"] =
        [
            "Your skin already knows. It's the water.",
            "The 10pm routine dermatologists keep to themselves.",
            "Glass skin isn't genetics. It's chemistry.",
            "One serum. Three fewer steps.",
            "Redness doesn't stand a chance after week two.",
        ],
        ["fitness"] =
        [
            "20 minutes. No equipment. No excuses left.",
            "Your gym membership called. It's jealous.",
            "The workout plan that actually survives Monday.",
            "Stronger in six weeks — or it's free.",
            "Skipped leg day? The app noticed.",
        ],
        ["coffee"] =
        [
            "Tastes like a café. Brews like instant.",
            "Your 6am deserves better than sad office coffee.",
            "Single-origin, roasted Tuesday, at your door Friday.",
            "The last coffee subscription you'll ever audition.",
            "Decaf that doesn't taste like a compromise.",
        ],
        ["saas"] =
        [
            "Your team ships. The busywork doesn't.",
            "Cut reporting from four hours to four minutes.",
            "Spreadsheets were never the plan.",
            "Onboard in 10 minutes. Cancel the chaos.",
            "The dashboard your Monday meeting is missing.",
        ],
        ["sneakers"] =
        [
            "Broken in from step one.",
            "Walk on clouds. Land in style.",
            "Your knees will write us a thank-you note.",
            "Made for the 12,000 steps you actually take.",
            "The last pair you'll rebuy on purpose.",
        ],
        ["apparel"] =
        [
            "The tee you'll reach for before it's out of the wash.",
            "Soft enough to sleep in. Sharp enough to go out in.",
            "Fits like it was made for you. Because it was cut for you.",
            "Fewer pieces. Better pieces.",
            "Your new favorite, in every color.",
        ],
        ["home"] =
        [
            "Your home, but the weekend version.",
            "The upgrade your guests will ask about.",
            "Sleep like a hotel. Pay like a Tuesday.",
            "Small ritual. Whole new mood.",
            "Made to be lived with, not just looked at.",
        ],
        ["drinkware"] =
        [
            "Still ice-cold at 5pm.",
            "Hydration that goes where you go.",
            "The last bottle you'll ever lose sleep over.",
            "Leakproof. Drop-proof. Car-cup-holder-proof.",
            "Hot for 12 hours. Cold for 24. Smug forever.",
        ],
        ["generic"] =
        [
            "Stop scrolling. This is the sign.",
            "You've tried the rest. Here's the upgrade.",
            "Built for people who read the reviews first.",
            "The before-and-after speaks for itself.",
            "Small change. Unreasonable difference.",
        ],
    };

    /// <summary>Primary-text templates. {0}=productName {1}=keyBenefit {2}=targetAudience {3}=offer sentence (may be empty).</summary>
    private static readonly string[] PrimaryTextTemplates =
    [
        "{0} was built for one thing: {1}. No filler, no fine print — just results you can see.{3}",
        "Meet {0}. {1}, designed around how {2} actually live. Feel the difference in days, not months.{3}",
        "{1} shouldn't be complicated. {0} strips it down to what works — and nothing else. Join the thousands who already switched.{3}",
        "We made {0} because {2} deserved better. {1}, backed by a no-questions-asked guarantee.{3}",
    ];

    // Most specific first. The product name is checked before the description, so a sneaker
    // described as "moisture-wicking" stays a sneaker.
    private static readonly (string Vertical, string[] Words)[] VerticalRules =
    [
        ("sneakers", ["sneaker", "shoe", "footwear", "runner", "trainer", "boot"]),
        ("drinkware", ["tumbler", "water bottle", "mug", "flask", "thermos"]),
        ("coffee", ["coffee", "espresso", "roast", "beans"]),
        ("skincare", ["serum", "skincare", "skin care", "moisturiser", "moisturizer", "cleanser", "spf"]),
        ("home", ["candle", "sheet", "bedding", "pillow", "duvet", "towel", "decor", "diffuser"]),
        ("apparel", ["t-shirt", "tee", "hoodie", "sweater", "dress", "jeans", "sock", "apparel", "jacket"]),
        ("fitness", ["fitness", "workout", "gym", "training", "protein"]),
        ("saas", ["saas", "software", "dashboard", "platform"]),
    ];

    public static string DetectVertical(Brief brief)
    {
        foreach (var text in new[] { brief.ProductName, $"{brief.ProductDescription} {brief.KeyBenefit}" })
        {
            var t = (text ?? "").ToLowerInvariant();
            foreach (var (vertical, words) in VerticalRules)
                if (words.Any(w => t.Contains(w))) return vertical;
        }
        // Loose skin/moisture words only count when nothing more specific matched.
        var all = $"{brief.ProductName} {brief.ProductDescription}".ToLowerInvariant();
        return all.Contains("skin") ? "skincare" : "generic";
    }

    public static string Hook(string vertical, string key)
    {
        var pool = HooksByVertical.TryGetValue(vertical, out var hooks) ? hooks : HooksByVertical["generic"];
        return pool[Determinism.Pick(key, pool.Length)];
    }

    public static string PrimaryText(Brief brief, string key)
    {
        var template = PrimaryTextTemplates[Determinism.Pick(key, PrimaryTextTemplates.Length)];
        var offer = string.IsNullOrWhiteSpace(brief.Offer) ? "" : $" {brief.Offer.TrimEnd('.')}.";
        var audience = string.IsNullOrWhiteSpace(brief.TargetAudience) ? "busy people" : brief.TargetAudience;
        var benefit = string.IsNullOrWhiteSpace(brief.KeyBenefit) ? "real, visible results" : brief.KeyBenefit;
        var name = string.IsNullOrWhiteSpace(brief.ProductName) ? "This product" : brief.ProductName;
        return string.Format(template, name, benefit, audience, offer);
    }

    public static string Cta(Brief brief, string key) =>
        string.IsNullOrWhiteSpace(brief.CallToAction)
            ? FallbackCtas[Determinism.Pick(key, FallbackCtas.Length)]
            : brief.CallToAction;

    public static List<string> Palette(string key) =>
        [.. Palettes[Determinism.Pick(key, Palettes.Length)]];
}
