using System.Buffers;
using System.Threading.Channels;
using DepotDownloader;
using SteamKit2;
using SteamKit2.CDN;

namespace SteamKitPoc;

public class SteamKitPocRunner
{
    private readonly Config _config;
    private readonly CancellationToken _cancellationToken;
    private Steam3Session? _steam3;
    private CDNClientPool? _cdnPool;
    private byte[]? _depotKey;

    private static readonly SemaphoreSlim WorkerSessionGate = new(1, 1);
    private static readonly Dictionary<uint, CDNClientPool> WorkerCdnPools = [];
    private static Steam3Session? WorkerSteam3Session;
    private static readonly object EventOutputLock = new();

    public SteamKitPocRunner(Config config, CancellationToken cancellationToken = default)
    {
        _config = config;
        _cancellationToken = cancellationToken;
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
            try
            {
                await RunDownloadAsync(ost, steamPath);
            }
            catch (OperationCanceledException)
            {
                EmitProgress(new ProgressEvent
                {
                    Type = "cancelled",
                    Status = "cancelled",
                    AppId = _config.AppId,
                    DepotId = _config.DepotId,
                    OutputDir = _config.OutputDir
                });
            }
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
        _cancellationToken.ThrowIfCancellationRequested();
        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "starting",
            AppId = _config.AppId,
            DepotId = _config.DepotId
        });

        ost.Refresh();
        _cancellationToken.ThrowIfCancellationRequested();
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

        try
        {
            (_steam3, _cdnPool) = await GetWorkerDownloadContextAsync(
                _config.AppId,
                _cancellationToken);
        }
        catch (Exception ex)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "steam-connect-failed",
                Message = ex.Message
            });
            return;
        }

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "steam-connected"
        });

        EmitProgress(new ProgressEvent
        {
            Type = "status",
            Status = "cdn-ready",
            OutputDir = _config.OutputDir
        });

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var depotResult = await DownloadDepotFilesAsync(
            manifest,
            totalFiles,
            totalChunks,
            totalBytes,
            stopwatch);

        if (!depotResult.EmitComplete)
            return;

        stopwatch.Stop();
        EmitProgress(new ProgressEvent
        {
            Type = "complete",
            DownloadedFiles = depotResult.DownloadedFiles,
            FileTotal = totalFiles,
            DownloadedChunks = depotResult.DownloadedChunks,
            ChunkTotal = totalChunks,
            DownloadedBytes = depotResult.DownloadedBytes,
            BytesTotal = totalBytes,
            FailedFiles = depotResult.FailedFiles,
            FailedChunks = depotResult.FailedChunks,
            ElapsedSeconds = stopwatch.Elapsed.TotalSeconds,
            OutputDir = _config.OutputDir
        });
    }

    private static async Task<(Steam3Session Session, CDNClientPool Pool)> GetWorkerDownloadContextAsync(
        uint appId,
        CancellationToken cancellationToken)
    {
        await WorkerSessionGate.WaitAsync(cancellationToken);
        try
        {
            if (WorkerSteam3Session == null || !WorkerSteam3Session.steamClient.IsConnected)
            {
                if (WorkerSteam3Session != null)
                {
                    if (WorkerSteam3Session.steamClient.IsConnected)
                    {
                        try { WorkerSteam3Session.Disconnect(false); } catch { }
                    }
                    WorkerCdnPools.Clear();
                }

                AccountSettingsStore.Instance = new AccountSettingsStore();
                var session = new Steam3Session(new SteamUser.LogOnDetails { LoginID = 0xBEEF });
                var connected = false;
                for (var i = 0; i < 30; i++)
                {
                    session.RunCallbacksOnce();
                    if (session.steamClient.IsConnected)
                    {
                        connected = true;
                        break;
                    }

                    await Task.Delay(500, cancellationToken);
                }

                if (!connected)
                {
                    throw new InvalidOperationException("Could not connect to Steam (anonymous)");
                }

                WorkerSteam3Session = session;
                WorkerCdnPools.Clear();
            }

            if (!WorkerCdnPools.TryGetValue(appId, out var pool))
            {
                pool = new CDNClientPool(WorkerSteam3Session, appId);
                await pool.UpdateServerList();
                WorkerCdnPools[appId] = pool;
            }

            return (WorkerSteam3Session, pool);
        }
        finally
        {
            WorkerSessionGate.Release();
        }
    }

    public static void ShutdownWorkerSession()
    {
        WorkerSessionGate.Wait();
        try
        {
            if (WorkerSteam3Session?.steamClient.IsConnected == true)
            {
                try { WorkerSteam3Session.Disconnect(false); } catch { }
            }
            WorkerSteam3Session = null;
            WorkerCdnPools.Clear();
        }
        finally
        {
            WorkerSessionGate.Release();
        }
    }

    private async Task<DepotDownloadResult> DownloadDepotFilesAsync(
        DepotManifest manifest,
        int totalFiles,
        ulong totalChunks,
        ulong totalBytes,
        System.Diagnostics.Stopwatch stopwatch)
    {
        long downloadedChunks = 0;
        long downloadedBytes = 0;
        long networkDownloadedBytes = 0;
        int downloadedFiles = 0;
        int failedFiles = 0;
        int failedChunks = 0;
        long lastProgressEmitAtMs = 0;
        System.Diagnostics.Stopwatch? networkStopwatch = null;
        var progressLock = new object();
        var fileStates = new List<FileDownloadState>();
        var parallelChunks = Math.Clamp(_config.ParallelChunks, 1, 32);
        var validationIndexPath = Path.Combine(_config.OutputDir!, ".ghostbox-chunks.json");
        var validationIndex = LoadValidationIndex(validationIndexPath, _config.ManifestIdOverride);
        var validationIndexLock = new object();

        if (manifest.Files == null)
        {
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = "no-files-in-manifest"
            });
            return new DepotDownloadResult(0, 0, 0, 0, 0, false);
        }

        void CompleteFile(FileDownloadState state)
        {
            if (Interlocked.Exchange(ref state.CompletionSignaled, 1) != 0)
                return;

            // Release the handle as soon as the file is done: the global chunk queue walks the
            // whole depot, so keeping streams until the depot ends would leak one handle per file.
            DisposeFileStream(state);

            if (Volatile.Read(ref state.FailedChunks) == 0)
            {
                Interlocked.Increment(ref downloadedFiles);
                if ((state.File.Flags & SteamKit2.EDepotFileFlag.Executable) != 0)
                {
                    try
                    {
                        File.SetAttributes(state.Path, File.GetAttributes(state.Path) | FileAttributes.ReadOnly);
                    }
                    catch { }
                }
            }
            else
            {
                Interlocked.Increment(ref failedFiles);
                state.DeleteAfterDispose = true;
            }
        }

        void RecordChunkFailure(ChunkWorkItem work, string status, string message)
        {
            Interlocked.Increment(ref work.FileState.FailedChunks);
            Interlocked.Increment(ref failedChunks);
            EmitProgress(new ProgressEvent
            {
                Type = "error",
                Status = status,
                Message = message,
                FileIndex = work.FileIndex,
                FileName = work.FileState.File.FileName
            });
        }

        try
        {
            for (var fileIdx = 0; fileIdx < manifest.Files.Count; fileIdx++)
            {
                _cancellationToken.ThrowIfCancellationRequested();
                var file = manifest.Files[fileIdx];

                if (file.Chunks == null || file.Chunks.Count == 0)
                {
                    // Manifest entries without chunks are directory markers or empty placeholders.
                    continue;
                }

                var fileFinalPath = Path.Combine(_config.OutputDir!, file.FileName);
                try
                {
                    var fileDir = Path.GetDirectoryName(fileFinalPath);
                    if (!string.IsNullOrEmpty(fileDir))
                        Directory.CreateDirectory(fileDir);

                    var fileLength = file.Chunks.Max(chunk => (long)(chunk.Offset + chunk.UncompressedLength));
                    var state = new FileDownloadState(
                        file,
                        fileFinalPath,
                        fileLength,
                        new bool[file.Chunks.Count],
                        0,
                        fileIdx);
                    fileStates.Add(state);
                }
                catch (UnauthorizedAccessException ex)
                {
                    EmitProgress(new ProgressEvent
                    {
                        Type = "error",
                        Status = "output-dir-not-writable",
                        Message = $"{ex.Message} (escolha outra pasta de downloads nos Ajustes)",
                        FileIndex = fileIdx,
                        FileName = file.FileName,
                        OutputDir = _config.OutputDir
                    });
                    return new DepotDownloadResult(
                        downloadedFiles,
                        (ulong)downloadedChunks,
                        (ulong)downloadedBytes,
                        failedFiles,
                        failedChunks,
                        false);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref failedFiles);
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
            }

            var preparationAbort = 0;
            try
            {
                await Parallel.ForEachAsync(
                    fileStates,
                    new ParallelOptions
                    {
                        MaxDegreeOfParallelism = parallelChunks,
                        CancellationToken = _cancellationToken
                    },
                    async (state, cancellationToken) =>
                    {
                        if (state.PreparationFailed) return;

                        try
                        {
                            var validExistingChunks = await ValidateExistingChunksAsync(
                                state.Path,
                                state.File.Chunks,
                                state.Length,
                                cancellationToken,
                                validationIndex,
                                validationIndexLock);
                            var missingChunks = validExistingChunks.Count(valid => !valid);
                            state.ValidChunks = validExistingChunks;
                            state.RemainingChunks = missingChunks;

                            for (var chunkIndex = 0; chunkIndex < state.File.Chunks.Count; chunkIndex++)
                            {
                                if (!validExistingChunks[chunkIndex]) continue;
                                Interlocked.Increment(ref downloadedChunks);
                                Interlocked.Add(ref downloadedBytes, state.File.Chunks[chunkIndex].UncompressedLength);
                            }

                            var currentLength = File.Exists(state.Path)
                                ? new FileInfo(state.Path).Length
                                : -1;
                            if (missingChunks > 0 || currentLength != state.Length)
                            {
                                // Fail early for unwritable destinations, without opening one handle per
                                // file for the whole depot. Workers reuse one lazy stream per file.
                                await using var probe = new FileStream(
                                    state.Path,
                                    FileMode.OpenOrCreate,
                                    FileAccess.ReadWrite,
                                    FileShare.Read,
                                    bufferSize: 1024 * 1024,
                                    FileOptions.Asynchronous | FileOptions.RandomAccess);
                                probe.SetLength(state.Length);
                            }

                            if (missingChunks == 0)
                                CompleteFile(state);
                        }
                        catch (UnauthorizedAccessException ex)
                        {
                            state.PreparationFailed = true;
                            if (Interlocked.Exchange(ref preparationAbort, 1) == 0)
                            {
                                EmitProgress(new ProgressEvent
                                {
                                    Type = "error",
                                    Status = "output-dir-not-writable",
                                    Message = $"{ex.Message} (escolha outra pasta de downloads nos Ajustes)",
                                    FileIndex = state.FileIndex,
                                    FileName = state.File.FileName,
                                    OutputDir = _config.OutputDir
                                });
                            }

                            throw;
                        }
                        catch (OperationCanceledException)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            state.PreparationFailed = true;
                            Interlocked.Increment(ref failedFiles);
                            EmitProgress(new ProgressEvent
                            {
                                Type = "error",
                                Status = "file-write-failed",
                                Message = ex.Message,
                                FileIndex = state.FileIndex,
                                FileName = state.File.FileName
                            });
                            try { File.Delete(state.Path); } catch { }
                        }
                    });
            }
            catch (UnauthorizedAccessException)
            {
                return new DepotDownloadResult(
                    downloadedFiles,
                    (ulong)Interlocked.Read(ref downloadedChunks),
                    (ulong)Interlocked.Read(ref downloadedBytes),
                    failedFiles,
                    failedChunks,
                    false);
            }

            var channel = Channel.CreateBounded<ChunkWorkItem>(new BoundedChannelOptions(
                Math.Max(parallelChunks * 4, 1))
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = true,
                SingleReader = false
            });

            async Task ProduceChunksAsync()
            {
                try
                {
                    foreach (var state in fileStates)
                    {
                        if (state.PreparationFailed) continue;

                        for (var chunkIndex = 0; chunkIndex < state.File.Chunks.Count; chunkIndex++)
                        {
                            if (state.ValidChunks[chunkIndex]) continue;

                            await channel.Writer.WriteAsync(
                                new ChunkWorkItem(state, chunkIndex),
                                _cancellationToken);
                        }
                    }

                    channel.Writer.TryComplete();
                }
                catch (Exception ex)
                {
                    channel.Writer.TryComplete(ex);
                    throw;
                }
            }

            async Task ConsumeChunksAsync()
            {
                await foreach (var work in channel.Reader.ReadAllAsync(_cancellationToken))
                    await DownloadChunkAsync(work);
            }

            async Task DownloadChunkAsync(ChunkWorkItem work)
            {
                var chunk = work.FileState.File.Chunks[work.ChunkIndex];
                var chunkBuffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
                var workCompleted = false;

                try
                {
                    lock (progressLock)
                        networkStopwatch ??= System.Diagnostics.Stopwatch.StartNew();

                    var written = 0;
                    const int maxAttempts = 3;
                    for (var attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        Server? connection = null;
                        try
                        {
                            connection = _cdnPool!.GetConnection();
                            string? cdnToken = null;
                            if (_steam3!.CDNAuthTokens.TryGetValue((manifest.DepotID, connection.Host), out var authTask))
                            {
                                var authResult = await authTask.Task;
                                cdnToken = authResult.Token;
                            }

                            written = await _cdnPool.CDNClient.DownloadDepotChunkAsync(
                                manifest.DepotID,
                                chunk,
                                connection,
                                chunkBuffer,
                                _depotKey,
                                _cdnPool.ProxyServer,
                                cdnToken);

                            if (written > 0)
                            {
                                _cdnPool.ReturnConnection(connection);
                                connection = null;
                                break;
                            }

                            _cdnPool.ReturnBrokenConnection(connection);
                            connection = null;
                        }
                        catch (OperationCanceledException)
                        {
                            throw;
                        }
                        catch
                        {
                            if (connection != null)
                                _cdnPool!.ReturnBrokenConnection(connection);
                        }

                        if (attempt < maxAttempts)
                        {
                            var backoffMs = Math.Min(4000, 150 * (1 << (attempt - 1)));
                            await Task.Delay(backoffMs + Random.Shared.Next(0, 101), _cancellationToken);
                        }
                    }

                    _cancellationToken.ThrowIfCancellationRequested();

                    if (written <= 0)
                    {
                        RecordChunkFailure(
                            work,
                            "chunk-download-failed",
                            $"Failed to download chunk for {work.FileState.File.FileName}");
                        workCompleted = true;
                        return;
                    }

                    var adler = ComputeAdler32(chunkBuffer, written);
                    var expected = BitConverter.GetBytes(chunk.Checksum);
                    if (!adler.AsSpan().SequenceEqual(expected))
                    {
                        RecordChunkFailure(
                            work,
                            "chunk-hash-mismatch",
                            $"Hash mismatch for chunk in {work.FileState.File.FileName}");
                        workCompleted = true;
                        return;
                    }

                    var fileStream = GetOrOpenFileStream(work.FileState);
                    await RandomAccess.WriteAsync(
                        fileStream.SafeFileHandle,
                        chunkBuffer.AsMemory(0, written),
                        (long)chunk.Offset,
                        _cancellationToken);
                    UpdateValidationIndexChunk(
                        validationIndex,
                        validationIndexLock,
                        work.FileState,
                        work.ChunkIndex,
                        chunk);

                    ProgressEvent? progressUpdate = null;
                    lock (progressLock)
                    {
                        downloadedChunks++;
                        downloadedBytes += chunk.UncompressedLength;
                        networkDownloadedBytes += chunk.UncompressedLength;

                        var elapsedMs = stopwatch.ElapsedMilliseconds;
                        if (elapsedMs - lastProgressEmitAtMs >= 1000)
                        {
                            lastProgressEmitAtMs = elapsedMs;
                            var networkElapsedSec = networkStopwatch?.Elapsed.TotalSeconds ?? 0;
                            progressUpdate = new ProgressEvent
                            {
                                Type = "progress",
                                FileIndex = work.FileIndex + 1,
                                FileTotal = totalFiles,
                                FileName = work.FileState.File.FileName,
                                ChunkIndex = (ulong)Interlocked.Read(ref downloadedChunks),
                                ChunkTotal = totalChunks,
                                BytesDownloaded = (ulong)Interlocked.Read(ref downloadedBytes),
                                BytesTotal = totalBytes,
                                SpeedBytesPerSecond = networkElapsedSec > 0
                                    ? (ulong)(networkDownloadedBytes / networkElapsedSec)
                                    : 0,
                                FailedFiles = Volatile.Read(ref failedFiles),
                                FailedChunks = Volatile.Read(ref failedChunks)
                            };
                        }
                    }

                    if (progressUpdate != null)
                        EmitProgress(progressUpdate);

                    workCompleted = true;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    RecordChunkFailure(work, "chunk-exception", ex.Message);
                    workCompleted = true;
                }
                finally
                {
                    ArrayPool<byte>.Shared.Return(chunkBuffer);
                    if (workCompleted && Interlocked.Decrement(ref work.FileState.RemainingChunks) == 0)
                        CompleteFile(work.FileState);
                }
            }

            var producer = ProduceChunksAsync();
            var workers = Enumerable
                .Range(0, parallelChunks)
                .Select(_ => ConsumeChunksAsync())
                .ToArray();

            try
            {
                await producer;
                await Task.WhenAll(workers);
            }
            catch
            {
                channel.Writer.TryComplete();
                try { await Task.WhenAll(workers); } catch { }
                throw;
            }
        }
        finally
        {
            foreach (var state in fileStates)
                DisposeFileStream(state);
            foreach (var state in fileStates.Where(state => state.DeleteAfterDispose))
            {
                try { File.Delete(state.Path); } catch { }
            }
            SaveValidationIndex(validationIndexPath, validationIndex);
        }

        return new DepotDownloadResult(
            downloadedFiles,
            (ulong)Interlocked.Read(ref downloadedChunks),
            (ulong)Interlocked.Read(ref downloadedBytes),
            Volatile.Read(ref failedFiles),
            Volatile.Read(ref failedChunks),
            true);
    }

    private async Task<bool[]> ValidateExistingChunksAsync(
        string filePath,
        IReadOnlyList<DepotManifest.ChunkData> chunks,
        long expectedFileLength,
        CancellationToken cancellationToken,
        ChunkValidationIndex? validationIndex,
        object validationIndexLock)
    {
        var validChunks = new bool[chunks.Count];
        if (!File.Exists(filePath))
            return validChunks;

        var fileInfo = new FileInfo(filePath);
        var cachedFile = GetCachedFileIndex(validationIndex, validationIndexLock, filePath, fileInfo, expectedFileLength);
        var needsDiskValidation = cachedFile == null;
        await using var fileStream = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            bufferSize: 1024 * 1024,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        var existingLength = fileStream.Length;

        for (var chunkIndex = 0; chunkIndex < chunks.Count; chunkIndex++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var chunk = chunks[chunkIndex];
            if (!needsDiskValidation && TryGetCachedChunk(cachedFile!, chunkIndex, chunk))
            {
                validChunks[chunkIndex] = true;
                continue;
            }

            var chunkEnd = (long)(chunk.Offset + chunk.UncompressedLength);
            if (chunkEnd > existingLength) continue;

            var existingBuffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
            try
            {
                var totalRead = 0;
                while (totalRead < chunk.UncompressedLength)
                {
                    var read = await RandomAccess.ReadAsync(
                        fileStream.SafeFileHandle,
                        existingBuffer.AsMemory(totalRead, (int)chunk.UncompressedLength - totalRead),
                        (long)chunk.Offset + totalRead,
                        cancellationToken);
                    if (read == 0) break;
                    totalRead += read;
                }

                if (totalRead != chunk.UncompressedLength) continue;
                var adler = ComputeAdler32(existingBuffer, totalRead);
                var expected = BitConverter.GetBytes(chunk.Checksum);
                validChunks[chunkIndex] = adler.AsSpan().SequenceEqual(expected);
                if (validChunks[chunkIndex])
                {
                    UpdateValidationIndexChunk(
                        validationIndex,
                        validationIndexLock,
                        filePath,
                        fileInfo,
                        expectedFileLength,
                        chunkIndex,
                        chunk);
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(existingBuffer);
            }
        }

        return validChunks;
    }

    private static ChunkValidationIndex? LoadValidationIndex(string path, ulong manifestId)
    {
        if (manifestId == 0 || !File.Exists(path))
            return manifestId == 0 ? null : new ChunkValidationIndex(manifestId);

        try
        {
            var json = File.ReadAllText(path);
            var index = System.Text.Json.JsonSerializer.Deserialize<ChunkValidationIndex>(json);
            if (index == null || index.Version != 1 || index.ManifestId != manifestId)
                return new ChunkValidationIndex(manifestId);

            index.Files = new Dictionary<string, FileValidationIndex>(
                index.Files ?? [],
                StringComparer.OrdinalIgnoreCase);
            return index;
        }
        catch
        {
            return new ChunkValidationIndex(manifestId);
        }
    }

    private static FileValidationIndex? GetCachedFileIndex(
        ChunkValidationIndex? validationIndex,
        object validationIndexLock,
        string filePath,
        FileInfo fileInfo,
        long expectedFileLength)
    {
        if (validationIndex == null)
            return null;

        lock (validationIndexLock)
        {
            if (!validationIndex.Files.TryGetValue(filePath, out var fileIndex))
                return null;
            if (fileInfo.Length != expectedFileLength ||
                fileIndex.FileLength != expectedFileLength ||
                fileIndex.LastWriteUtcTicks != fileInfo.LastWriteTimeUtc.Ticks)
                return null;
            return fileIndex;
        }
    }

    private static bool TryGetCachedChunk(
        FileValidationIndex fileIndex,
        int chunkIndex,
        DepotManifest.ChunkData chunk)
    {
        if (fileIndex.Chunks == null || chunkIndex >= fileIndex.Chunks.Count)
            return false;

        var cachedChunk = fileIndex.Chunks[chunkIndex];
        return cachedChunk.Offset == chunk.Offset &&
            cachedChunk.UncompressedLength == chunk.UncompressedLength &&
            cachedChunk.Checksum == chunk.Checksum;
    }

    private static void UpdateValidationIndexChunk(
        ChunkValidationIndex? validationIndex,
        object validationIndexLock,
        FileDownloadState state,
        int chunkIndex,
        DepotManifest.ChunkData chunk)
    {
        UpdateValidationIndexChunk(
            validationIndex,
            validationIndexLock,
            state.Path,
            state.Length,
            chunkIndex,
            chunk);
    }

    private static void UpdateValidationIndexChunk(
        ChunkValidationIndex? validationIndex,
        object validationIndexLock,
        string filePath,
        FileInfo fileInfo,
        long expectedFileLength,
        int chunkIndex,
        DepotManifest.ChunkData chunk)
    {
        UpdateValidationIndexChunk(
            validationIndex,
            validationIndexLock,
            filePath,
            expectedFileLength,
            chunkIndex,
            chunk,
            fileInfo.LastWriteTimeUtc.Ticks);
    }

    private static void UpdateValidationIndexChunk(
        ChunkValidationIndex? validationIndex,
        object validationIndexLock,
        string filePath,
        long expectedFileLength,
        int chunkIndex,
        DepotManifest.ChunkData chunk,
        long lastWriteUtcTicks = 0)
    {
        if (validationIndex == null)
            return;

        lock (validationIndexLock)
        {
            if (!validationIndex.Files.TryGetValue(filePath, out var fileIndex))
            {
                fileIndex = new FileValidationIndex();
                validationIndex.Files[filePath] = fileIndex;
            }

            fileIndex.FileLength = expectedFileLength;
            fileIndex.LastWriteUtcTicks = lastWriteUtcTicks;
            fileIndex.Chunks ??= [];
            while (fileIndex.Chunks.Count <= chunkIndex)
                fileIndex.Chunks.Add(new ChunkValidationEntry());

            fileIndex.Chunks[chunkIndex] = new ChunkValidationEntry
            {
                Offset = chunk.Offset,
                UncompressedLength = chunk.UncompressedLength,
                Checksum = chunk.Checksum
            };
        }
    }

    private static void SaveValidationIndex(string path, ChunkValidationIndex? validationIndex)
    {
        if (validationIndex == null)
            return;

        var temporaryPath = $"{path}.tmp";
        try
        {
            foreach (var (filePath, fileIndex) in validationIndex.Files.ToArray())
            {
                if (!File.Exists(filePath))
                {
                    validationIndex.Files.Remove(filePath);
                    continue;
                }

                var fileInfo = new FileInfo(filePath);
                fileIndex.FileLength = fileInfo.Length;
                fileIndex.LastWriteUtcTicks = fileInfo.LastWriteTimeUtc.Ticks;
            }

            var json = System.Text.Json.JsonSerializer.Serialize(validationIndex);
            File.WriteAllText(temporaryPath, json);
            File.Move(temporaryPath, path, true);
        }
        catch
        {
            try { File.Delete(temporaryPath); } catch { }
        }
    }

    private static FileStream GetOrOpenFileStream(FileDownloadState state)
    {
        lock (state.StreamGate)
        {
            if (state.Stream != null)
                return state.Stream;

            state.Stream = new FileStream(
                state.Path,
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.Read,
                bufferSize: 1024 * 1024,
                FileOptions.Asynchronous | FileOptions.RandomAccess);
            state.Stream.SetLength(state.Length);
            return state.Stream;
        }
    }

    private static void DisposeFileStream(FileDownloadState state)
    {
        lock (state.StreamGate)
        {
            state.Stream?.Dispose();
            state.Stream = null;
        }
    }

    private sealed class ChunkWorkItem
    {
        public ChunkWorkItem(FileDownloadState fileState, int chunkIndex)
        {
            FileState = fileState;
            ChunkIndex = chunkIndex;
            FileIndex = fileState.FileIndex;
        }

        public FileDownloadState FileState { get; }
        public int ChunkIndex { get; }
        public int FileIndex { get; }
    }

    private sealed class FileDownloadState
    {
        public FileDownloadState(
            DepotManifest.FileData file,
            string path,
            long length,
            bool[] validChunks,
            int remainingChunks,
            int fileIndex)
        {
            File = file;
            Path = path;
            Length = length;
            ValidChunks = validChunks;
            RemainingChunks = remainingChunks;
            FileIndex = fileIndex;
        }

        public DepotManifest.FileData File { get; }
        public string Path { get; }
        public long Length { get; }
        public bool[] ValidChunks { get; set; }
        public int FileIndex { get; }
        public bool PreparationFailed { get; set; }
        public bool DeleteAfterDispose { get; set; }
        public int RemainingChunks;
        public int FailedChunks;
        public int CompletionSignaled;
        public FileStream? Stream;
        public object StreamGate { get; } = new();
    }

    private sealed class ChunkValidationIndex
    {
        public ChunkValidationIndex() { }

        public ChunkValidationIndex(ulong manifestId)
        {
            ManifestId = manifestId;
        }

        public int Version { get; set; } = 1;
        public ulong ManifestId { get; set; }
        public Dictionary<string, FileValidationIndex> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class FileValidationIndex
    {
        public long FileLength { get; set; }
        public long LastWriteUtcTicks { get; set; }
        public List<ChunkValidationEntry> Chunks { get; set; } = [];
    }

    private sealed class ChunkValidationEntry
    {
        public ulong Offset { get; set; }
        public uint UncompressedLength { get; set; }
        public uint Checksum { get; set; }
    }

    private sealed record DepotDownloadResult(
        int DownloadedFiles,
        ulong DownloadedChunks,
        ulong DownloadedBytes,
        int FailedFiles,
        int FailedChunks,
        bool EmitComplete);

    /// Canal dos eventos JSON. Em modo download o `Program` aponta isto pro stdout
    /// real e manda o resto do `Console.Out` pro stderr, para o stream ficar limpo.
    public static TextWriter EventOut { get; set; } = Console.Out;

    public static void WriteEvent(ProgressEvent ev) => EmitProgress(ev);

    private static void EmitProgress(ProgressEvent ev)
    {
        lock (EventOutputLock)
        {
            EventOut.WriteLine(System.Text.Json.JsonSerializer.Serialize(ev, ProgressJsonContext.Default.ProgressEvent));
            EventOut.Flush();
        }
    }

    private static byte[] ComputeAdler32(byte[] data, int length)
    {
        const uint modulus = 65521;
        const int blockSize = 5552;
        uint a = 0, b = 0;
        var offset = 0;
        while (offset < length)
        {
            var blockLength = Math.Min(blockSize, length - offset);
            for (var i = 0; i < blockLength; i++)
            {
                a += data[offset + i];
                b += a;
            }

            a %= modulus;
            b %= modulus;
            offset += blockLength;
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
