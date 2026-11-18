using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace BackdropAds.Api.Services;

/// <summary>
/// Where media lives (generated images / videos / voiceovers and user uploads). Two backends, picked by config:
/// <list type="bullet">
/// <item><b>Folder</b> (default): files under `Storage:Folder` (a Docker volume in the Compose setup), served by
/// this API at `/media/{folder}/{file}`. Stored URLs are relative, so the app works on any host name.</item>
/// <item><b>Azure Blob Storage</b>: when `Azure:BlobConnectionString` is set — container `Azure:ContainerName`
/// (public read, blob level); the blob URL is what the app stores and shows.</item>
/// </list>
/// Files are named `{folder}/{guid}.{ext}`.
/// </summary>
public class MediaStore
{
    public const string GeneratedFolder = "generated";
    public const string UploadsFolder = "uploads";
    public const string RoutePrefix = "/media/";

    private const long MaxRemoteBytes = 250L * 1024 * 1024; // long 1080p clips fit comfortably

    private readonly BlobContainerClient? _container;
    private readonly string _root;
    private readonly IHttpClientFactory _httpClientFactory;

    public MediaStore(IConfiguration configuration, IWebHostEnvironment environment, IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory;
        _root = Path.GetFullPath(configuration["Storage:Folder"] is { Length: > 0 } folder
            ? folder
            : Path.Combine(environment.ContentRootPath, "storage"));

        var connectionString = configuration["Azure:BlobConnectionString"];
        if (!string.IsNullOrWhiteSpace(connectionString))
        {
            var containerName = configuration["Azure:ContainerName"];
            if (string.IsNullOrWhiteSpace(containerName))
                throw new InvalidOperationException("Set Azure:ContainerName (lowercase letters, digits and hyphens) to use Azure Blob Storage.");
            _container = new BlobServiceClient(connectionString).GetBlobContainerClient(containerName);
        }
    }

    /// <summary>"azure" or "folder".</summary>
    public string Backend => _container is null ? "folder" : "azure";

    /// <summary>Creates the container / folder if it doesn't exist yet. Called at startup.</summary>
    public async Task EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        if (_container is not null) await _container.CreateIfNotExistsAsync(PublicAccessType.Blob, cancellationToken: cancellationToken);
        else Directory.CreateDirectory(_root);
    }

    private string Prefix => _container is null ? RoutePrefix : _container.Uri.AbsoluteUri.TrimEnd('/') + "/";

    /// <summary>Persist raw bytes and return the media URL.</summary>
    public async Task<string> SaveAsync(byte[] bytes, string extension, string folder = GeneratedFolder, CancellationToken cancellationToken = default)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        return await SaveAsync(stream, extension, folder, cancellationToken);
    }

    /// <summary>Persist a stream (e.g. an uploaded file, without buffering it) and return the media URL.</summary>
    public async Task<string> SaveAsync(Stream content, string extension, string folder = GeneratedFolder, CancellationToken cancellationToken = default)
    {
        var name = $"{folder}/{Guid.NewGuid():N}.{extension.TrimStart('.').ToLowerInvariant()}";
        if (_container is not null)
        {
            var blob = _container.GetBlobClient(name);
            await blob.UploadAsync(content, new BlobUploadOptions
            {
                HttpHeaders = new BlobHttpHeaders { ContentType = MimeFor(name), CacheControl = "public, max-age=31536000, immutable" },
            }, cancellationToken);
            return blob.Uri.AbsoluteUri;
        }

        var path = PathFor(name)!;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var file = File.Create(path))
            await content.CopyToAsync(file, cancellationToken);
        return RoutePrefix + name;
    }

    /// <summary>Persist a base64 payload and return the media URL.</summary>
    public Task<string> SaveBase64Async(string base64, string extension, CancellationToken cancellationToken = default) =>
        SaveAsync(Convert.FromBase64String(base64), extension, GeneratedFolder, cancellationToken);

    /// <summary>True for URLs of files this store holds.</summary>
    public bool IsOwn(string? url) =>
        !string.IsNullOrWhiteSpace(url) && url.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase);

    /// <summary>`{folder}/{file}` from one of our URLs, or null when it isn't ours or looks unsafe.</summary>
    private string? NameOf(string url)
    {
        if (!IsOwn(url)) return null;
        var name = Uri.UnescapeDataString(url[Prefix.Length..].Split('?', '#')[0]);
        return name.Length == 0 || name.Contains("..") || name.Contains('\\') || name.StartsWith('/') ? null : name;
    }

    /// <summary>Full path of a stored file, never outside the storage folder. Null when the name is unsafe.</summary>
    private string? PathFor(string name)
    {
        var path = Path.GetFullPath(Path.Combine(_root, name));
        return path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal) ? path : null;
    }

    /// <summary>Folder backend only: a stored file for the /media endpoint, or null when it doesn't exist.</summary>
    public (string Path, string ContentType)? Locate(string name)
    {
        if (_container is not null || name.Contains("..") || name.Contains('\\')) return null;
        return PathFor(name) is { } path && File.Exists(path) ? (path, MimeFor(name)) : null;
    }

    /// <summary>Bytes of one of our files (used by edits and the document reader), or null.</summary>
    public async Task<(byte[] Bytes, string MimeType)?> TryReadOwnAsync(string url, CancellationToken cancellationToken = default)
    {
        if (NameOf(url) is not { } name) return null;
        if (_container is not null)
        {
            var blob = _container.GetBlobClient(name);
            if (!await blob.ExistsAsync(cancellationToken)) return null;
            var content = await blob.DownloadContentAsync(cancellationToken);
            return (content.Value.Content.ToArray(), MimeFor(name));
        }

        return PathFor(name) is { } path && File.Exists(path)
            ? (await File.ReadAllBytesAsync(path, cancellationToken), MimeFor(name))
            : null;
    }

    /// <summary>Deletes one of our files (no-op for URLs that aren't ours).</summary>
    public async Task DeleteAsync(string url, CancellationToken cancellationToken = default)
    {
        if (NameOf(url) is not { } name) return;
        if (_container is not null) await _container.GetBlobClient(name).DeleteIfExistsAsync(cancellationToken: cancellationToken);
        else if (PathFor(name) is { } path && File.Exists(path)) File.Delete(path);
    }

    /// <summary>
    /// Download a provider's result (signed/expiring CDN links, or Google URIs that need the API key)
    /// and keep it in our storage. Returns null when it can't be fetched.
    /// </summary>
    public async Task<string?> ImportAsync(string url, IDictionary<string, string>? headers = null, CancellationToken cancellationToken = default)
    {
        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(3);
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (headers is not null)
            foreach (var (k, v) in headers) request.Headers.TryAddWithoutValidation(k, v);

        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;
        if (response.Content.Headers.ContentLength > MaxRemoteBytes) return null;

        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (bytes.Length > MaxRemoteBytes) return null;
        var extension = (response.Content.Headers.ContentType?.MediaType ?? "") switch
        {
            "video/mp4" => "mp4",
            "video/webm" => "webm",
            "video/quicktime" => "mov",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/png" => "png",
            "audio/mpeg" => "mp3",
            _ => Path.GetExtension(new Uri(url).AbsolutePath).TrimStart('.') is { Length: > 0 and <= 5 } ext ? ext : "bin",
        };
        return await SaveAsync(bytes, extension, GeneratedFolder, cancellationToken);
    }

    public static string MimeFor(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".avif" => "image/avif",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain; charset=utf-8",
        ".md" => "text/markdown; charset=utf-8",
        ".csv" => "text/csv; charset=utf-8",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".mov" => "video/quicktime",
        ".mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    };
}
