using Anthropic;

namespace BackdropAds.Api.Services;

/// <summary>
/// Claude (Anthropic API) — the only model the app uses for text work. Image and video models never see text
/// tasks; anything that reads or writes words goes through here. Model: AI:Anthropic:TextModel.
/// </summary>
public class ClaudeText(IConfiguration configuration)
{
    private readonly Lazy<AnthropicClient> _client = new(() =>
    {
        var apiKey = configuration["AI:Anthropic:ApiKey"];
        var timeout = TimeSpan.FromSeconds(90);
        // A base URL is only set for tests and proxies; empty = api.anthropic.com.
        return configuration["AI:Anthropic:BaseUrl"] is { Length: > 0 } baseUrl
            ? new AnthropicClient { ApiKey = apiKey, MaxRetries = 1, Timeout = timeout, BaseUrl = baseUrl }
            : new AnthropicClient { ApiKey = apiKey, MaxRetries = 1, Timeout = timeout };
    });

    public bool HasKey => !string.IsNullOrWhiteSpace(configuration["AI:Anthropic:ApiKey"]);

    /// <summary>True when text work really goes to Claude (a key is set and demo mode is off).</summary>
    public bool Live => HasKey && !configuration.GetValue("AI:UseMockData", false);

    public string Model => configuration["AI:Anthropic:TextModel"] is { Length: > 0 } m ? m : ModelDefaults.ClaudeText;

    /// <summary>Most input tokens one text request may use: a ceiling on what a single request can cost.</summary>
    public long MaxInputTokens => configuration.GetValue("AI:Anthropic:MaxInputTokens", 40_000L);

    public AnthropicClient Client => _client.Value;

    /// <summary>Hook for a finished request's token use. Self-hosted, Anthropic's console shows your spend, so nothing is kept here.</summary>
    public void Spent(string model, long inputTokens, long outputTokens) { }

    /// <summary>Hook for a failed request (the caller already logs it).</summary>
    public void Refused(string model, Exception ex) { }

    /// <summary>Claude list prices per million tokens (input, output), by model family: a rough cost of one request.</summary>
    public static decimal Cost(string model, long inputTokens, long outputTokens)
    {
        var m = model.ToLowerInvariant();
        var (input, output) = m.Contains("haiku") ? (0.10m, 0.50m) : m.Contains("opus") ? (4m, 20m) : m.Contains("fable") || m.Contains("mythos") ? (8m, 40m) : (2m, 10m);
        return (inputTokens * input + outputTokens * output) / 1_000_000m;
    }
}
