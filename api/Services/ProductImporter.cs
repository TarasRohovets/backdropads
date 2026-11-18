using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BackdropAds.Api.Services;

/// <summary>What we could read off a product page — the brief for product ads.</summary>
public class ProductImport
{
    public string SourceUrl { get; set; } = "";
    /// <summary>"shopify" | "woocommerce" | "generic"</summary>
    public string Platform { get; set; } = "generic";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Brand { get; set; }
    /// <summary>As shown on the store, e.g. "34.00".</summary>
    public string? Price { get; set; }
    public string? Currency { get; set; }
    public List<string> Images { get; set; } = [];
}

public class ProductImportException(string message) : Exception(message);

/// <summary>
/// Paste-a-product-link import. Shopify stores expose a public product JSON (/products/{handle}.json);
/// every other store is read from schema.org Product JSON-LD, then Open Graph / product meta tags.
/// Plain HTTP, no AI. SSRF-guarded: public hosts only, redirects followed manually and re-checked.
/// </summary>
public partial class ProductImporter(IHttpClientFactory httpClientFactory, ILogger<ProductImporter> logger)
{
    public const string ClientName = "product-importer";
    private const int MaxHtmlBytes = 1_500_000;
    private const int MaxRedirects = 4;

    public async Task<ProductImport> ImportAsync(string rawUrl, CancellationToken ct)
    {
        var uri = Normalize(rawUrl);
        var result = new ProductImport { SourceUrl = uri.ToString() };

        // Any /products/{handle} link: Shopify's public product JSON first — it often works even when
        // the storefront HTML sits behind bot protection.
        var fromShopify = ShopifyHandle(uri) is { } productPath
                          && await TryShopifyJsonAsync(new Uri(uri, productPath + ".json"), result, ct);
        if (fromShopify) result.Platform = "shopify";

        string html;
        Uri finalUri;
        try
        {
            (finalUri, html) = await FetchAsync(uri, "text/html,application/xhtml+xml", ct);
        }
        catch (ProductImportException) when (fromShopify)
        {
            (finalUri, html) = (uri, "");
        }

        result.SourceUrl = finalUri.ToString();
        if (!fromShopify)
            result.Platform = html.Contains("cdn.shopify.com", StringComparison.OrdinalIgnoreCase) ? "shopify"
                : html.Contains("woocommerce", StringComparison.OrdinalIgnoreCase) ? "woocommerce"
                : "generic";

        var fromJsonLd = ApplyJsonLd(html, finalUri, result);
        ApplyMeta(html, finalUri, result);

        // A homepage or blog post has a title too — only accept pages that look like a product.
        var looksLikeProduct = fromShopify || fromJsonLd || result.Price is not null;
        if (string.IsNullOrWhiteSpace(result.Title) || !looksLikeProduct)
            throw new ProductImportException("We couldn't find a product on that page. Paste the product page itself, not the homepage.");

        result.Title = Clean(result.Title, 120)!;
        result.Description = Clean(StripHtml(result.Description), 600);
        result.Brand = Clean(result.Brand, 60);
        result.Images = [.. result.Images.Where(i => !string.IsNullOrWhiteSpace(i)).Distinct().Take(6)];
        return result;
    }

    // ---- Shopify ---------------------------------------------------------------------------------

    /// <summary>"/collections/x/products/glow-serum?variant=1" → "/products/glow-serum".</summary>
    private static string? ShopifyHandle(Uri uri)
    {
        var m = ShopifyPathRegex().Match(uri.AbsolutePath);
        return m.Success ? $"/products/{m.Groups[1].Value}" : null;
    }

    private async Task<bool> TryShopifyJsonAsync(Uri jsonUri, ProductImport result, CancellationToken ct)
    {
        try
        {
            var (_, body) = await FetchAsync(jsonUri, "application/json", ct);
            using var doc = JsonDocument.Parse(body);
            var product = doc.RootElement.GetProperty("product");
            result.Title = Str(product, "title") ?? result.Title;
            result.Description = Str(product, "body_html") ?? result.Description;
            result.Brand = Str(product, "vendor") ?? result.Brand;
            if (product.TryGetProperty("variants", out var variants) && variants.GetArrayLength() > 0)
                result.Price = Str(variants[0], "price") ?? result.Price;
            if (product.TryGetProperty("images", out var images))
                foreach (var image in images.EnumerateArray())
                    if (Str(image, "src") is { } src) result.Images.Add(src);
            return !string.IsNullOrWhiteSpace(result.Title);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Not Shopify, or the store disabled the JSON endpoint — the HTML fallbacks still work.
            logger.LogInformation("Shopify product JSON unavailable at {Url}: {Error}", jsonUri, ex.Message);
            return false;
        }
    }

    // ---- schema.org JSON-LD ------------------------------------------------------------------------

    /// <summary>True when the page carries a schema.org Product.</summary>
    private static bool ApplyJsonLd(string html, Uri baseUri, ProductImport result)
    {
        foreach (Match m in JsonLdRegex().Matches(html))
        {
            JsonDocument doc;
            try { doc = JsonDocument.Parse(WebUtility.HtmlDecode(m.Groups[1].Value.Trim())); }
            catch (JsonException) { continue; }

            using (doc)
            {
                if (FindProduct(doc.RootElement) is not { } product) continue;
                if (string.IsNullOrWhiteSpace(result.Title)) result.Title = Str(product, "name") ?? "";
                result.Description ??= Str(product, "description");
                if (result.Brand is null && product.TryGetProperty("brand", out var brand))
                    result.Brand = brand.ValueKind == JsonValueKind.String ? brand.GetString() : Str(brand, "name");

                if (product.TryGetProperty("image", out var image))
                {
                    foreach (var src in ImageUrls(image))
                        if (Resolve(baseUri, src) is { } abs) result.Images.Add(abs);
                }

                if (product.TryGetProperty("offers", out var offers))
                {
                    var offer = offers.ValueKind == JsonValueKind.Array && offers.GetArrayLength() > 0 ? offers[0] : offers;
                    if (offer.ValueKind == JsonValueKind.Object)
                    {
                        result.Price ??= Str(offer, "price") ?? Str(offer, "lowPrice");
                        result.Currency ??= Str(offer, "priceCurrency");
                    }
                }
                return true;
            }
        }
        return false;
    }

    private static JsonElement? FindProduct(JsonElement node)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray())
                    if (FindProduct(item) is { } found) return found;
                break;
            case JsonValueKind.Object:
                if (node.TryGetProperty("@type", out var type) &&
                    (type.ValueKind == JsonValueKind.String ? type.GetString() == "Product"
                        : type.ValueKind == JsonValueKind.Array && type.EnumerateArray().Any(t => t.GetString() == "Product")))
                    return node;
                if (node.TryGetProperty("@graph", out var graph)) return FindProduct(graph);
                break;
        }
        return null;
    }

    private static IEnumerable<string> ImageUrls(JsonElement image) => image.ValueKind switch
    {
        JsonValueKind.String => [image.GetString()!],
        JsonValueKind.Array => image.EnumerateArray().SelectMany(ImageUrls),
        JsonValueKind.Object => Str(image, "url") is { } url ? [url] : [],
        _ => [],
    };

    // ---- Open Graph / product meta -----------------------------------------------------------------

    private static void ApplyMeta(string html, Uri baseUri, ProductImport result)
    {
        if (string.IsNullOrWhiteSpace(result.Title))
        {
            var title = TitleRegex().Match(html);
            result.Title = Meta(html, "og:title") ?? (title.Success ? WebUtility.HtmlDecode(title.Groups[1].Value) : "");
        }
        result.Description ??= Meta(html, "og:description") ?? Meta(html, "description");
        result.Price ??= Meta(html, "product:price:amount") ?? Meta(html, "og:price:amount");
        result.Currency ??= Meta(html, "product:price:currency") ?? Meta(html, "og:price:currency");
        result.Brand ??= Meta(html, "product:brand") ?? Meta(html, "og:site_name");
        if (Meta(html, "og:image") is { } og && Resolve(baseUri, og) is { } abs) result.Images.Add(abs);
    }

    // ---- safe fetching -----------------------------------------------------------------------------

    /// <summary>GET with manual redirects so every hop is re-checked against private networks.</summary>
    private async Task<(Uri FinalUri, string Body)> FetchAsync(Uri uri, string accept, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient(ClientName);
        var current = uri;
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            await EnsurePublicHostAsync(current, ct);
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (compatible; BackdropAdsProductImport/1.0)");
            request.Headers.Accept.ParseAdd(accept);

            HttpResponseMessage response;
            try { response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct); }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                throw new ProductImportException("We couldn't reach that page. Check the link and try again.");
            }

            using (response)
            {
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
                {
                    current = new Uri(current, location);
                    if (current.Scheme is not ("http" or "https"))
                        throw new ProductImportException("That link redirects somewhere we can't follow.");
                    continue;
                }
                if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
                    throw new ProductImportException("That store blocks automatic reading. Upload a product photo instead.");
                if (!response.IsSuccessStatusCode)
                    throw new ProductImportException($"The page answered with {(int)response.StatusCode}. Check the link.");
                return (current, await ReadCappedAsync(response, MaxHtmlBytes, ct));
            }
        }
        throw new ProductImportException("That link redirects too many times.");
    }

    private static Uri Normalize(string raw)
    {
        var value = raw.Trim();
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            value = "https://" + value;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !uri.Host.Contains('.'))
            throw new ProductImportException("That doesn't look like a product link.");
        return uri;
    }

    /// <summary>Shared SSRF guard: throws unless every address of the host is public.</summary>
    public static async Task EnsurePublicHostAsync(Uri uri, CancellationToken ct)
    {
        IPAddress[] addresses;
        try { addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new ProductImportException("We couldn't find that website. Check the link.");
        }
        if (addresses.Length == 0 || addresses.Any(ip => IPAddress.IsLoopback(ip) || IsPrivate(ip)))
            throw new ProductImportException("That address points to a private network and can't be read.");
    }

    private static bool IsPrivate(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal || ip.Equals(IPAddress.IPv6Loopback);
        var b = ip.GetAddressBytes();
        return b[0] == 10 || b[0] == 127 || b[0] == 0 || (b[0] == 169 && b[1] == 254) ||
               (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) ||
               (b[0] == 100 && b[1] >= 64 && b[1] <= 127);
    }

    private static async Task<string> ReadCappedAsync(HttpResponseMessage response, int maxBytes, CancellationToken ct)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var buffer = new byte[maxBytes];
        var total = 0;
        int read;
        while (total < maxBytes && (read = await stream.ReadAsync(buffer.AsMemory(total, maxBytes - total), ct)) > 0) total += read;
        return System.Text.Encoding.UTF8.GetString(buffer, 0, total);
    }

    // ---- small helpers ---------------------------------------------------------------------------

    private static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v)
            ? v.ValueKind switch
            {
                JsonValueKind.String => string.IsNullOrWhiteSpace(v.GetString()) ? null : v.GetString(),
                JsonValueKind.Number => v.GetRawText(),
                _ => null,
            }
            : null;

    private static string? Meta(string html, string key)
    {
        foreach (Match m in MetaTagRegex().Matches(html))
        {
            var tag = m.Value;
            var name = Attr(tag, "property") ?? Attr(tag, "name") ?? Attr(tag, "itemprop");
            if (name is not null && name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return Attr(tag, "content") is { Length: > 0 } content ? WebUtility.HtmlDecode(content) : null;
        }
        return null;
    }

    private static string? Attr(string tag, string attr)
    {
        var m = Regex.Match(tag, $@"\b{Regex.Escape(attr)}\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>]+))", RegexOptions.IgnoreCase);
        if (!m.Success) return null;
        var value = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string? Resolve(Uri baseUri, string href)
    {
        if (href.StartsWith("//")) href = baseUri.Scheme + ":" + href;
        if (href.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return null;
        return Uri.TryCreate(baseUri, href, out var abs) && (abs.Scheme == "http" || abs.Scheme == "https") ? abs.ToString() : null;
    }

    private static string? StripHtml(string? value) =>
        value is null ? null : WhitespaceRegex().Replace(WebUtility.HtmlDecode(TagRegex().Replace(value, " ")), " ").Trim();

    private static string? Clean(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = WhitespaceRegex().Replace(WebUtility.HtmlDecode(value), " ").Trim();
        return v.Length > max ? v[..max].TrimEnd() + "…" : v;
    }

    [GeneratedRegex(@"/products/([A-Za-z0-9\-_%.]+)", RegexOptions.IgnoreCase)] private static partial Regex ShopifyPathRegex();
    [GeneratedRegex(@"<script[^>]+type\s*=\s*[""']application/ld\+json[""'][^>]*>(.*?)</script>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex JsonLdRegex();
    [GeneratedRegex(@"<meta\b[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex MetaTagRegex();
    [GeneratedRegex(@"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex TitleRegex();
    [GeneratedRegex(@"<[^>]+>")] private static partial Regex TagRegex();
    [GeneratedRegex(@"\s+")] private static partial Regex WhitespaceRegex();
}
