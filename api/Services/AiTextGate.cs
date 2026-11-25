using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>A Claude model you can pick for prompt writing and flow planning. Units = rough cost relative to the standard model.</summary>
public sealed record AiTextModel(string Id, string Name, int Units);

/// <summary>The Claude models offered for text work: your app's text model (Sonnet 5.5 out of the box), Opus 5.5 and Fable 5.2.</summary>
public static class AiPlans
{
    public static readonly AiTextModel Opus = new("claude-opus-5-5", "Claude Opus 5.5", 2);
    public static readonly AiTextModel Fable = new("claude-fable-5-2", "Claude Fable 5.2", 4);

    public static AiTextModel Standard(string textModelId) => new(textModelId, NameOf(textModelId), 1);

    public static IReadOnlyList<AiTextModel> Models(string textModelId) =>
        [Standard(textModelId), .. new[] { Opus, Fable }.Where(m => m.Id != textModelId)];

    /// <summary>"claude-sonnet-5-5" → "Claude Sonnet 5.5".</summary>
    public static string NameOf(string id)
    {
        var parts = id.Split('-');
        if (parts.Length < 3 || parts[0] != "claude") return id;
        var family = char.ToUpperInvariant(parts[1][0]) + parts[1][1..];
        var version = string.Join('.', parts.Skip(2).TakeWhile(p => p.All(char.IsDigit) && p.Length <= 2));
        return version.Length > 0 ? $"Claude {family} {version}" : $"Claude {family}";
    }
}

/// <summary>An open AI text request: who, and which model.</summary>
public sealed record AiTicket(User User, IReadOnlyList<AiTextModel> Models, AiTextModel Model);

/// <summary>
/// The one door for Claude text work you ask for ("Improve with AI", prompt sets, "Create with AI", the flow chat).
/// Self-hosted, you pay Anthropic directly with your own key, so every model is yours to use; the only limit is an
/// hourly / daily cap on your own bill (RateLimits:PromptPerHour / PromptPerDay).
/// </summary>
public class AiTextGate(ClaudeText claude, RateLimitService limits)
{
    public Task<(AiTicket? Ticket, IResult? Refusal)> OpenAsync(User user, string? requestedModel)
    {
        var models = AiPlans.Models(claude.Model);
        var model = string.IsNullOrWhiteSpace(requestedModel) ? models[0] : models.FirstOrDefault(m => m.Id == requestedModel);
        if (model is null) return Task.FromResult<(AiTicket?, IResult?)>((null, Results.BadRequest(new { error = "Unknown model." })));
        if (!limits.TryAcquirePrompt(user.Id, int.MaxValue, int.MaxValue, out var retry))
            return Task.FromResult<(AiTicket?, IResult?)>((null, Results.Json(
                new { error = "That's a lot of AI requests in a short time. Take a short break and try again.", retryAfterSeconds = retry },
                statusCode: StatusCodes.Status429TooManyRequests)));
        return Task.FromResult<(AiTicket?, IResult?)>((new AiTicket(user, models, model), null));
    }

    /// <summary>Nothing to settle self-hosted; returns (0, 0) = no monthly limit.</summary>
    public Task<(int Used, int Limit)> CloseAsync(AiTicket ticket, bool byAi, string? model, decimal costUsd) => Task.FromResult((0, 0));

    public Task CancelAsync(AiTicket ticket) => Task.CompletedTask;
}
