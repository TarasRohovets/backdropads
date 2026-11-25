namespace BackdropAds.Api.Domain;

/// <summary>
/// How much text any one field may carry. Everything users type can end up in an AI request (Claude for copy and
/// prompts, the image and video models), so long text is cut here, where it enters, and never reaches a paid call.
/// The web app shows the same limits on its inputs.
/// </summary>
public static class TextLimits
{
    public const int Prompt = 4000;          // the Create prompt box, saved prompts
    public const int ProductDescription = 8000; // prompt + text read from the product page
    public const int Idea = 2000;            // "Improve with AI" input
    public const int Instruction = 500;      // refine / edit instructions
    public const int LongNote = 3000;        // brand guidelines, brand context, product notes
    public const int ShortText = 300;
    public const int Name = 150;

    /// <summary>Trimmed and cut to `max` characters; null stays null.</summary>
    public static string? Cut(string? s, int max)
    {
        if (s is null) return null;
        s = s.Trim();
        return s.Length <= max ? s : s[..max].TrimEnd();
    }

    private static string CutRequired(string? s, int max) => Cut(s, max) ?? "";

    public static void Apply(Brief b)
    {
        b.ProductName = CutRequired(b.ProductName, Name);
        b.ProductUrl = Cut(b.ProductUrl, 2048);
        b.ProductDescription = Cut(b.ProductDescription, ProductDescription);
        b.TargetAudience = CutRequired(b.TargetAudience, ShortText);
        b.TargetMarket = CutRequired(b.TargetMarket, 120);
        b.Language = CutRequired(b.Language, 60);
        b.Tone = CutRequired(b.Tone, 120);
        b.Offer = Cut(b.Offer, ShortText);
        b.KeyBenefit = CutRequired(b.KeyBenefit, 400);
        b.CallToAction = CutRequired(b.CallToAction, 60);
        b.RequiredText = Cut(b.RequiredText, ShortText);
        b.ProhibitedClaims = Cut(b.ProhibitedClaims, 600);
        b.ReferenceCreativeUrl = Cut(b.ReferenceCreativeUrl, 2048);
        b.ReferenceImageUrls = (b.ReferenceImageUrls ?? []).Take(8).Select(u => CutRequired(u, 2048)).ToList();
    }

    public static void Apply(BrandKit k)
    {
        k.BrandName = CutRequired(k.BrandName, 120);
        k.Tone = CutRequired(k.Tone, 200);
        k.DefaultCta = CutRequired(k.DefaultCta, 60);
        k.ProductInfo = Cut(k.ProductInfo, LongNote);
        k.Guidelines = Cut(k.Guidelines, LongNote);
        k.Context = Cut(k.Context, LongNote);
        k.WebsiteUrl = Cut(k.WebsiteUrl, 2048);
        k.LogoUrl = Cut(k.LogoUrl, 2048);
        k.Colors = (k.Colors ?? []).Take(10).Select(c => CutRequired(c, 32)).ToList();
        k.Fonts = (k.Fonts ?? []).Take(4).Select(f => CutRequired(f, 80)).ToList();
    }
}
