using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>
/// Produces deterministic mock concepts: every field is derived from a stable hash of
/// the generation id, so repeated reads of the same generation are always identical.
/// </summary>
public class MockAdGenerationService : IAdGenerationService
{
    public List<Concept> GenerateConcepts(Generation generation)
    {
        var vertical = CopyLibrary.DetectVertical(generation.Brief);
        var count = Math.Clamp(generation.ConceptCount, 1, 4);
        var concepts = new List<Concept>(count);
        // Style inspiration shifts the deterministic palette/imagery without new inputs.
        var styleSalt = string.IsNullOrWhiteSpace(generation.StyleId) ? "" : $":{generation.StyleId}";

        for (var i = 0; i < count; i++)
        {
            var key = $"{generation.Id}:concept:{i}";
            var hook = CopyLibrary.Hook(vertical, $"{key}:hook:{i}");
            var cta = CopyLibrary.Cta(generation.Brief, $"{key}:cta");

            var concept = new Concept
            {
                Id = $"con_{Determinism.Hex(key)}{i}",
                GenerationId = generation.Id,
                CreativeType = generation.CreativeType,
                AspectRatio = generation.AspectRatio,
                Hook = hook,
                PrimaryText = CopyLibrary.PrimaryText(generation.Brief, $"{key}:body:{i}"),
                CallToAction = cta,
                Score = Determinism.Range($"{key}:score", 72, 95),
                // Product-anchored generations stay visually related: seed derives from the hero, palette from the product.
                ImageSeed = generation.ProductImageSeed is { Length: > 0 } heroSeed
                    ? $"{heroSeed}-shot{i}{Determinism.Hex($"{key}:img{styleSalt}")[..4]}"
                    : $"{vertical}-{Determinism.Hex($"{key}:img{styleSalt}")}",
                Palette = generation.ProductPalette is { Count: >= 2 } productPalette
                    ? [.. productPalette]
                    : generation.Brand?.Colors is { Count: >= 2 } brandColors
                        ? [.. brandColors.Take(2)]
                        : CopyLibrary.Palette($"{key}:palette{styleSalt}"),
                Video = generation.CreativeType == CreativeType.Video ? BuildVideo(generation, hook, cta, key) : null,
                Slides = generation.CreativeType == CreativeType.Carousel ? BuildSlides(generation, vertical, hook, cta, key) : null,
            };
            concepts.Add(concept);
        }

        return concepts;
    }

    private static VideoSpec BuildVideo(Generation generation, string hook, string cta, string key)
    {
        var benefit = string.IsNullOrWhiteSpace(generation.Brief.KeyBenefit)
            ? "results you can actually see"
            : generation.Brief.KeyBenefit;
        return new VideoSpec
        {
            DurationSeconds = generation.DurationSeconds ?? ModelCatalog.Default(ModelKind.Video).DefaultDuration,
            Voiceover = $"{hook} Here's the honest version: {benefit.TrimEnd('.')}. " +
                        $"No gimmicks, no small print — just {generation.Brief.ProductName}. {cta}.",
            Captions = [hook, benefit, cta],
        };
    }

    private static List<Slide> BuildSlides(Generation generation, string vertical, string hook, string cta, string key)
    {
        var brief = generation.Brief;
        var benefit = string.IsNullOrWhiteSpace(brief.KeyBenefit) ? "Real, visible results" : brief.KeyBenefit;
        var offer = string.IsNullOrWhiteSpace(brief.Offer) ? "Limited-time launch pricing" : brief.Offer;
        var rating = 4 + Determinism.Range($"{key}:rating", 5, 9) / 10.0; // 4.5 - 4.9
        var reviewers = Determinism.Range($"{key}:reviews", 6, 24) * 500;

        (string Headline, string Text)[] all =
        [
            (hook, $"Meet {brief.ProductName} — made for {(string.IsNullOrWhiteSpace(brief.TargetAudience) ? "people like you" : brief.TargetAudience)}."),
            ("Why it works", $"{benefit.TrimEnd('.')}. That's the whole promise — and we keep it."),
            ("What you get", string.IsNullOrWhiteSpace(brief.ProductDescription) ? $"Everything {brief.ProductName} does, with none of the busywork." : brief.ProductDescription),
            ("Don't take our word for it", $"Rated {rating:0.0}/5 by {reviewers:N0} customers and counting."),
            ("The offer", $"{offer.TrimEnd('.')}. No codes to hunt for — applied at checkout."),
            ("Ready when you are", $"{cta} — it takes less than a minute."),
        ];

        var count = 4 + Determinism.Pick($"{key}:slides", 3); // 4-6 slides
        var slides = new List<Slide>(count);
        for (var s = 0; s < count; s++)
        {
            slides.Add(new Slide
            {
                Id = $"sl_{Determinism.Hex($"{key}:slide:{s}")}{s}",
                Order = s + 1,
                ImageSeed = $"{vertical}-{Determinism.Hex($"{key}:slideimg:{s}")}",
                Headline = all[s].Headline,
                Text = all[s].Text,
            });
        }
        return slides;
    }
}
