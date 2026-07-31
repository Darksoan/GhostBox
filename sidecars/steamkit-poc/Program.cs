using SteamKitPoc;
using DepotDownloader;
using System.Collections.Concurrent;
using System.Text.Json;
using SteamKit2;
using SteamKit2.CDN;

Console.SetOut(new RedactionWriter(Console.Out));
Console.SetError(new RedactionWriter(Console.Error));

var config = ParseArgs(args);
if (config == null) return 1;

if (config.Worker)
{
    SteamKitPocRunner.EventOut = Console.Out;
    Console.SetOut(Console.Error);
    await RunWorkerAsync();
    return 0;
}

if (config.Download)
{
    // Em modo download o stdout é um canal JSON-por-linha lido pelo app. Qualquer
    // `Console.Write` solto (SteamKit, "Connecting to Steam3...") grudava na linha
    // JSON seguinte e o parser descartava o evento. Manda tudo pro stderr e deixa
    // só os eventos, escritos por `SteamKitPocRunner.EventOut`, no stdout.
    SteamKitPocRunner.EventOut = Console.Out;
    Console.SetOut(Console.Error);
}

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
            case "--worker":
                config.Worker = true;
                break;
            case "--output-dir":
                config.OutputDir = args[++i];
                break;
            case "--manifest-id":
                config.ManifestIdOverride = ulong.Parse(args[++i]);
                break;
            case "--parallel-chunks":
                config.ParallelChunks = int.Parse(args[++i]);
                break;
        }
    }

    if (!config.Worker && config.AppId == 0)
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
    Console.WriteLine("       [--worker]");
    Console.WriteLine("       [--download --depot-id <uint> --output-dir <path> [--manifest-id <ulong>] [--parallel-chunks <int>]]");
}

static async Task RunWorkerAsync()
{
    while (await Console.In.ReadLineAsync() is { } line)
    {
        if (string.IsNullOrWhiteSpace(line)) continue;

        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var type = root.TryGetProperty("Type", out var typeElement)
                ? typeElement.GetString()
                : null;

            if (type == "shutdown")
            {
                foreach (var activeDownload in WorkerState.ActiveDownloads.Values)
                    activeDownload.Cancel();
                SteamKitPocRunner.ShutdownWorkerSession();
                return;
            }
            if (type == "cancelDownload" || type == "pauseDownload")
            {
                var appId = root.GetProperty("AppId").GetUInt32();
                if (WorkerState.ActiveDownloads.TryGetValue(appId, out var activeDownload))
                    activeDownload.Cancel();
                continue;
            }
            if (type == "inspectDepot")
            {
                var appId = root.GetProperty("AppId").GetUInt32();
                var depotId = root.GetProperty("DepotId").GetUInt32();
                var manifestId = root.GetProperty("ManifestId").GetUInt64();
                var steamPath = root.GetProperty("SteamPath").GetString() ?? "";
                var manifestPath = Path.Combine(
                    steamPath,
                    "depotcache",
                    $"{depotId}_{manifestId}.manifest");

                using var manifestStream = File.OpenRead(manifestPath);
                var manifest = DepotManifest.Deserialize(manifestStream);
                var totalBytes = manifest.Files?
                    .Where(file => file.Chunks != null)
                    .SelectMany(file => file.Chunks!)
                    .Aggregate(0UL, (total, chunk) => total + chunk.UncompressedLength) ?? 0;

                SteamKitPocRunner.WriteEvent(new ProgressEvent
                {
                    Type = "depot-inspected",
                    AppId = appId,
                    DepotId = depotId,
                    TotalBytes = totalBytes,
                });
                continue;
            }
            if (type != "downloadDepot") continue;

            var commandConfig = new Config
            {
                Download = true,
                AppId = root.GetProperty("AppId").GetUInt32(),
                DepotId = root.GetProperty("DepotId").GetUInt32(),
                ManifestIdOverride = root.GetProperty("ManifestId").GetUInt64(),
                SteamPath = root.GetProperty("SteamPath").GetString(),
                OutputDir = root.GetProperty("OutputDir").GetString(),
                ParallelChunks = root.TryGetProperty("ParallelChunks", out var parallelChunks)
                    ? parallelChunks.GetInt32()
                    : 24,
            };

            var cancellation = new CancellationTokenSource();
            if (WorkerState.ActiveDownloads.TryRemove(commandConfig.AppId, out var existingDownload))
            {
                existingDownload.Cancel();
            }
            WorkerState.ActiveDownloads[commandConfig.AppId] = cancellation;

            _ = Task.Run(async () =>
            {
                try
                {
                    await new SteamKitPocRunner(commandConfig, cancellation.Token).RunAsync();
                }
                finally
                {
                    WorkerState.ActiveDownloads.TryRemove(commandConfig.AppId, out _);
                    cancellation.Dispose();
                }
            });
        }
        catch (Exception error)
        {
            SteamKitPocRunner.WriteEvent(new ProgressEvent
            {
                Type = "error",
                Status = "worker-command-failed",
                Message = error.Message,
            });
        }
    }
}

static class WorkerState
{
    public static readonly ConcurrentDictionary<uint, CancellationTokenSource> ActiveDownloads = new();
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
    public bool Worker { get; set; }
    public string? OutputDir { get; set; }
    public ulong ManifestIdOverride { get; set; }
    public uint DepotId { get; set; }
    public int ParallelChunks { get; set; } = 24;
}
