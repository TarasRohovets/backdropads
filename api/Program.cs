using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Endpoints;
using BackdropAds.Api.Services;
using BackdropAds.Api.Services.Providers;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Model versions picked by "Update models" sit on top of appsettings.json and the environment (loaded from the
// database at startup, see InitializeDatabaseAsync).
var modelSettings = new ModelSettingsProvider();
((IConfigurationBuilder)builder.Configuration).Add(modelSettings);
builder.Services.AddSingleton(modelSettings);

// `dotnet run` serves http://localhost:5210 with zero configuration. Hosts that set their own binding
// (containers and cloud hosts via ASPNETCORE_URLS / ASPNETCORE_HTTP_PORTS / --urls) keep theirs.
if (new[] { "urls", "http_ports", "https_ports" }.All(k => string.IsNullOrWhiteSpace(builder.Configuration[k])))
    builder.WebHost.UseUrls("http://localhost:5210");

// Pre-selected models for new generations (images: Nano Banana Pro unless configured otherwise).
ModelCatalog.ConfigureDefaults(builder.Configuration["AI:DefaultModels:Image"], builder.Configuration["AI:DefaultModels:Video"]);

// camelCase properties AND camelCase enum-as-string.
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

// CORS: only needed when the web app is served from another origin than this API (the bundled web app proxies
// /api and /media, so it isn't). localhost is always allowed; add others via Cors:Origins.
var allowedOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.SetIsOriginAllowed(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
            (uri.Host is "localhost" or "127.0.0.1" || allowedOrigins.Any(o => string.Equals(o.TrimEnd('/'), origin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))))
        .AllowAnyHeader().AllowAnyMethod()));

// ---- Rate limits: global per-IP (caps on AI work live in RateLimitService) ----
var rateLimits = builder.Configuration.GetSection("RateLimits").Get<RateLimitOptions>() ?? new RateLimitOptions();
builder.Services.Configure<RateLimitOptions>(builder.Configuration.GetSection("RateLimits"));
builder.Services.AddRateLimiter(options =>
{
    static string ClientIp(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(ClientIp(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = rateLimits.GlobalPerMinutePerIp,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    options.OnRejected = async (context, cancellationToken) =>
    {
        var retryAfterSeconds = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))
            : 60;
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { error = "Too many requests. Slow down and try again.", retryAfterSeconds },
            cancellationToken);
    };
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo
    {
        Title = "BackdropAds API",
        Version = "v1",
        Description = "BackdropAds API: generations, flows, uploads, brand kits and settings.",
    });
});

builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient();
// Product-link import follows redirects itself so every hop is re-checked (SSRF guard).
builder.Services.AddHttpClient(ProductImporter.ClientName, c => c.Timeout = TimeSpan.FromSeconds(12))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

// No sign-in: every request acts as the instance's one local user.
builder.Services.AddScoped<IUserContext, LocalUserContext>();
builder.Services.AddSingleton<RateLimitService>();

// AI providers: adapters without an API key are skipped. "Auto" walks the chains in appsettings (AI:*ProviderChain);
// a model the user picks runs alone — if it fails, they're offered a working alternative instead of a silent swap.
builder.Services.AddSingleton<MediaStore>();
builder.Services.AddSingleton<IImageModelProvider, GptImageFlareProvider>();
builder.Services.AddSingleton<IImageModelProvider, GptImageSunburstProvider>();
builder.Services.AddSingleton<IImageModelProvider, NanoBananaProvider>();
builder.Services.AddSingleton<IImageModelProvider, NanoBananaProProvider>();
builder.Services.AddSingleton<IImageModelProvider, SeedreamProvider>();
builder.Services.AddSingleton<IImageModelProvider, SeedreamFlashProvider>();
builder.Services.AddSingleton<IImageModelProvider, FluxProvider>();
builder.Services.AddSingleton<IImageModelProvider, MockImageProvider>();
builder.Services.AddSingleton<IVideoModelProvider, OmniHumanProvider>();
builder.Services.AddSingleton<IVideoModelProvider, SeedanceProvider>();
builder.Services.AddSingleton<IVideoModelProvider, SeedanceFlashProvider>();
builder.Services.AddSingleton<IVideoModelProvider, GeminiOmniProvider>();
builder.Services.AddSingleton<IVideoModelProvider, KlingProvider>();
builder.Services.AddSingleton<IVideoModelProvider, WanProvider>();
builder.Services.AddSingleton<IVideoModelProvider, MockVideoProvider>();
builder.Services.AddSingleton<AiGate>();
builder.Services.AddSingleton<ProviderRouter>();

// Refine loop: image edits walk their own chain (Banana first, it is the stronger editor).
builder.Services.AddSingleton<SourceImageLoader>();
builder.Services.AddSingleton<IImageEditProvider, NanoBananaEditProvider>();
builder.Services.AddSingleton<IImageEditProvider, NanoBananaProEditProvider>();
builder.Services.AddSingleton<IImageEditProvider, GptImageEditProvider>();
builder.Services.AddSingleton<IImageEditProvider, MockEditProvider>();
builder.Services.AddSingleton<ImageEditRouter>();

builder.Services.AddSingleton<IAdGenerationService, MockAdGenerationService>();
builder.Services.AddSingleton<IAdAnalysisService, MockAdAnalysisService>();
builder.Services.AddSingleton<IAdImprovementService, MockAdImprovementService>();
builder.Services.AddSingleton<BrandScanner>();
builder.Services.AddSingleton<ProductImporter>();
builder.Services.AddSingleton<FlowRunner>();
// Text work goes to Claude only (AI:Anthropic:TextModel). Today that is reading PDFs / text attachments
// before any image/video prompt.
builder.Services.AddSingleton<ClaudeText>();
builder.Services.AddSingleton<DocumentReader>();
// Settings → System: usage numbers + the weekly model availability report (report only, never switches models).
builder.Services.AddSingleton<UsageQueries>();
builder.Services.AddSingleton<ModelHealthService>();
// "Update models": finds the newest version of each model family and saves it as the setting to use.
builder.Services.AddSingleton<ModelSettingsStore>();
builder.Services.AddSingleton<ModelUpdater>();
builder.Services.AddHostedService<ModelCheckJob>();
// Persistence: PostgreSQL via Dapper (ConnectionStrings:PostgresConnection); schema in /migrations.
builder.AddAppDatabase();

var app = builder.Build();
await app.InitializeDatabaseAsync();

app.UseCors();
app.UseRateLimiter();

// Browsable UI at /swagger — local only (set Swagger:Enabled=true to expose it elsewhere).
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Swagger:Enabled"))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Health check: 200 only when the database answers.
app.MapGet("/health", (AppStore store) =>
    store.CanConnect()
        ? Results.Ok(new { status = "ok" })
        : Results.Json(new { status = "database unavailable" }, statusCode: 503)).WithTags("Health");

// Stored media (folder storage): /media/{folder}/{file}, with range requests so videos can seek.
app.MapGet("/media/{**name}", (string name, MediaStore media, HttpContext http) =>
{
    if (media.Locate(name) is not { } file) return Results.NotFound();
    http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
    http.Response.Headers.XContentTypeOptions = "nosniff";
    return Results.File(file.Path, file.ContentType, enableRangeProcessing: true);
}).ExcludeFromDescription();

// Every API endpoint saves its tracked changes before the response goes out.
var api = app.MapGroup("").AddEndpointFilter<SaveChangesFilter>();
api.MapCatalogEndpoints();
api.MapGenerationEndpoints();
api.MapAdEndpoints();
// "Analyze an ad" is hidden until it has a real implementation: today the service only writes placeholder
// text and never looks at the ad. Re-enable together with ANALYZE_ENABLED in web/src/lib/features.ts.
// api.MapRoastEndpoints();
api.MapTemplateEndpoints();
api.MapBrandKitEndpoints();
api.MapProductEndpoints();
api.MapFlowEndpoints();
api.MapUploadEndpoints();
api.MapWorkspaceEndpoints();
api.MapSettingsEndpoints();

// Which AI providers will really run — handy right after adding keys.
{
    var mock = app.Configuration.GetValue("AI:UseMockData", false);
    var images = app.Services.GetServices<BackdropAds.Api.Services.Providers.IImageModelProvider>().Where(p => p.Name != "mock");
    var videos = app.Services.GetServices<BackdropAds.Api.Services.Providers.IVideoModelProvider>().Where(p => p.Name != "mock");
    string Line(IEnumerable<(string Name, bool On)> ps) => string.Join(", ", ps.Select(p => $"{p.Name} {(p.On ? "✓" : "–")}"));
    app.Logger.LogInformation("AI providers ({Mode}) · images: {Images} · video: {Videos}",
        mock ? "MOCK MODE — nothing is called" : "live",
        Line(images.Select(p => (p.Name, p.IsConfigured))), Line(videos.Select(p => (p.Name, p.IsConfigured))));
}
app.Run();
