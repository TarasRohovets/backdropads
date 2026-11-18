using System.Net.Http.Headers;
using System.Text.Json;
using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services.Providers;

/// <summary>
/// ByteDance Seedance 2.5 via the BytePlus Ark API (reference handling, multi-scene continuity, native audio) —
/// POST /contents/generations/tasks, then poll the task until succeeded.
/// Endpoint/model overridable via AI:Seedance:BaseUrl / AI:Seedance:Model.
/// Only attempted when AI:Seedance:ApiKey is configured.
/// </summary>
public class SeedanceProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration) : IVideoModelProvider
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollTimeout = TimeSpan.FromMinutes(8);

    public virtual string Name => "seedance";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["AI:Seedance:ApiKey"]);

    protected IConfiguration Config => configuration;
    protected virtual string ModelId => configuration["AI:Seedance:Model"] is { Length: > 0 } m ? m : ModelDefaults.Seedance;
    protected virtual bool Supports1080p => true;

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var apiKey = configuration["AI:Seedance:ApiKey"];
        var baseUrl = (configuration["AI:Seedance:BaseUrl"] is { Length: > 0 } configured ? configured : "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks").TrimEnd('/');
        var model = ModelId;
        var client = httpClientFactory.CreateClient();

        var ratio = spec.AspectRatio is "16:9" or "9:16" or "1:1" or "4:3" or "3:4" or "21:9" ? spec.AspectRatio : "9:16";
        var duration = Math.Clamp(spec.DurationSeconds ?? 10, 4, 15);
        var resolution = Supports1080p && spec.Quality == "high" ? "1080p" : "720p";

        // ModelArk Seedance 2.x: generation settings are top-level fields. Note: Seedance 2.5 renders 1080p as
        // 10-bit HEVC, which a few older browsers can't play; 720p is plain H.264.
        using var start = new HttpRequestMessage(HttpMethod.Post, baseUrl);
        start.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        start.Content = JsonContent.Create(new
        {
            model,
            content = new object[] { new { type = "text", text = spec.Prompt } },
            ratio,
            duration,
            resolution,
            generate_audio = true,
            watermark = false,
        });

        using var startResponse = await client.SendAsync(start, cancellationToken);
        startResponse.EnsureSuccessStatusCode();

        string taskId;
        using (var json = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync(cancellationToken)))
            taskId = json.RootElement.GetProperty("id").GetString()
                ?? throw new InvalidOperationException("Seedance did not return a task id.");

        var deadline = DateTimeOffset.UtcNow + PollTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(PollInterval, cancellationToken);

            using var poll = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/{taskId}");
            poll.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var pollResponse = await ProviderHttp.TryPollAsync(client, poll, cancellationToken);
            if (pollResponse is null) continue; // temporary error — the job is still running
            pollResponse.EnsureSuccessStatusCode();

            using var json = JsonDocument.Parse(await pollResponse.Content.ReadAsStringAsync(cancellationToken));
            var status = json.RootElement.GetProperty("status").GetString();
            if (status is "failed" or "cancelled")
                throw new InvalidOperationException($"Seedance task ended with status '{status}'.");
            if (status == "succeeded")
            {
                var url = json.RootElement.GetProperty("content").GetProperty("video_url").GetString();
                return new GeneratedMedia { Url = url, Model = Name, DurationSeconds = duration };
            }
        }

        throw new TimeoutException("Seedance video generation did not complete in time.");
    }
}

/// <summary>
/// Kling 3.0 — realistic people/product motion; "high" = pro mode 1080p with native audio.
/// Model overridable via AI:Kling:Model.
/// POST /v1/videos/text2video, then poll the task until succeed.
/// Auth: Kling signs requests with a short-lived HS256 JWT built from AI:Kling:AccessKey + SecretKey
/// (iss = access key). A ready-made token in AI:Kling:ApiKey also works.
/// </summary>
public class KlingProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration) : IVideoModelProvider
{
    private string BaseUrl => (configuration["AI:Kling:BaseUrl"] is { Length: > 0 } b ? b.TrimEnd('/') : "https://api-singapore.klingai.com") + "/v1/videos/text2video";
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollTimeout = TimeSpan.FromMinutes(6);

    public string Name => "kling";
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(configuration["AI:Kling:ApiKey"]) ||
        (!string.IsNullOrWhiteSpace(configuration["AI:Kling:AccessKey"]) && !string.IsNullOrWhiteSpace(configuration["AI:Kling:SecretKey"]));

    /// <summary>Kling API token: HS256 JWT { iss: accessKey, exp: +30 min, nbf: −5 s } signed with the secret key.</summary>
    private string Token()
    {
        var accessKey = configuration["AI:Kling:AccessKey"];
        var secretKey = configuration["AI:Kling:SecretKey"];
        if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
            return configuration["AI:Kling:ApiKey"]!;

        var now = DateTime.UtcNow;
        var credentials = new Microsoft.IdentityModel.Tokens.SigningCredentials(
            new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(secretKey)),
            Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256);
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(
            issuer: accessKey, notBefore: now.AddSeconds(-5), expires: now.AddMinutes(30), signingCredentials: credentials);
        return new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<GeneratedMedia> GenerateAsync(Brief brief, MediaSpec spec, CancellationToken cancellationToken = default)
    {
        var apiKey = Token();
        var client = httpClientFactory.CreateClient();

        using var start = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
        start.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        start.Content = JsonContent.Create(new
        {
            model_name = configuration["AI:Kling:Model"] is { Length: > 0 } klingModel ? klingModel : ModelDefaults.Kling,
            prompt = spec.Prompt,
            mode = spec.Quality == "high" ? "pro" : "std",
            sound = spec.Quality == "high" ? "on" : "off",
            duration = Math.Clamp(spec.DurationSeconds ?? 10, 3, 15).ToString(),
            aspect_ratio = spec.AspectRatio == "16:9" ? "16:9" : "9:16",
        });

        using var startResponse = await client.SendAsync(start, cancellationToken);
        startResponse.EnsureSuccessStatusCode();

        string taskId;
        using (var json = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync(cancellationToken)))
            taskId = json.RootElement.GetProperty("data").GetProperty("task_id").GetString()
                ?? throw new InvalidOperationException("Kling did not return a task id.");

        var deadline = DateTimeOffset.UtcNow + PollTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(PollInterval, cancellationToken);

            using var poll = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}/{taskId}");
            poll.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var pollResponse = await ProviderHttp.TryPollAsync(client, poll, cancellationToken);
            if (pollResponse is null) continue; // temporary error — the job is still running
            pollResponse.EnsureSuccessStatusCode();

            using var json = JsonDocument.Parse(await pollResponse.Content.ReadAsStringAsync(cancellationToken));
            var data = json.RootElement.GetProperty("data");
            var status = data.GetProperty("task_status").GetString();
            if (status == "failed")
            throw new InvalidOperationException("Kling video generation failed.");
            if (status == "succeed")
            {
                var url = data.GetProperty("task_result").GetProperty("videos")[0].GetProperty("url").GetString();
                return new GeneratedMedia { Url = url, Model = Name, DurationSeconds = Math.Clamp(spec.DurationSeconds ?? 10, 3, 15) };
            }
        }

        throw new TimeoutException("Kling video generation did not complete in time.");
    }
}

/// <summary>Seedance 2.5 Flash — same BytePlus API, cheaper and quicker, 720p only. Model via AI:Seedance:FlashModel.</summary>
public class SeedanceFlashProvider(IHttpClientFactory httpClientFactory, IConfiguration config)
    : SeedanceProvider(httpClientFactory, config)
{
    public override string Name => "seedance-flash";
    protected override string ModelId => Config["AI:Seedance:FlashModel"] is { Length: > 0 } m ? m : ModelDefaults.SeedanceFlash;
    protected override bool Supports1080p => false;
}
