using System.Text.RegularExpressions;

namespace SteamKitPoc;

public class OstKeyProvider : IDepotKeyProvider
{
    private static readonly Regex AddAppIdPattern = new(
        @"addappid\(\s*(\d+)\s*,\s*\d+\s*,\s*""([0-9a-fA-F]{64})""\s*\)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase
    );

    private static readonly Regex SetManifestIdPattern = new(
        @"--setManifestid\(\s*(\d+)\s*,\s*""(\d+)""\s*\)",
        RegexOptions.Compiled
    );

    private readonly string _stPlugInPath;
    private Dictionary<uint, string> _cache = [];
    private Dictionary<uint, ulong> _manifestIds = [];
    private DateTime _lastLoad = DateTime.MinValue;

    public OstKeyProvider(string steamPath)
    {
        _stPlugInPath = Path.Combine(steamPath, "config", "stplug-in");
    }

    public DepotKeyResult? GetDepotKey(uint appId, uint depotId)
    {
        if (_cache.Count == 0 || (DateTime.UtcNow - _lastLoad).TotalSeconds > 30)
            LoadLuaFiles();

        if (_cache.TryGetValue(depotId, out var key))
            return new DepotKeyResult(depotId, key, KeySource.Ost);

        return null;
    }

    public void LoadLuaFiles()
    {
        _cache.Clear();
        _manifestIds.Clear();

        if (!Directory.Exists(_stPlugInPath))
            return;

        foreach (var file in Directory.GetFiles(_stPlugInPath, "*.lua"))
        {
            try
            {
                var content = File.ReadAllText(file);
                foreach (Match match in AddAppIdPattern.Matches(content))
                {
                    var depotId = uint.Parse(match.Groups[1].Value);
                    var key = match.Groups[2].Value.ToLowerInvariant();
                    _cache[depotId] = key;
                }
                foreach (Match match in SetManifestIdPattern.Matches(content))
                {
                    var depotId = uint.Parse(match.Groups[1].Value);
                    var manifestId = ulong.Parse(match.Groups[2].Value);
                    _manifestIds[depotId] = manifestId;
                }
            }
            catch
            {
                // skip unreadable files
            }
        }

        _lastLoad = DateTime.UtcNow;
    }

    public ulong? GetManifestId(uint depotId)
    {
        if (_manifestIds.Count == 0 || (DateTime.UtcNow - _lastLoad).TotalSeconds > 30)
            LoadLuaFiles();

        if (_manifestIds.TryGetValue(depotId, out var manifestId))
            return manifestId;

        return null;
    }

    public void Refresh() => LoadLuaFiles();

    public IReadOnlyDictionary<uint, string> GetAllKeys()
    {
        if (_cache.Count == 0 || (DateTime.UtcNow - _lastLoad).TotalSeconds > 30)
            LoadLuaFiles();
        return _cache;
    }
}
