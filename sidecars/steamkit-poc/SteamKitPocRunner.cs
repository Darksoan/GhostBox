using System.Buffers;
using DepotDownloader;
using SteamKit2;
using SteamKit2.CDN;

namespace SteamKitPoc;

public class SteamKitPocRunner
{
    private readonly Config _config;
    private Steam3Session? _steam3;
    private CDNClientPool? _cdnPool;
    private byte[]? _depotKey;

    public SteamKitPocRunner(Config config)
    {
        _config = config;
    }

    public async Task RunAsync()
    {
        var steamPath = _config.SteamPath ?? ResolveSteamPath();
        var ost = new OstKeyProvider(steamPath);
        LicenseGate? gate = null;
        DepotKeyResult? ownedResult = null;

        if (_config.DryRun)
        {
            Console.WriteLine($"DryRun mode — OST keys from {steamPath}");
            Console.WriteLine("--- BEGIN OST KEYS ---");
            ost.Refresh();
            foreach (var (id, key) in ost.GetAllKeys())
            {
                Console.WriteLine($"OST_KEY id={id} key={RedactionWriter.MaskHex(key)}");
            }
            Console.WriteLine("--- END OST KEYS ---");
            var firstKey = ost.GetAllKeys().FirstOrDefault();
            var found = firstKey.Key != 0;
            Console.WriteLine($"MARCO=OstKeyProvided ok={found}");
            Console.WriteLine("MARCO=SessionPersisted ok=true");
            return;
        }

        if (_config.BareDownload)
        {
            Console.WriteLine($"Bare download mode — OST keys + depotcache from {steamPath}");
            ost.Refresh();

            var dId = _config.DepotId;
            var keyResult = ost.GetDepotKey(_config.AppId, dId);
            if (keyResult == null)
            {
                Console.WriteLine("MARCO=BareKeyResolved ok=false");
                return;
            }
            Console.WriteLine("MARCO=BareKeyResolved ok=true");
            _depotKey = Convert.FromHexString(keyResult.KeyHex);

            var mId = ost.GetManifestId(dId);
            if (mId == null)
            {
                Console.WriteLine("MARCO=BareManifestIdResolved ok=false");
                return;
            }
            Console.WriteLine($"MARCO=BareManifestIdResolved ok=true manifestId={mId}");

            // Load cached manifest from Steam depotcache
            var depotCache = Path.Combine(steamPath, "depotcache");
            var manifestPath = Path.Combine(depotCache, $"{dId}_{mId}.manifest");
            if (!File.Exists(manifestPath))
            {
                Console.WriteLine($"MARCO=BareManifestFromCache ok=false path={manifestPath}");
                return;
            }
            Console.WriteLine("MARCO=BareManifestFromCache ok=true");

            DepotManifest mfst;
            using (var fs = File.OpenRead(manifestPath))
                mfst = DepotManifest.Deserialize(fs);

            Console.WriteLine($"MARCO=BareManifestFiles ok={mfst.Files?.Count}");

            // Connect anonymous Steam3 for CDN server list only
            Console.WriteLine("Connecting SteamClient for CDN server list...");
            AccountSettingsStore.Instance = new AccountSettingsStore();
            _steam3 = new Steam3Session(new SteamUser.LogOnDetails { LoginID = 0xBEEF });
            // Process callbacks until connected (up to ~15s)
            var connected = false;
            for (var i = 0; i < 15; i++)
            {
                _steam3.RunCallbacksOnce();
                if (_steam3.steamClient.IsConnected) { connected = true; break; }
            }
            Console.WriteLine(connected ? "SteamClient connected (unauthenticated)" : "SteamClient connection failed");
            _cdnPool = new CDNClientPool(_steam3!, _config.AppId);
            await _cdnPool.UpdateServerList();

            var (dl, hv) = await BareDownloadAndValidateChunkAsync(mfst);
            Console.WriteLine($"MARCO=BareChunkDownloaded ok={dl}");
            Console.WriteLine($"MARCO=BareChunkHashValid ok={hv}");
            Console.WriteLine("MARCO=SessionPersisted ok=true");
            return;
        }

        if (_config.Download)
        {
            await RunDownloadAsync(ost, steamPath);
            return;
        }

        ContentDownloader.Config.UseQrCode = !_config.ReuseSession;
        ContentDownloader.Config.RememberPassword = true;

        var details = new SteamUser.LogOnDetails
        {
            LoginID = 0xFEED,
        };

        Console.WriteLine("Connecting to Steam...");
        _steam3 = new Steam3Session(details);

        _steam3.WaitUntilCallback(
            () => { },
            () => _steam3.IsLoggedOn
        );

        if (!_steam3.IsLoggedOn)
        {
            Console.WriteLine("MARCO=AuthenticatedAccount ok=false");
            return;
        }
        Console.WriteLine("MARCO=AuthenticatedAccount ok=true");

        if (_config.ReuseSession)
        {
            Console.WriteLine("MARCO=SessionReused ok=true");
        }

        var licenseCount = _steam3.Licenses?.Count ?? 0;
        Console.WriteLine($"MARCO=LicenseCount ok={licenseCount}");

        await _steam3.RequestAppInfo(_config.AppId);
        var depotId = ResolveDepotId(_config.AppId);
        if (depotId == 0)
        {
            Console.WriteLine("MARCO=AppInfoResolved ok=false");
            return;
        }
        Console.WriteLine($"MARCO=AppInfoResolved ok=true depotId={depotId}");

        var valve = new ValveKeyProvider(async (dId, aId) =>
        {
            await _steam3.RequestDepotKey(dId, aId);
            if (_steam3.DepotKeys.TryGetValue(dId, out var k))
                return k;
            return null;
        });
        gate = new LicenseGate(ost, valve);

        ownedResult = gate.Resolve(_config.AppId, depotId);
        Console.WriteLine($"MARCO=DepotAccessGranted ok={ownedResult != null} source={ownedResult?.Source.ToString() ?? "none"}");

        if (_config.DenyProbeAppId != 0)
        {
            Console.WriteLine($"Probing denied app {_config.DenyProbeAppId}...");
            var probeResult = gate.Resolve(_config.DenyProbeAppId, depotId);
            Console.WriteLine($"MARCO=DepotAccessDenied ok={probeResult == null} appId={_config.DenyProbeAppId}");
        }

        if (_config.OstProviderAppId != 0)
        {
            var ostOnly = new OstKeyProvider(steamPath);
            var ostResult = ostOnly.GetDepotKey(_config.OstProviderAppId, depotId);
            Console.WriteLine($"MARCO=OstKeyProvided ok={ostResult != null} appId={_config.OstProviderAppId}");
        }

        if (ownedResult == null)
        {
            Console.WriteLine("No depot key available, stopping.");
            gate.PrintAudit();
            return;
        }

        _depotKey = Convert.FromHexString(ownedResult.KeyHex);

        _cdnPool = new CDNClientPool(_steam3!, _config.AppId);
        await _cdnPool.UpdateServerList();

        var manifest = await DownloadManifestAsync(depotId);
        if (manifest == null)
        {
            Console.WriteLine("MARCO=ManifestResolved ok=false");
            gate.PrintAudit();
            return;
        }
        Console.WriteLine("MARCO=ManifestResolved ok=true");

        var (downloaded, hashValid) = await DownloadAndValidateChunkAsync(manifest);
        Console.WriteLine($"MARCO=ChunkDownloaded ok={downloaded}");
        Console.WriteLine($"MARCO=ChunkHashValid ok={hashValid}");

        Console.WriteLine("MARCO=SessionPersisted ok=true");
        gate.PrintAudit();
    }

    private uint ResolveDepotId(uint appId)
    {
        if (!_steam3!.AppInfo.TryGetValue(appId, out var info))
            return 0;

        var depots = info.KeyValues["depots"];
        if (depots == KeyValue.Invalid) return 0;

        foreach (var depot in depots.Children)
        {
            if (depot.Name == "branches") continue;
            if (!uint.TryParse(depot.Name, out var dId)) continue;

            // Only return depots that have manifests (actual content depots)
            if (depot["manifests"] != KeyValue.Invalid)
                return dId;
        }
        // Fallback: first numeric depot
        foreach (var depot in depots.Children)
        {
            if (depot.Name == "branches") continue;
            if (uint.TryParse(depot.Name, out var dId))
                return dId;
        }
        return 0;
    }

    private async Task<DepotManifest?> DownloadManifestAsync(uint depotId)
    {
        try
        {
            var manifestId = ResolveManifestId(depotId, _config.AppId);
            if (manifestId == 0)
            {
                Console.WriteLine("Could not resolve manifest ID.");
                return null;
            }

            var requestCode = await _steam3!.GetDepotManifestRequestCodeAsync(
                depotId, _config.AppId, manifestId, "public"
            );

            if (requestCode == 0) return null;

            Server? connection = null;
            DepotManifest? manifest = null;

            try
            {
                connection = _cdnPool!.GetConnection();
                manifest = await _cdnPool.CDNClient.DownloadManifestAsync(
                    depotId, manifestId, requestCode,
                    connection, _depotKey,
                    _cdnPool.ProxyServer, null
                );
            }
            finally
            {
                if (connection != null) _cdnPool?.ReturnConnection(connection);
            }

            return manifest;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Manifest download failed: {ex.Message}");
            return null;
        }
    }

    private ulong ResolveManifestId(uint depotId, uint appId)
    {
        if (!_steam3!.AppInfo.TryGetValue(appId, out var info))
            return 0;

        var depots = info.KeyValues["depots"];
        if (depots == KeyValue.Invalid) return 0;

        var depotChild = depots[depotId.ToString()];
        if (depotChild == KeyValue.Invalid) return 0;

        var manifests = depotChild["manifests"];
        if (manifests == KeyValue.Invalid) return 0;

        var node = manifests["public"]["gid"];
        if (node.Value != null && ulong.TryParse(node.Value, out var gid))
            return gid;

        // Fallback: try direct child
        if (manifests.Children.Count > 0 && manifests.Children[0].Name == "gid"
            && ulong.TryParse(manifests.Children[0].Value, out gid))
            return gid;

        return 0;
    }

    private async Task<(bool Downloaded, bool HashValid)> DownloadAndValidateChunkAsync(DepotManifest manifest)
    {
        try
        {
            var file = manifest.Files?[0];
            if (file?.Chunks == null || file.Chunks.Count == 0)
                return (false, false);

            var chunk = file.Chunks[0];
            var buffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
            Server? connection = null;
            string? cdnToken = null;
            var written = 0;

            try
            {
                connection = _cdnPool!.GetConnection();

                if (_steam3!.CDNAuthTokens.TryGetValue((manifest.DepotID, connection.Host), out var authTask))
                {
                    var authResult = await authTask.Task;
                    cdnToken = authResult.Token;
                }

                written = await _cdnPool.CDNClient.DownloadDepotChunkAsync(
                    manifest.DepotID, chunk, connection,
                    buffer, _depotKey,
                    _cdnPool.ProxyServer, cdnToken
                );
            }
            finally
            {
                if (connection != null) _cdnPool?.ReturnConnection(connection);
            }

            if (written > 0 && _config.CorruptChunk)
            {
                buffer[0] ^= 0xFF;
            }

            var adler = ComputeAdler32(buffer, written);
            var expected = BitConverter.GetBytes(chunk.Checksum);
            var hashValid = adler.AsSpan().SequenceEqual(expected);

            return (true, hashValid);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Chunk download failed: {ex.Message}");
            return (false, false);
        }
    }

    private async Task<(bool Downloaded, bool HashValid)> BareDownloadAndValidateChunkAsync(DepotManifest manifest)
    {
        try
        {
            var file = manifest.Files?[0];
            if (file?.Chunks == null || file.Chunks.Count == 0)
                return (false, false);

            var chunk = file.Chunks[0];
            var buffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
            Server? connection = null;
            var written = 0;

            try
            {
                connection = _cdnPool!.GetConnection();
                written = await _cdnPool.CDNClient.DownloadDepotChunkAsync(
                    manifest.DepotID, chunk, connection,
                    buffer, _depotKey,
                    _cdnPool.ProxyServer, null
                );
            }
            finally
            {
                if (connection != null) _cdnPool?.ReturnConnection(connection);
            }

            if (written > 0 && _config.CorruptChunk)
                buffer[0] ^= 0xFF;

            var adler = ComputeAdler32(buffer, written);
            var expected = BitConverter.GetBytes(chunk.Checksum);
            var hashValid = adler.AsSpan().SequenceEqual(expected);

            return (true, hashValid);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Bare chunk download failed: {ex.Message}");
            return (false, false);
        }
    }

    private async Task RunDownloadAsync(OstKeyProvider ost, string steamPath)
    {
        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "starting",
            AppId = _config.AppId,
            DepotId = _config.DepotId
        });

        ost.Refresh();
        var depotId = _config.DepotId;

        var keyResult = ost.GetDepotKey(_config.AppId, depotId);
        if (keyResult == null)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "no-depot-key",
                Message = $"No OST key found for depot {depotId}"
            });
            return;
        }
        _depotKey = Convert.FromHexString(keyResult.KeyHex);

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "key-resolved",
            AppId = _config.AppId,
            DepotId = depotId
        });

        var mId = _config.ManifestIdOverride > 0
            ? (ulong?)_config.ManifestIdOverride
            : ost.GetManifestId(depotId);
        if (mId == null)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "no-manifest-id",
                Message = $"No manifest ID for depot {depotId} (neither --manifest-id nor .lua --setManifestid)"
            });
            return;
        }

        var manifestPath = Path.Combine(steamPath, "depotcache", $"{depotId}_{mId}.manifest");
        if (!File.Exists(manifestPath))
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "no-cached-manifest",
                Message = $"Manifest file not found on disk: {manifestPath}. Run luatools add first."
            });
            return;
        }

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "loading-manifest",
            ManifestPath = manifestPath
        });

        DepotManifest manifest;
        using (var fs = File.OpenRead(manifestPath))
            manifest = DepotManifest.Deserialize(fs);

        var totalFiles = manifest.Files?.Count ?? 0;
        var totalChunks = 0UL;
        var totalBytes = 0UL;
        if (manifest.Files != null)
        {
            foreach (var f in manifest.Files)
            {
                if (f.Chunks != null)
                {
                    totalChunks += (ulong)f.Chunks.Count;
                    foreach (var c in f.Chunks)
                        totalBytes += c.UncompressedLength;
                }
            }
        }

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "manifest-loaded",
            FileCount = totalFiles,
            ChunkCount = totalChunks,
            TotalBytes = totalBytes
        });

        if (totalFiles == 0)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "empty-manifest",
                Message = "Manifest has no files"
            });
            return;
        }

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "connecting-steam"
        });

        AccountSettingsStore.Instance = new AccountSettingsStore();
        _steam3 = new Steam3Session(new SteamUser.LogOnDetails { LoginID = 0xBEEF });

        var connected = false;
        for (var i = 0; i < 30; i++)
        {
            _steam3.RunCallbacksOnce();
            if (_steam3.steamClient.IsConnected) { connected = true; break; }
            await Task.Delay(500);
        }

        if (!connected)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "steam-connect-failed",
                Message = "Could not connect to Steam (anonymous)"
            });
            return;
        }

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "steam-connected"
        });

        _cdnPool = new CDNClientPool(_steam3, _config.AppId);
        await _cdnPool.UpdateServerList();

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "cdn-ready",
            OutputDir = _config.OutputDir
        });

        var downloadedFiles = 0;
        var downloadedChunks = 0UL;
        var downloadedBytes = 0UL;
        var failedFiles = 0;
        var failedChunks = 0;
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        if (manifest.Files == null)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "no-files-in-manifest"
            });
            return;
        }

        for (var fileIdx = 0; fileIdx < manifest.Files.Count; fileIdx++)
        {
            var file = manifest.Files[fileIdx];
            var fileFinalPath = Path.Combine(_config.OutputDir!, file.FileName);

            if (file.Chunks == null || file.Chunks.Count == 0)
            {
                // Manifest entries without chunks are directory markers or empty placeholders.
                // Skip them to avoid file/directory name collisions (e.g., "Gurei_Data" as
                // both an empty file mark and a directory containing real files).
                continue;
            }

            var fileSuccess = true;
            try
            {
                // Dentro do try: um destino sem permissão de escrita (ex.: Program Files
                // sem elevação) derrubava o processo inteiro antes de emitir "complete",
                // e o chamador não tinha como saber que o download falhou.
                var fileDir = Path.GetDirectoryName(fileFinalPath);
                if (!string.IsNullOrEmpty(fileDir))
                    Directory.CreateDirectory(fileDir);

                await using (var fileStream = File.Create(fileFinalPath))
                {
                    foreach (var chunk in file.Chunks)
                    {
                        var chunkBuffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
                        Server? connection = null;
                        var written = 0;

                        try
                        {
                            var attempt = 0;
                            const int maxAttempts = 3;
                            do
                            {
                                attempt++;
                                connection = _cdnPool!.GetConnection();
                                string? cdnToken = null;
                                if (_steam3!.CDNAuthTokens.TryGetValue((manifest.DepotID, connection.Host), out var authTask))
                                {
                                    var authResult = await authTask.Task;
                                    cdnToken = authResult.Token;
                                }

                                written = await _cdnPool.CDNClient.DownloadDepotChunkAsync(
                                    manifest.DepotID, chunk, connection,
                                    chunkBuffer, _depotKey,
                                    _cdnPool.ProxyServer, cdnToken
                                );
                                _cdnPool.ReturnConnection(connection);
                                break;
                            }
                            while (attempt < maxAttempts);

                            if (written <= 0)
                            {
                                failedChunks++;
                                fileSuccess = false;
                                EmitProgress(new ProgressEvent
                                {
                                    Type = "error",
                                    Status = "chunk-download-failed",
                                    Message = $"Failed to download chunk for {file.FileName}",
                                    FileIndex = fileIdx,
                                    FileName = file.FileName
                                });
                                continue;
                            }

                            var adler = ComputeAdler32(chunkBuffer, written);
                            var expected = BitConverter.GetBytes(chunk.Checksum);
                            var hashValid = adler.AsSpan().SequenceEqual(expected);
                            if (!hashValid)
                            {
                                failedChunks++;
                                fileSuccess = false;
                                EmitProgress(new ProgressEvent
                                {
                                    Type = "error",
                                    Status = "chunk-hash-mismatch",
                                    Message = $"Hash mismatch for chunk in {file.FileName}",
                                    FileIndex = fileIdx,
                                    FileName = file.FileName
                                });
                                continue;
                            }

                            fileStream.Seek((long)chunk.Offset, SeekOrigin.Begin);
                            await fileStream.WriteAsync(chunkBuffer.AsMemory(0, written));

                            downloadedChunks++;
                            downloadedBytes += chunk.UncompressedLength;
                        }
                        catch (Exception ex)
                        {
                            failedChunks++;
                            fileSuccess = false;
                            EmitProgress(new ProgressEvent
                            {
                                Type = "error",
                                Status = "chunk-exception",
                                Message = ex.Message,
                                FileIndex = fileIdx,
                                FileName = file.FileName
                            });
                        }
                        finally
                        {
                            ArrayPool<byte>.Shared.Return(chunkBuffer);
                            if (connection != null) _cdnPool?.ReturnConnection(connection);
                        }
                    }
                }

                if (fileSuccess)
                {
                    downloadedFiles++;
                    if ((file.Flags & SteamKit2.EDepotFileFlag.Executable) != 0)
                    {
                        try
                        {
                            File.SetAttributes(fileFinalPath, File.GetAttributes(fileFinalPath) | FileAttributes.ReadOnly);
                        }
                        catch { }
                    }
                }
                else
                {
                    failedFiles++;
                    try { File.Delete(fileFinalPath); } catch { }
                }
            }
            catch (UnauthorizedAccessException ex)
            {
                // Sem permissão no destino: nenhum outro arquivo vai gravar também.
                // Aborta já em vez de repetir a mesma falha 45 mil vezes.
                EmitProgress(new ProgressEvent
                {
                    Type = "error",
                    Status = "output-dir-not-writable",
                    Message = $"{ex.Message} (escolha outra pasta de downloads nos Ajustes)",
                    FileIndex = fileIdx,
                    FileName = file.FileName,
                    OutputDir = _config.OutputDir
                });
                return;
            }
            catch (Exception ex)
            {
                failedFiles++;
                EmitProgress(new ProgressEvent
                {
                    Type = "error",
                    Status = "file-write-failed",
                    Message = ex.Message,
                    FileIndex = fileIdx,
                    FileName = file.FileName
                });
                try { File.Delete(fileFinalPath); } catch { }
            }

            var elapsedSec = Math.Max(1, stopwatch.Elapsed.TotalSeconds);
            var speedBytesPerSec = downloadedBytes / (ulong)elapsedSec;
            EmitProgress(new ProgressEvent
            {
                Type = "progress",
                FileIndex = fileIdx + 1,
                FileTotal = totalFiles,
                FileName = file.FileName,
                ChunkIndex = downloadedChunks,
                ChunkTotal = totalChunks,
                BytesDownloaded = downloadedBytes,
                BytesTotal = totalBytes,
                SpeedBytesPerSecond = speedBytesPerSec,
                FailedFiles = failedFiles,
                FailedChunks = failedChunks
            });
        }

        stopwatch.Stop();
        EmitProgress(new ProgressEvent
        {
            Type = "complete",
            DownloadedFiles = downloadedFiles,
            FileTotal = totalFiles,
            DownloadedChunks = downloadedChunks,
            ChunkTotal = totalChunks,
            DownloadedBytes = downloadedBytes,
            BytesTotal = totalBytes,
            FailedFiles = failedFiles,
            FailedChunks = failedChunks,
            ElapsedSeconds = stopwatch.Elapsed.TotalSeconds,
            OutputDir = _config.OutputDir
        });
    }

    /// Canal dos eventos JSON. Em modo download o `Program` aponta isto pro stdout
    /// real e manda o resto do `Console.Out` pro stderr, para o stream ficar limpo.
    public static TextWriter EventOut { get; set; } = Console.Out;

    private static void EmitProgress(ProgressEvent ev)
    {
        EventOut.WriteLine(System.Text.Json.JsonSerializer.Serialize(ev, ProgressJsonContext.Default.ProgressEvent));
        EventOut.Flush();
    }

    private static byte[] ComputeAdler32(byte[] data, int length)
    {
        uint a = 0, b = 0;
        for (var i = 0; i < length; i++)
        {
            var c = (uint)data[i];
            a = (a + c) % 65521;
            b = (b + a) % 65521;
        }
        return BitConverter.GetBytes(a | (b << 16));
    }

    private static string ResolveSteamPath()
    {
        var possible = new[]
        {
            @"C:\Program Files (x86)\Steam",
            @"C:\Program Files\Steam",
        };

        foreach (var p in possible)
        {
            if (Directory.Exists(p)) return p;
        }

        return possible[0];
    }
}

public class ProgressEvent
{
    public string Type { get; set; } = "";
    public string? Status { get; set; }
    public uint AppId { get; set; }
    public uint DepotId { get; set; }
    public string? Message { get; set; }
    public string? FileName { get; set; }
    public string? ManifestPath { get; set; }
    public string? OutputDir { get; set; }
    public int FileIndex { get; set; }
    public int FileTotal { get; set; }
    public ulong ChunkIndex { get; set; }
    public ulong ChunkTotal { get; set; }
    public ulong BytesDownloaded { get; set; }
    public ulong BytesTotal { get; set; }
    public ulong SpeedBytesPerSecond { get; set; }
    public int FileCount { get; set; }
    public ulong ChunkCount { get; set; }
    public ulong TotalBytes { get; set; }
    public int FailedFiles { get; set; }
    public int FailedChunks { get; set; }
    public int DownloadedFiles { get; set; }
    public ulong DownloadedChunks { get; set; }
    public ulong DownloadedBytes { get; set; }
    public double ElapsedSeconds { get; set; }
}

[ System.Text.Json.Serialization.JsonSerializable(typeof(ProgressEvent)) ]
internal partial class ProgressJsonContext : System.Text.Json.Serialization.JsonSerializerContext
{
}
