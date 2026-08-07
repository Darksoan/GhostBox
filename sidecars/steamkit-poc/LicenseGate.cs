namespace SteamKitPoc;

public class LicenseGate
{
    private readonly List<IDepotKeyProvider> _providers;
    private readonly Dictionary<(uint AppId, uint DepotId), KeySource> _auditLog = [];

    public LicenseGate(OstKeyProvider ost, ValveKeyProvider valve)
    {
        _providers =
        [
            ost,
            valve,
        ];
    }

    public DepotKeyResult? Resolve(uint appId, uint depotId)
    {
        foreach (var provider in _providers)
        {
            var result = provider.GetDepotKey(appId, depotId);
            if (result != null)
            {
                _auditLog[(appId, depotId)] = result.Source;
                LogResolved(appId, depotId, result.Source);
                return result;
            }
        }

        _auditLog[(appId, depotId)] = KeySource.None;
        LogDenied(appId, depotId);
        return null;
    }

    public IReadOnlyDictionary<(uint, uint), KeySource> AuditLog => _auditLog;

    public void PrintAudit()
    {
        Console.WriteLine("=== LICENSE GATE AUDIT ===");
        foreach (var ((appId, depotId), source) in _auditLog)
        {
            Console.WriteLine($"AUDIT: appId={appId} depotId={depotId} source={source}");
        }
    }

    private static void LogResolved(uint appId, uint depotId, KeySource source)
    {
        Console.WriteLine($"MARCO=DepotAccessGranted ok=true source={source} appId={appId} depotId={depotId}");
    }

    private static void LogDenied(uint appId, uint depotId)
    {
        Console.WriteLine($"MARCO=DepotAccessDenied ok=true appId={appId} depotId={depotId}");
    }
}
