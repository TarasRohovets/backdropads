using System.Text;
using System.Text.Json;

namespace BackdropAds.Api.Services;

/// <summary>
/// Reads attached PDFs and text files with an LLM (Gemini, AI:Google:TextModel) and turns them into short brief
/// notes for the image/video prompt. Documents are never sent to image or video models themselves.
/// Only our own uploads are read (no arbitrary URLs).
/// </summary>
public class DocumentReader(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    MediaStore mediaStore,
    ILogger<DocumentReader> logger)
{
    private const string BaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private const long MaxTotalBytes = 15 * 1024 * 1024; // keeps the inline request under Gemini's limit
    private const int MaxTextChars = 30_000;
    private const int MaxNotesChars = 2_000;

    public const int MaxDocuments = 5;

    private string Model => configuration["AI:Google:TextModel"] is { Length: > 0 } m ? m : ModelDefaults.GoogleText;

    /// <summary>Brief notes from the documents for this request, or null when there is nothing to read.</summary>
    public async Task<string?> DigestAsync(IReadOnlyList<string> urls, string? request, CancellationToken ct = default)
    {
        var docs = new List<(string Name, string Mime, byte[] Bytes)>();
        long total = 0;
        foreach (var url in urls.Where(mediaStore.IsOwn).Distinct().Take(MaxDocuments))
        {
            if (await mediaStore.TryReadOwnAsync(url, ct) is not { } file) continue;
            if (total + file.Bytes.Length > MaxTotalBytes) break;
            total += file.Bytes.Length;
            docs.Add((Path.GetFileName(url.Split('?', '#')[0]), file.MimeType, file.Bytes));
        }
        if (docs.Count == 0) return null;

        var live = !configuration.GetValue("AI:UseMockData", true) && !string.IsNullOrWhiteSpace(configuration["AI:Google:ApiKey"]);
        if (live)
        {
            try { return await AskLlmAsync(docs, request, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Document reader ({Model}) failed; using the raw text instead.", Model);
            }
        }
        return Fallback(docs);
    }

    private async Task<string?> AskLlmAsync(List<(string Name, string Mime, byte[] Bytes)> docs, string? request, CancellationToken ct)
    {
        var parts = new List<object>();
        for (var i = 0; i < docs.Count; i++)
        {
            var (name, mime, bytes) = docs[i];
            if (mime.StartsWith("application/pdf"))
            {
                parts.Add(new { text = $"Document {i + 1}: {name}" });
                parts.Add(new { inlineData = new { mimeType = "application/pdf", data = Convert.ToBase64String(bytes) } });
            }
            else
            {
                parts.Add(new { text = $"Document {i + 1}: {name}\n{Truncate(Encoding.UTF8.GetString(bytes), MaxTextChars)}" });
            }
        }
        parts.Add(new
        {
            text =
                "You prepare briefs for ecommerce ad images and videos. From the documents above, extract only what helps make this ad: " +
                "product name and facts, key benefits, allowed and forbidden claims, offer and prices, audience, brand voice, text that must " +
                "appear, and visual details (packaging, colors, setting). Ignore everything else. " +
                $"The user's request: \"{(string.IsNullOrWhiteSpace(request) ? "an ad for this product" : Truncate(request, 2000))}\". " +
                "Answer in plain text: at most 12 short bullet points, no preamble.",
        });

        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(90);
        var baseUrl = (configuration["AI:Google:BaseUrl"] is { Length: > 0 } b ? b : BaseUrl).TrimEnd('/');
        using var http = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/models/{Model}:generateContent");
        http.Headers.Add("x-goog-api-key", configuration["AI:Google:ApiKey"]);
        http.Content = JsonContent.Create(new
        {
            contents = new[] { new { parts = parts.ToArray() } },
            generationConfig = new { temperature = 0.2, maxOutputTokens = 900 },
        });

        using var response = await client.SendAsync(http, ct);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var text = string.Concat(json.RootElement.GetProperty("candidates")[0].GetProperty("content").GetProperty("parts")
            .EnumerateArray().Select(p => p.TryGetProperty("text", out var t) ? t.GetString() : null));
        return string.IsNullOrWhiteSpace(text) ? Fallback(docs) : Truncate(text.Trim(), MaxNotesChars);
    }

    /// <summary>No LLM available (mock mode / no key / failure): text files verbatim (trimmed); PDFs only by name.</summary>
    private static string? Fallback(List<(string Name, string Mime, byte[] Bytes)> docs)
    {
        var lines = docs.Select(d => d.Mime.StartsWith("application/pdf")
            ? $"(PDF {d.Name} attached — not read without the document reader)"
            : Truncate(Encoding.UTF8.GetString(d.Bytes).Trim(), 800));
        var notes = string.Join("\n", lines.Where(l => !string.IsNullOrWhiteSpace(l)));
        return string.IsNullOrWhiteSpace(notes) ? null : Truncate(notes, MaxNotesChars);
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";
}
