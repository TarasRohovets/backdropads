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
}
