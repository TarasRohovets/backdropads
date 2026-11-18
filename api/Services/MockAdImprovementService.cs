using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

public class MockAdImprovementService : IAdImprovementService
{
    public Generation BuildImprovedGeneration(Roast roast, CreativeType? requestedCreativeType, Ad? sourceAd)
    {
        var creativeType = requestedCreativeType ?? CreativeType.Image;

        // Honor the combination matrix: find a placement on the roast's platform that
        // supports the requested creative type; if none exists (e.g. image on TikTok),
        // fall back to the platform's first valid combo and its first creative type.
        var combo = Taxonomy.FirstComboFor(roast.Platform, creativeType);
        if (combo is null)
        {
            combo = Taxonomy.DefaultComboFor(roast.Platform);
            creativeType = combo.CreativeTypes[0];
        }

        var improved = roast.Improved!;
        var topFix = roast.Recommendations.OrderBy(r => r.Priority).FirstOrDefault();
        var fixList = string.Join("; ", roast.Recommendations
            .OrderBy(r => r.Priority)
            .Select(r => $"{r.Priority}. {r.Title} — {r.RecommendationText}"));

        var productName = sourceAd?.Name ?? "Improved creative";

        var brief = new Brief
        {
            ProductName = productName,
            ProductUrl = roast.SourceUrl,
            ProductDescription =
                $"Improved rerun of analysis {roast.Id} (overall score {roast.OverallScore}). Applied fixes: {fixList}",
            TargetAudience = sourceAd is null
                ? $"The original ad's audience in {roast.TargetMarket}"
                : $"Existing audience of \"{sourceAd.Name}\"",
            TargetMarket = roast.TargetMarket,
            Language = roast.Language,
            Tone = "Bold & punchy",
            Offer = topFix?.ImprovedText,
            KeyBenefit = improved.Hook,
            CallToAction = improved.CallToAction,
            ReferenceCreativeUrl = roast.SourceUrl,
            RequiredText = null,
            ProhibitedClaims = null,
        };

        return new Generation
        {
            Id = Ids.New("gen"),
            Platform = roast.Platform,
            Placement = combo.Placement,
            CreativeType = creativeType,
            AspectRatio = combo.AspectRatio,
            Brief = brief,
            RoastId = roast.Id,
            TemplateId = null,
            Status = GenerationStatus.Processing,
            CreatedAt = DateTimeOffset.UtcNow,
            Concepts = [],
        };
    }
}
