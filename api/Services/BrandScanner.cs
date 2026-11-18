using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace BackdropAds.Api.Services;

/// <summary>What a website scan found — a draft the user reviews before saving as a brand kit.</summary>
public class BrandScanResult
{
    public string SourceUrl { get; set; } = "";
    public string BrandName { get; set; } = "";
    public string? LogoUrl { get; set; }
    public List<string> LogoCandidates { get; set; } = [];
    public List<string> Colors { get; set; } = [];
    public List<string> Fonts { get; set; } = [];
    public string? Context { get; set; }
}

public class BrandScanException(string message) : Exception(message);

/// <summary>
/// Extracts brand signals from a public website with plain HTTP + pattern matching (no AI needed):
/// name (og:site_name / title), logo (logo-tagged images, touch icons, favicons, og:image),
/// colors (theme-color + most frequent saturated CSS colors), fonts (Google Fonts links +
/// font-family frequency) and a description for context. Refuses private/loopback hosts (SSRF).
/// </summary>
public partial class BrandScanner(IHttpClientFactory httpClientFactory, ILogger<BrandScanner> logger)
{
    private const int MaxHtmlBytes = 2_000_000;
    private const int MaxCssBytes = 600_000;
    private const int MaxStylesheets = 4;

    private static readonly HashSet<string> GenericFonts = new(StringComparer.OrdinalIgnoreCase)
    {
        "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif",
        "ui-monospace", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "arial",
        "helvetica", "helvetica neue", "segoe ui", "roboto", "times new roman", "times", "georgia",
        "verdana", "tahoma", "courier new", "courier", "apple color emoji", "segoe ui emoji",
        "segoe ui symbol", "noto color emoji", "emoji", "math", "var", "icons", "fontawesome",
        "font awesome 5 free", "font awesome 6 free", "material icons", "swiper-icons", "slick", "revicons",
    };

    public async Task<BrandScanResult> ScanAsync(string rawUrl, CancellationToken ct)
    {
        var uri = Normalize(rawUrl);
        await EnsurePublicHostAsync(uri, ct);

        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(12);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; BackdropAdsBrandScanner/1.0)");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,text/css;q=0.9,*/*;q=0.8");

        string html;
        Uri baseUri;
        try
        {
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
                throw new BrandScanException($"The site answered with {(int)response.StatusCode}. Check the address or try the homepage.");
            baseUri = response.RequestMessage?.RequestUri ?? uri;
            html = await ReadCappedAsync(response, MaxHtmlBytes, ct);
        }
        catch (BrandScanException) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new BrandScanException("We couldn't reach that website. Check the address and try again.");
        }

        var result = new BrandScanResult { SourceUrl = baseUri.ToString() };

        // --- Name -------------------------------------------------------------------------------
        var siteName = Meta(html, "og:site_name") ?? Meta(html, "application-name");
        var title = TitleRegex().Match(html) is { Success: true } t ? WebUtility.HtmlDecode(t.Groups[1].Value).Trim() : null;
        result.BrandName = CleanName(siteName ?? title) ?? HostName(baseUri);

        // --- Context ----------------------------------------------------------------------------
        var description = Meta(html, "description") ?? Meta(html, "og:description");
        result.Context = string.IsNullOrWhiteSpace(description) ? null : WebUtility.HtmlDecode(description).Trim();

        // --- Logo -------------------------------------------------------------------------------
        var candidates = new List<string>();
        var brandKey = HostName(baseUri).ToLowerInvariant();
        var nameKey = result.BrandName.ToLowerInvariant().Replace(" ", "");
        var brandLogos = new List<string>();
        var otherLogos = new List<string>();
        foreach (Match img in ImgTagRegex().Matches(html))
        {
            var tag = img.Value;
            if (!tag.Contains("logo", StringComparison.OrdinalIgnoreCase)) continue;
            var src = Attr(tag, "src") ?? Attr(tag, "data-src");
            if (src is null) continue;
            var lower = tag.ToLowerInvariant().Replace(" ", "");
            (lower.Contains(brandKey) || (nameKey.Length > 2 && lower.Contains(nameKey)) ? brandLogos : otherLogos).Add(src);
        }
        candidates.AddRange(brandLogos);
        // Logo images that don't name the brand are often customer/partner logos — rank them below site icons.
        foreach (Match link in LinkTagRegex().Matches(html))
        {
            var tag = link.Value;
            var rel = Attr(tag, "rel") ?? "";
            var href = Attr(tag, "href");
            if (href is null) continue;
            if (rel.Contains("apple-touch-icon", StringComparison.OrdinalIgnoreCase)) candidates.Add(href);
        }
        foreach (Match link in LinkTagRegex().Matches(html))
        {
            var tag = link.Value;
            var rel = Attr(tag, "rel") ?? "";
            var href = Attr(tag, "href");
            if (href is not null && Regex.IsMatch(rel, @"(^|\s)icon(\s|$)", RegexOptions.IgnoreCase)) candidates.Add(href);
        }
        if (Meta(html, "og:image") is { } ogImage) candidates.Add(ogImage);
        candidates.Add("/favicon.ico");
        candidates.AddRange(otherLogos.Take(2));

        result.LogoCandidates = candidates
            .Select(c => Resolve(baseUri, WebUtility.HtmlDecode(c)))
            .Where(c => c is not null)
            .Select(c => c!)
            .Distinct()
            .Take(6)
            .ToList();
        result.LogoUrl = result.LogoCandidates.FirstOrDefault();

        // --- CSS: inline styles + a few stylesheets ----------------------------------------------
        var css = new System.Text.StringBuilder();
        foreach (Match style in StyleBlockRegex().Matches(html)) css.AppendLine(style.Groups[1].Value);
        foreach (Match attr in StyleAttrRegex().Matches(html)) css.AppendLine(attr.Groups[1].Value);

        var googleFonts = new List<string>();
        var sheetUrls = new List<Uri>();
        foreach (Match link in LinkTagRegex().Matches(html))
        {
            var tag = link.Value;
            var href = Attr(tag, "href");
            if (href is null) continue;
            var resolved = Resolve(baseUri, WebUtility.HtmlDecode(href));
            if (resolved is null) continue;

            if (resolved.Contains("fonts.googleapis.com", StringComparison.OrdinalIgnoreCase))
            {
                foreach (Match fam in GoogleFamilyRegex().Matches(resolved))
                    googleFonts.Add(Uri.UnescapeDataString(fam.Groups[1].Value).Replace('+', ' ').Split(':')[0].Trim());
                continue;
            }
            if ((Attr(tag, "rel") ?? "").Contains("stylesheet", StringComparison.OrdinalIgnoreCase) && sheetUrls.Count < MaxStylesheets)
                sheetUrls.Add(new Uri(resolved));
        }

        foreach (var sheet in sheetUrls)
        {
            try
            {
                await EnsurePublicHostAsync(sheet, ct);
                using var res = await client.GetAsync(sheet, HttpCompletionOption.ResponseHeadersRead, ct);
                if (res.IsSuccessStatusCode) css.AppendLine(await ReadCappedAsync(res, MaxCssBytes, ct));
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Skipping stylesheet {Sheet}", sheet);
            }
        }
        var cssText = css.ToString();

        // --- Colors -----------------------------------------------------------------------------
        var colorCounts = new Dictionary<string, int>();
        void Count(string hex, int weight = 1) => colorCounts[hex] = colorCounts.GetValueOrDefault(hex) + weight;

        if (Meta(html, "theme-color") is { } themeColor && ToHex(themeColor) is { } themeHex) Count(themeHex, 1000);
        foreach (Match m in BrandVarRegex().Matches(cssText)) if (ToHex(m.Groups[1].Value) is { } bv) Count(bv, 60);
        foreach (Match m in HexColorRegex().Matches(cssText)) if (ToHex(m.Value) is { } h) Count(h);
        foreach (Match m in RgbColorRegex().Matches(cssText))
            if (int.TryParse(m.Groups[1].Value, out var r) && int.TryParse(m.Groups[2].Value, out var g) && int.TryParse(m.Groups[3].Value, out var b))
                Count($"#{Math.Clamp(r, 0, 255):X2}{Math.Clamp(g, 0, 255):X2}{Math.Clamp(b, 0, 255):X2}");

        var ranked = colorCounts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
        var brandColors = ranked.Where(IsBrandish).Take(3).ToList();
        // One anchor neutral (the site's dominant dark) so kits have a text/background color.
        var neutral = ranked.FirstOrDefault(c => !IsBrandish(c) && Luminance(c) < 0.25);
        if (neutral is not null && brandColors.Count < 4) brandColors.Add(neutral);
        if (brandColors.Count == 0) brandColors.AddRange(ranked.Take(2));
        result.Colors = brandColors.Distinct().Take(4).ToList();

        // --- Fonts ------------------------------------------------------------------------------
        var fontCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var gf in googleFonts) fontCounts[gf] = fontCounts.GetValueOrDefault(gf) + 1000;
        foreach (Match m in FontFamilyRegex().Matches(cssText))
        {
            foreach (var raw in m.Groups[1].Value.Split(','))
            {
                var name = raw.Replace("\\", "").Trim().Trim('"', '\'', '(', ')', ' ').Trim();
                if (name.Length < 2 || name.StartsWith("var(", StringComparison.OrdinalIgnoreCase) || GenericFonts.Contains(name)) continue;
                // Only plausible family names; skip emoji/icon fonts and anything with stray CSS syntax.
                if (!FontNameRegex().IsMatch(name) ||
                    name.Contains("emoji", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("icon", StringComparison.OrdinalIgnoreCase)) continue;
                fontCounts[name] = fontCounts.GetValueOrDefault(name) + 1;
                break; // the first real family in a stack is the intended one
            }
        }
        static bool IsCodeFont(string f) =>
            f.Contains("mono", StringComparison.OrdinalIgnoreCase) || f.Contains("code", StringComparison.OrdinalIgnoreCase);
        var rankedFonts = fontCounts.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
        // Brand typography first; monospace/code fonts only if nothing else was found.
        result.Fonts = rankedFonts.Where(f => !IsCodeFont(f)).Concat(rankedFonts.Where(IsCodeFont)).Take(2).ToList();

        return result;
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static Uri Normalize(string raw)
    {
        var value = raw.Trim();
        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            value = "https://" + value;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !uri.Host.Contains('.'))
            throw new BrandScanException("That doesn't look like a website address.");
        return uri;
    }

    private static async Task EnsurePublicHostAsync(Uri uri, CancellationToken ct)
    {
        IPAddress[] addresses;
        try { addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, ct); }
        catch { throw new BrandScanException("We couldn't find that website. Check the address."); }

        foreach (var ip in addresses)
        {
            if (IPAddress.IsLoopback(ip) || IsPrivate(ip))
                throw new BrandScanException("That address points to a private network and can't be scanned.");
        }
    }

    private static bool IsPrivate(IPAddress ip)
    {
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

    private static string? Meta(string html, string key)
    {
        foreach (Match m in MetaTagRegex().Matches(html))
        {
            var tag = m.Value;
            var name = Attr(tag, "property") ?? Attr(tag, "name");
            if (name is not null && name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return Attr(tag, "content") is { Length: > 0 } content ? content : null;
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
        if (href.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return null;
        return Uri.TryCreate(baseUri, href, out var abs) && (abs.Scheme == "http" || abs.Scheme == "https") ? abs.ToString() : null;
    }

    private static string? CleanName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = Regex.Split(WebUtility.HtmlDecode(raw), @"\s[|\-–—:·•]\s").Select(p => p.Trim()).Where(p => p.Length > 1).ToList();
        if (parts.Count == 0) return null;
        // Brand names are usually the shortest segment ("Acme | Shoes for running" → "Acme").
        var best = parts.OrderBy(p => p.Length).First();
        return best.Length > 40 ? best[..40] : best;
    }

    private static string HostName(Uri uri)
    {
        var host = uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host;
        var label = host.Split('.')[0];
        return label.Length == 0 ? host : char.ToUpperInvariant(label[0]) + label[1..];
    }

    private static string? ToHex(string value)
    {
        var v = value.Trim().TrimStart('#');
        if (v.Length == 3) v = string.Concat(v.Select(c => $"{c}{c}"));
        if (v.Length == 8) v = v[..6];
        return v.Length == 6 && v.All(Uri.IsHexDigit) ? "#" + v.ToUpperInvariant() : null;
    }

    private static (double R, double G, double B) Rgb(string hex) =>
        (Convert.ToInt32(hex[1..3], 16) / 255.0, Convert.ToInt32(hex[3..5], 16) / 255.0, Convert.ToInt32(hex[5..7], 16) / 255.0);

    private static double Luminance(string hex)
    {
        var (r, g, b) = Rgb(hex);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /// <summary>Saturated and not near-white/near-black — the colors that make a brand recognizable.</summary>
    private static bool IsBrandish(string hex)
    {
        var (r, g, b) = Rgb(hex);
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var saturation = max == 0 ? 0 : (max - min) / max;
        return saturation > 0.28 && max > 0.18 && !(min > 0.9);
    }

    [GeneratedRegex(@"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex TitleRegex();
    [GeneratedRegex(@"<meta\b[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex MetaTagRegex();
    [GeneratedRegex(@"<link\b[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex LinkTagRegex();
    [GeneratedRegex(@"<img\b[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex ImgTagRegex();
    [GeneratedRegex(@"<style[^>]*>(.*?)</style>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex StyleBlockRegex();
    [GeneratedRegex(@"\bstyle\s*=\s*""([^""]*)""", RegexOptions.IgnoreCase)] private static partial Regex StyleAttrRegex();
    [GeneratedRegex(@"family=([^&""'\s]+)", RegexOptions.IgnoreCase)] private static partial Regex GoogleFamilyRegex();
    [GeneratedRegex(@"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")] private static partial Regex HexColorRegex();
    [GeneratedRegex(@"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})")] private static partial Regex RgbColorRegex();
    [GeneratedRegex(@"font-family\s*:\s*([^;}{]+)", RegexOptions.IgnoreCase)] private static partial Regex FontFamilyRegex();
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 \-]{1,40}$")] private static partial Regex FontNameRegex();
    [GeneratedRegex(@"--[\w-]*(?:brand|primary|accent)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8})\b", RegexOptions.IgnoreCase)] private static partial Regex BrandVarRegex();
}
