namespace SteamKitPoc;

public class ValveKeyProvider : IDepotKeyProvider
{
    private readonly Func<uint, uint, Task<byte[]?>> _requestKeyAsync;

    public ValveKeyProvider(Func<uint, uint, Task<byte[]?>> requestKeyAsync)
    {
        _requestKeyAsync = requestKeyAsync;
    }

    public DepotKeyResult? GetDepotKey(uint appId, uint depotId)
    {
        try
        {
            var task = _requestKeyAsync(depotId, appId);
            task.Wait(TimeSpan.FromSeconds(15));

            if (task.Result != null)
            {
                var hex = Convert.ToHexString(task.Result).ToLowerInvariant();
                return new DepotKeyResult(depotId, hex, KeySource.Valve);
            }
        }
        catch
        {
        }

        return null;
    }
}
