using System.Text;

namespace BackdropAds.Api.Domain;

/// <summary>
/// Stable, framework-independent hashing so mock content derived from an entity id
/// is identical on every read. Never use System.Random or string.GetHashCode here.
/// </summary>
public static class Determinism
{
    /// <summary>FNV-1a 32-bit hash over the UTF-8 bytes of the key.</summary>
    public static uint Hash(string key)
    {
        unchecked
        {
            uint hash = 2166136261;
            foreach (var b in Encoding.UTF8.GetBytes(key))
            {
                hash ^= b;
                hash *= 16777619;
            }
            return hash;
        }
    }

    /// <summary>Stable index in [0, count).</summary>
    public static int Pick(string key, int count) => (int)(Hash(key) % (uint)count);

    /// <summary>Stable value in [min, maxInclusive].</summary>
    public static int Range(string key, int min, int maxInclusive) =>
        min + (int)(Hash(key) % (uint)(maxInclusive - min + 1));

    /// <summary>Short stable hex string (8 chars) for image seeds and derived ids.</summary>
    public static string Hex(string key) => Hash(key).ToString("x8");
}

/// <summary>Entity id generation ("gen_a1b2c3d4e5f6" style).</summary>
public static class Ids
{
    public static string New(string prefix) => $"{prefix}_{Guid.NewGuid().ToString("N")[..12]}";
}
