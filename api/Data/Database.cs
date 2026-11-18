using System.Data;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using BackdropAds.Api.Services;
using Dapper;
using Npgsql;

namespace BackdropAds.Api.Data;

/// <summary>PostgreSQL connections (`ConnectionStrings:PostgresConnection`), used with Dapper.</summary>
public class DbContext
{
    private readonly string _connectionString;

    public DbContext(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("PostgresConnection") ?? "";
        if (string.IsNullOrWhiteSpace(_connectionString))
            throw new InvalidOperationException(
                "Set the PostgreSQL connection string (ConnectionStrings:PostgresConnection, env ConnectionStrings__PostgresConnection).");
    }

    public NpgsqlConnection CreateConnection() => new(_connectionString);
}

public static class DbSetup
{
    public static void AddAppDatabase(this WebApplicationBuilder builder)
    {
        // snake_case columns ↔ PascalCase properties; timestamptz ↔ DateTimeOffset (UTC).
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.RemoveTypeMap(typeof(DateTimeOffset));
        SqlMapper.RemoveTypeMap(typeof(DateTimeOffset?));
        SqlMapper.AddTypeHandler(new DateTimeOffsetHandler());

        builder.Services.AddSingleton<DbContext>();
        builder.Services.AddScoped<AppStore>();
    }

    /// <summary>Runs every /migrations/*.sql (idempotent, name order), prepares media storage and the local user.</summary>
    public static async Task InitializeDatabaseAsync(this WebApplication app)
    {
        var db = app.Services.GetRequiredService<DbContext>();
        var folder = Path.Combine(AppContext.BaseDirectory, "migrations");
        await using (var conn = await OpenWhenReadyAsync(db, app.Logger))
        {
            foreach (var file in Directory.GetFiles(folder, "*.sql").Order(StringComparer.Ordinal))
                await conn.ExecuteAsync(await File.ReadAllTextAsync(file));
        }

        // Model versions chosen with "Update models" override the shipped defaults.
        await app.Services.GetRequiredService<ModelSettingsStore>().LoadAsync();

        var media = app.Services.GetRequiredService<MediaStore>();
        await media.EnsureReadyAsync();

        // No sign-in: every request acts as the instance's one local user.
        using var scope = app.Services.CreateScope();
        LocalUserContext.LocalUserId = scope.ServiceProvider.GetRequiredService<AppStore>().EnsureLocalUser();

        app.Logger.LogInformation("Database ready · media storage: {Backend}.", media.Backend);
    }

    /// <summary>The database container may still be starting when the API does (Docker Compose): wait up to a minute.</summary>
    private static async Task<NpgsqlConnection> OpenWhenReadyAsync(DbContext db, ILogger logger)
    {
        for (var attempt = 1; ; attempt++)
        {
            var conn = db.CreateConnection();
            try
            {
                await conn.OpenAsync();
                return conn;
            }
            catch (Exception ex) when (attempt < 20 && ex is NpgsqlException or System.Net.Sockets.SocketException)
            {
                await conn.DisposeAsync();
                if (attempt == 1) logger.LogInformation("Waiting for PostgreSQL…");
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
    }

    private sealed class DateTimeOffsetHandler : SqlMapper.TypeHandler<DateTimeOffset>
    {
        public override void SetValue(IDbDataParameter parameter, DateTimeOffset value) => parameter.Value = value.ToUniversalTime();

        public override DateTimeOffset Parse(object value) => value switch
        {
            DateTimeOffset dto => dto,
            DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
            _ => DateTimeOffset.Parse(value.ToString()!),
        };
    }
}

/// <summary>Saves the request's edited entities after the endpoint runs and before the response is written.</summary>
public sealed class SaveChangesFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var result = await next(context);
        context.HttpContext.RequestServices.GetService<AppStore>()?.Save();
        return result;
    }
}

/// <summary>JSON for the `data` jsonb columns. Includes [JsonIgnore]d members (those only hide
/// internals from API responses — the database must keep them, e.g. FlowRun.WorkspaceId).</summary>
public static class JsonColumns
{
    public static readonly JsonSerializerOptions Options = new()
    {
        Converters = { new JsonStringEnumConverter() },
        TypeInfoResolver = new DefaultJsonTypeInfoResolver { Modifiers = { IncludeIgnored } },
    };

    private static void IncludeIgnored(JsonTypeInfo info)
    {
        if (info.Kind != JsonTypeInfoKind.Object || info.Type.Namespace?.StartsWith("BackdropAds") != true) return;
        foreach (var prop in info.Type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (prop.GetCustomAttribute<JsonIgnoreAttribute>() is null || !prop.CanRead || !prop.CanWrite) continue;
            // The contract keeps ignored members as switched-off entries: replace them with working ones.
            for (var i = info.Properties.Count - 1; i >= 0; i--)
                if (info.Properties[i].Name == prop.Name) info.Properties.RemoveAt(i);
            var jp = info.CreateJsonPropertyInfo(prop.PropertyType, prop.Name);
            jp.Get = o => prop.GetValue(o);
            jp.Set = (o, v) => prop.SetValue(o, v);
            info.Properties.Add(jp);
        }
    }

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options)!;
}
