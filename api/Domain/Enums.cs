namespace BackdropAds.Api.Domain;

public enum Platform
{
    Instagram,
    Facebook,
    Tiktok,
    Youtube,
    Pinterest,
    GoogleDisplay
}

public enum Placement
{
    Feed,
    Story,
    Reel,
    Short,
    Video,
    Pin,
    Display
}

public enum CreativeType
{
    Image,
    Video,
    Carousel
}

public enum GenerationStatus
{
    Processing,
    Completed,
    Failed
}

public enum AdStatus
{
    Draft,
    Ready
}
