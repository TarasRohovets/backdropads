namespace BackdropAds.Api.Domain;

/// <summary>
/// The fixed platform / placement / creativeType combination matrix.
/// Aspect ratio is derived from (platform, placement), never user-selected.
/// </summary>
public static class Taxonomy
{
    public sealed record Combo(Platform Platform, Placement Placement, CreativeType[] CreativeTypes, string AspectRatio);

    public static readonly IReadOnlyList<Combo> Matrix =
    [
        new(Platform.Instagram,     Placement.Feed,    [CreativeType.Image, CreativeType.Carousel, CreativeType.Video], "4:5"),
        new(Platform.Instagram,     Placement.Story,   [CreativeType.Image, CreativeType.Video],                        "9:16"),
        new(Platform.Instagram,     Placement.Reel,    [CreativeType.Video],                                            "9:16"),
        new(Platform.Facebook,      Placement.Feed,    [CreativeType.Image, CreativeType.Carousel, CreativeType.Video], "1:1"),
        new(Platform.Facebook,      Placement.Story,   [CreativeType.Image, CreativeType.Video],                        "9:16"),
        new(Platform.Tiktok,        Placement.Video,   [CreativeType.Video],                                            "9:16"),
        new(Platform.Youtube,       Placement.Short,   [CreativeType.Video],                                            "9:16"),
        new(Platform.Youtube,       Placement.Video,   [CreativeType.Video],                                            "16:9"),
        new(Platform.Pinterest,     Placement.Pin,     [CreativeType.Image, CreativeType.Video],                        "2:3"),
        new(Platform.GoogleDisplay, Placement.Display, [CreativeType.Image],                                            "1:1"),
    ];

    /// <summary>Validates a combination; on success returns the derived aspect ratio.</summary>
    public static bool TryValidate(Platform platform, Placement placement, CreativeType creativeType,
        out string aspectRatio, out string error)
    {
        aspectRatio = "";
        error = "";

        var row = Matrix.FirstOrDefault(c => c.Platform == platform && c.Placement == placement);
        if (row is null)
        {
            var valid = string.Join(", ", Matrix.Where(c => c.Platform == platform).Select(c => CamelName(c.Placement)));
            error = $"Placement '{CamelName(placement)}' is not valid for platform '{CamelName(platform)}'. Valid placements: {valid}.";
            return false;
        }

        if (!row.CreativeTypes.Contains(creativeType))
        {
            var valid = string.Join(", ", row.CreativeTypes.Select(CamelName));
            error = $"Creative type '{CamelName(creativeType)}' is not valid for {CamelName(platform)}/{CamelName(placement)}. Valid creative types: {valid}.";
            return false;
        }

        aspectRatio = row.AspectRatio;
        return true;
    }

    /// <summary>First (placement, aspectRatio) on the platform that supports the creative type, if any.</summary>
    public static Combo? FirstComboFor(Platform platform, CreativeType creativeType) =>
        Matrix.FirstOrDefault(c => c.Platform == platform && c.CreativeTypes.Contains(creativeType));

    /// <summary>First combo defined for the platform (every platform has at least one row).</summary>
    public static Combo DefaultComboFor(Platform platform) =>
        Matrix.First(c => c.Platform == platform);

    private static string CamelName<T>(T value) where T : struct, Enum
    {
        var name = value.ToString();
        return char.ToLowerInvariant(name[0]) + name[1..];
    }
}
