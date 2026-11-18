using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

public static class UploadEndpoints
{
    /// <summary>Attachments across the platform: images, PDF and plain text only.</summary>
    private static readonly string[] AllowedAttachmentTypes =
        ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "application/pdf", "text/plain", "text/markdown", "text/csv"];

    private static readonly string[] AllowedAttachmentExtensions =
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".pdf", ".txt", ".md", ".csv"];

    /// <summary>Ad media for Analyze may also be a video (the video is the ad being analyzed).</summary>
    private static readonly string[] AllowedAdVideoExtensions = [".mp4", ".mov", ".webm"];

    private const long MaxAttachmentBytes = 20 * 1024 * 1024;
    private const long MaxAdVideoBytes = 200 * 1024 * 1024;

    public static IEndpointRouteBuilder MapUploadEndpoints(this IEndpointRouteBuilder app)
    {
        // Stores the file in media storage (uploads/ folder) and in the workspace's upload library, and returns
        // the library entry. `?purpose=` source (default) | attachment | logo | ad — `ad` also allows video for Analyze.
        app.MapPost("/api/uploads", async (HttpRequest request, string? purpose, MediaStore media, AppStore store, IUserContext userContext) =>
        {
            purpose = purpose is "attachment" or "logo" or "ad" ? purpose : "source";
            string kind = "image";
            Upload? saved = null;
            if (request.HasFormContentType)
            {
                var form = await request.ReadFormAsync();
                var file = form.Files.GetFile("file");
                if (file is not null)
                {
                    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                    var type = (file.ContentType ?? "").ToLowerInvariant();
                    var isAdVideo = purpose == "ad" && (AllowedAdVideoExtensions.Contains(ext) || type.StartsWith("video/"));
                    var isAttachment = AllowedAttachmentExtensions.Contains(ext) || AllowedAttachmentTypes.Contains(type);

                    if (!isAttachment && !isAdVideo)
                        return Results.BadRequest(new { error = "Only images, PDF and text files are allowed." });
                    if (file.Length > (isAdVideo ? MaxAdVideoBytes : MaxAttachmentBytes))
                        return Results.BadRequest(new { error = $"That file is too large (max {(isAdVideo ? 200 : 20)} MB)." });

                    kind = isAdVideo ? "video" : ext == ".pdf" || type == "application/pdf" ? "pdf"
                        : type.StartsWith("text/") || ext is ".txt" or ".md" or ".csv" ? "text" : "image";

                    // Only allow-listed extensions are stored, so a file can never be served as HTML/SVG.
                    var storedExt = AllowedAttachmentExtensions.Contains(ext) || AllowedAdVideoExtensions.Contains(ext) ? ext
                        : kind switch { "pdf" => ".pdf", "text" => ".txt", "video" => ".mp4", _ => type switch
                        {
                            "image/png" => ".png", "image/webp" => ".webp", "image/gif" => ".gif", "image/avif" => ".avif", _ => ".jpg",
                        } };
                    await using var stream = file.OpenReadStream();
                    var url = await media.SaveAsync(stream, storedExt, MediaStore.UploadsFolder, request.HttpContext.RequestAborted);
                    var name = Path.GetFileName(file.FileName);
                    saved = store.AddUpload(new Upload
                    {
                        Id = Ids.New("upl"),
                        WorkspaceId = userContext.WorkspaceId,
                        UserId = userContext.UserId,
                        Url = url,
                        Kind = kind,
                        Purpose = purpose,
                        FileName = string.IsNullOrWhiteSpace(name) ? $"upload{storedExt}" : name[..Math.Min(name.Length, 200)],
                        ContentType = MediaStore.MimeFor(storedExt),
                        SizeBytes = file.Length,
                        CreatedAt = DateTimeOffset.UtcNow,
                    });
                }
            }

            var imageSeed = $"upload-{Guid.NewGuid().ToString("N")[..10]}";
            if (saved is not null) return Results.Ok(new { saved.Id, saved.Url, imageSeed, saved.Kind, saved.Purpose, saved.FileName, saved.SizeBytes, saved.CreatedAt });
            // No file sent → a placeholder image (kept for the mock flows); nothing is stored.
            return Results.Ok(new { url = $"https://picsum.photos/seed/{imageSeed}/1200/1500", imageSeed, kind });
        }).WithTags("Uploads").DisableAntiforgery()
            // Ad videos for Analyze go up to 200 MB (the server default body limit is 30 MB).
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxAdVideoBytes + 10 * 1024 * 1024))
            .WithFormOptions(multipartBodyLengthLimit: MaxAdVideoBytes + 10 * 1024 * 1024);

        // The workspace's upload library, newest first. `kind` = image | video | pdf | text, `purpose` = source | attachment | ad | logo.
        app.MapGet("/api/uploads", (AppStore store, IUserContext userContext, string? kind, string? purpose) =>
            Results.Ok(store.ListUploads(userContext.WorkspaceId, kind, purpose)))
            .WithTags("Uploads");

        app.MapGet("/api/uploads/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.GetUpload(id, userContext.WorkspaceId) is { } upload ? Results.Ok(upload) : Results.NotFound(new { error = "Upload not found." }))
            .WithTags("Uploads");

        // Removes it from the library and deletes the file. Ads already made from it keep their own generated images.
        app.MapDelete("/api/uploads/{id}", async (string id, AppStore store, MediaStore media, IUserContext userContext, CancellationToken ct) =>
        {
            if (store.RemoveUpload(id, userContext.WorkspaceId) is not { } removed) return Results.NotFound(new { error = "Upload not found." });
            await media.DeleteAsync(removed.Url, ct);
            return Results.NoContent();
        }).WithTags("Uploads");

        return app;
    }
}
