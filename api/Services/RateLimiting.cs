using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace BackdropAds.Api.Services;

/// <summary>Bound from the "RateLimits" config section; defaults match API_CONTRACT.md.</summary>
public class RateLimitOptions
{
    public int GlobalPerMinutePerIp { get; set; } = 300;
    public int AuthPerFiveMinutesPerIp { get; set; } = 10;
    public int ImagePerHour { get; set; } = 20;
    public int ImagePerDay { get; set; } = 60;
    public int VideoPerHour { get; set; } = 4;
    public int VideoPerDay { get; set; } = 12;
    public int RoastPerHour { get; set; } = 30;
    /// <summary>Analyze is free to users but not to us (~$0.01 vision call) — cap it per day too.</summary>
    public int RoastPerDay { get; set; } = 40;
    /// <summary>Claude text work you ask for (Improve with AI, prompt sets, Create with AI, the flow chat): a cap on your own bill.</summary>
    public int PromptPerHour { get; set; } = 60;
    public int PromptPerDay { get; set; } = 500;
    public int MaxConcurrentImageGenerations { get; set; } = 2;
    public int MaxConcurrentVideoGenerations { get; set; } = 1;
    /// <summary>Image jobs talking to an AI provider at the same time. The rest queue.</summary>
    public int GlobalConcurrentImageJobs { get; set; } = 2;
    /// <summary>Video jobs running at the same time. The rest queue.</summary>
    public int GlobalConcurrentVideoJobs { get; set; } = 1;
}

/// <summary>
/// In-memory per-user sliding-window counters for AI actions (image/video/roast).
/// IP/global limits are handled separately by ASP.NET's AddRateLimiter; these caps
/// protect your AI provider bill.
/// </summary>
public class RateLimitService(IOptions<RateLimitOptions> options)
{
    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _events = new();

    public RateLimitOptions Options { get; } = options.Value;

    public bool TryAcquireImage(string userId, out int retryAfterSeconds) =>
        TryAcquire($"{userId}:image", Options.ImagePerHour, Options.ImagePerDay, out retryAfterSeconds);

    public bool TryAcquireVideo(string userId, out int retryAfterSeconds) =>
        TryAcquire($"{userId}:video", Options.VideoPerHour, Options.VideoPerDay, out retryAfterSeconds);

    public bool TryAcquireRoast(string userId, out int retryAfterSeconds) =>
        TryAcquire($"{userId}:roast", Options.RoastPerHour, Options.RoastPerDay, out retryAfterSeconds);

    /// <summary>Prompt rewrites: the plan's own hourly / daily caps, never above the server-wide ones in RateLimits.</summary>
    public bool TryAcquirePrompt(string userId, int perHour, int perDay, out int retryAfterSeconds) =>
        TryAcquire($"{userId}:prompt", Math.Min(perHour, Options.PromptPerHour), Math.Min(perDay, Options.PromptPerDay), out retryAfterSeconds);

    private bool TryAcquire(string key, int perHour, int? perDay, out int retryAfterSeconds)
    {
        var now = DateTimeOffset.UtcNow;
        var list = _events.GetOrAdd(key, _ => []);

        lock (list)
        {
            list.RemoveAll(t => t < now.AddHours(-24));

            var hourWindowStart = now.AddHours(-1);
            var inHour = list.Where(t => t >= hourWindowStart).ToList();
            if (inHour.Count >= perHour)
            {
                retryAfterSeconds = SecondsUntilSlotFrees(inHour.Min(), hourWindowStart);
                return false;
            }

            if (perDay is { } dayCap)
            {
                var dayWindowStart = now.AddDays(-1);
                var inDay = list.Where(t => t >= dayWindowStart).ToList();
                if (inDay.Count >= dayCap)
                {
                    retryAfterSeconds = SecondsUntilSlotFrees(inDay.Min(), dayWindowStart);
                    return false;
                }
            }

            list.Add(now);
            retryAfterSeconds = 0;
            return true;
        }
    }

    /// <summary>A slot frees when the oldest event in the window slides out of it.</summary>
    private static int SecondsUntilSlotFrees(DateTimeOffset oldestInWindow, DateTimeOffset windowStart) =>
        Math.Max(1, (int)Math.Ceiling((oldestInWindow - windowStart).TotalSeconds));
}
