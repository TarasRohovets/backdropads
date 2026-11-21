using Microsoft.Extensions.Options;

namespace BackdropAds.Api.Services;

/// <summary>
/// The queue in front of the AI providers: only a few image jobs and video jobs run at the same time across the
/// whole app (RateLimits:GlobalConcurrentImageJobs / GlobalConcurrentVideoJobs); everything else waits its turn.
/// Each job holds photos and results in memory, so on a small machine work is spread out instead of started all
/// at once.
/// </summary>
public sealed class AiGate(IOptions<RateLimitOptions> options)
{
    private readonly SemaphoreSlim _images = new(Math.Max(1, options.Value.GlobalConcurrentImageJobs));
    private readonly SemaphoreSlim _videos = new(Math.Max(1, options.Value.GlobalConcurrentVideoJobs));
    private int _waiting;

    /// <summary>Jobs waiting for a free slot right now.</summary>
    public int Waiting => Volatile.Read(ref _waiting);

    /// <summary>Waits for a free slot; dispose the result to hand the slot to the next job.</summary>
    public async Task<IDisposable> EnterAsync(bool isVideo, CancellationToken cancellationToken = default)
    {
        var slots = isVideo ? _videos : _images;
        Interlocked.Increment(ref _waiting);
        try
        {
            await slots.WaitAsync(cancellationToken);
        }
        finally
        {
            Interlocked.Decrement(ref _waiting);
        }
        return new Slot(slots);
    }

    private sealed class Slot(SemaphoreSlim slots) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0) slots.Release();
        }
    }
}
