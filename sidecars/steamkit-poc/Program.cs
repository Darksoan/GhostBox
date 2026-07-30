using SteamKitPoc;

Console.SetOut(new RedactionWriter(Console.Out));
Console.SetError(new RedactionWriter(Console.Error));

var config = ParseArgs(args);
if (config == null) return 1;

var poc = new SteamKitPocRunner(config);
await poc.RunAsync();

return 0;

static Config? ParseArgs(string[] args)
{
    var config = new Config();
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--app-id":
                config.AppId = uint.Parse(args[++i]);
                break;
            case "--deny-probe-app-id":
                config.DenyProbeAppId = uint.Parse(args[++i]);
                break;
            case "--ost-provider":
                config.OstProviderAppId = uint.Parse(args[++i]);
                break;
            case "--steam-path":
                config.SteamPath = args[++i];
                break;
            case "--reuse-session":
                config.ReuseSession = true;
                break;
            case "--corrupt-chunk":
                config.CorruptChunk = true;
                break;
            case "--dry-run":
                config.DryRun = true;
                break;
            case "--bare-download":
                config.BareDownload = true;
                break;
            case "--depot-id":
                config.DepotId = uint.Parse(args[++i]);
                break;
            case "--download":
                config.Download = true;
                break;
            case "--output-dir":
                config.OutputDir = args[++i];
                break;
            case "--manifest-id":
                config.ManifestIdOverride = ulong.Parse(args[++i]);
                break;
        }
    }

    if (config.AppId == 0)
    {
        Console.Error.WriteLine("Error: --app-id is required");
        PrintUsage();
        return null;
    }

    if (config.Download && string.IsNullOrEmpty(config.OutputDir))
    {
        Console.Error.WriteLine("Error: --download requires --output-dir");
        PrintUsage();
        return null;
    }

    if (config.Download && config.DepotId == 0)
    {
        Console.Error.WriteLine("Error: --download requires --depot-id");
        PrintUsage();
        return null;
    }

    return config;
}

static void PrintUsage()
{
    Console.WriteLine("Usage: SteamKitPoc --app-id <uint> [--deny-probe-app-id <uint>] [--ost-provider <uint>]");
    Console.WriteLine("       [--steam-path <path>] [--reuse-session] [--corrupt-chunk]");
    Console.WriteLine("       [--dry-run] [--bare-download --depot-id <uint>]");
    Console.WriteLine("       [--download --depot-id <uint> --output-dir <path> [--manifest-id <ulong>]]");
}

public class Config
{
    public uint AppId { get; set; }
    public uint DenyProbeAppId { get; set; }
    public uint OstProviderAppId { get; set; }
    public string? SteamPath { get; set; }
    public bool ReuseSession { get; set; }
    public bool CorruptChunk { get; set; }
    public bool DryRun { get; set; }
    public bool BareDownload { get; set; }
    public bool Download { get; set; }
    public string? OutputDir { get; set; }
    public ulong ManifestIdOverride { get; set; }
    public uint DepotId { get; set; }
}
