using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

/// <summary>
/// Guards for generation-shaped endpoints: a per-user rate limit and a cap on work in progress, so a runaway
/// script (or an open tab left running) can't burn through your AI provider budget. Limits live under `RateLimits`.
/// Returns null when the request may proceed.
/// </summary>
public static class Guards
{
    public static IResult? CheckGeneration(HttpContext http, AppStore store, RateLimitService limits, User user, bool isVideo)
    {
        var allowed = isVideo
            ? limits.TryAcquireVideo(user.Id, out var retryAfterSeconds)
            : limits.TryAcquireImage(user.Id, out retryAfterSeconds);
        if (!allowed)
            return TooManyRequests(http,
                $"You've hit the {(isVideo ? "video" : "image")} generation rate limit. Take a breather.",
                retryAfterSeconds);

        // Generations still processing count against the cap.
        var cap = isVideo ? limits.Options.MaxConcurrentVideoGenerations : limits.Options.MaxConcurrentImageGenerations;
        if (store.CountProcessingGenerations(user.Id, isVideo) >= cap)
            return TooManyRequests(http,
                $"Too many {(isVideo ? "video" : "image")} generations are already processing. Wait for one to finish.",
                retryAfterSeconds: 6);

        return null;
    }

    /// <summary>Image edits (refine, rebrand) share the image rate limit. Null when allowed.</summary>
    public static IResult? CheckEdit(HttpContext http, RateLimitService limits, User user) =>
        limits.TryAcquireImage(user.Id, out var retryAfterSeconds)
            ? null
            : TooManyRequests(http, "You've hit the image edit rate limit. Take a breather.", retryAfterSeconds);

    public static IResult TooManyRequests(HttpContext http, string error, int retryAfterSeconds)
    {
        http.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
        return Results.Json(new { error, retryAfterSeconds }, statusCode: StatusCodes.Status429TooManyRequests);
    }
}
