namespace SteamKitPoc;

public enum KeySource { None, Ost, DepotKeyStore, Valve }

public record DepotKeyResult(uint DepotId, string KeyHex, KeySource Source);

public interface IDepotKeyProvider
{
    DepotKeyResult? GetDepotKey(uint appId, uint depotId);
}
