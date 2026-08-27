using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace SteamKitPoc;

/// Instrumentação do caminho de download, para separar as três causas possíveis
/// de lentidão: rede/CDN ruim, disco saturado ou churn de chunks que falham e
/// são retentados. Cada estágio do laço de chunk tem seu próprio acumulador de
/// tempo; no fim a soma diz onde os segundos foram parar.
///
/// Regra de ouro: telemetria nunca derruba download. Todo IO aqui é try/catch
/// silencioso e todo contador é livre de lock (Interlocked / ConcurrentDictionary).
internal sealed class DownloadTelemetry
{
    private static readonly double TicksPerSecond = Stopwatch.Frequency;

    private readonly string? _logPath;
    private readonly object _logGate = new();
    private readonly Stopwatch _wall = Stopwatch.StartNew();
    private readonly ConcurrentDictionary<string, ServerStat> _servers = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, int> _failureReasons = new(StringComparer.Ordinal);

    // Estágios do laço de chunk, em ticks de Stopwatch.
    private long _connectionWaitTicks;
    private long _networkTicks;
    private long _hashTicks;
    private long _diskWriteTicks;
    private long _retryDelayTicks;

    // Pré-passe de validação (hipótese "resume re-hasheia o jogo inteiro").
    private long _validationTicks;
    private long _validationBytesRead;
    private long _validationChunksHashed;
    private long _validationChunksFromCache;

    private long _attempts;
    private long _attemptFailures;
    private long _chunkFailures;
    private long _hashMismatches;
    private long _chunksCompleted;
    private long _networkBytes;
    private long _diskBytes;

    private long _lastSnapshotTicks;
    private long _failureLogLines;

    private const long MaxFailureLogLines = 200;

    public DownloadTelemetry(string? outputDir, uint appId, uint depotId, ulong manifestId, int parallelChunks)
    {
        if (!string.IsNullOrWhiteSpace(outputDir))
        {
            try
            {
                Directory.CreateDirectory(outputDir);
                _logPath = Path.Combine(outputDir, ".ghostbox-telemetry.log");
            }
            catch
            {
                _logPath = null;
            }
        }

        _lastSnapshotTicks = Stopwatch.GetTimestamp();
        Log($"=== depot start app={appId} depot={depotId} manifest={manifestId} parallelChunks={parallelChunks} ===");
    }

    public string? LogPath => _logPath;

    public static long Now() => Stopwatch.GetTimestamp();

    public static long Since(long startTimestamp) => Stopwatch.GetTimestamp() - startTimestamp;

    public void AddConnectionWait(long ticks) => Interlocked.Add(ref _connectionWaitTicks, ticks);

    public void AddRetryDelay(long ticks) => Interlocked.Add(ref _retryDelayTicks, ticks);

    public void AddHash(long ticks) => Interlocked.Add(ref _hashTicks, ticks);

    public void AddDiskWrite(long ticks, int bytes)
    {
        Interlocked.Add(ref _diskWriteTicks, ticks);
        Interlocked.Add(ref _diskBytes, bytes);
    }

    public void AddValidation(long ticks, long bytesRead, long chunksHashed, long chunksFromCache)
    {
        Interlocked.Add(ref _validationTicks, ticks);
        Interlocked.Add(ref _validationBytesRead, bytesRead);
        Interlocked.Add(ref _validationChunksHashed, chunksHashed);
        Interlocked.Add(ref _validationChunksFromCache, chunksFromCache);
    }

    /// Uma tentativa de baixar um chunk de um servidor específico. `bytes` é o
    /// que voltou (0 quando falhou), `ticks` o tempo só da chamada de rede.
    public void RecordAttempt(string? host, long ticks, int bytes, bool ok)
    {
        Interlocked.Increment(ref _attempts);
        Interlocked.Add(ref _networkTicks, ticks);

        var stat = _servers.GetOrAdd(host ?? "<null>", _ => new ServerStat());
        Interlocked.Increment(ref stat.Attempts);
        Interlocked.Add(ref stat.Ticks, ticks);

        if (ok)
        {
            Interlocked.Increment(ref stat.Successes);
            Interlocked.Add(ref stat.Bytes, bytes);
            Interlocked.Add(ref _networkBytes, bytes);
        }
        else
        {
            Interlocked.Increment(ref stat.Failures);
            Interlocked.Increment(ref _attemptFailures);
        }
    }

    public void RecordAttemptException(string? host, long ticks, Exception error)
    {
        RecordAttempt(host, ticks, 0, false);
        var key = $"exception:{error.GetType().Name}";
        _failureReasons.AddOrUpdate(key, 1, (_, count) => count + 1);
    }

    public void RecordChunkFailure(string reason)
    {
        Interlocked.Increment(ref _chunkFailures);
        if (string.Equals(reason, "chunk-hash-mismatch", StringComparison.Ordinal))
            Interlocked.Increment(ref _hashMismatches);
        _failureReasons.AddOrUpdate(reason, 1, (_, count) => count + 1);
    }

    public void RecordChunkCompleted() => Interlocked.Increment(ref _chunksCompleted);

    /// Verdadeiro no máximo uma vez a cada `intervalSeconds`. O chamador usa isto
    /// para decidir se vale gravar um snapshot, sem segurar lock nenhum.
    public bool ShouldSnapshot(double intervalSeconds)
    {
        var now = Stopwatch.GetTimestamp();
        var last = Interlocked.Read(ref _lastSnapshotTicks);
        if ((now - last) / TicksPerSecond < intervalSeconds)
            return false;
        return Interlocked.CompareExchange(ref _lastSnapshotTicks, now, last) == last;
    }

    /// Resumo de uma linha por estágio + top servidores por volume. É este bloco
    /// que responde a pergunta: rede, disco ou retry?
    public string BuildSummary(string phase, int parallelChunks)
    {
        var wall = _wall.Elapsed.TotalSeconds;
        var network = Seconds(_networkTicks);
        var disk = Seconds(_diskWriteTicks);
        var hash = Seconds(_hashTicks);
        var connectionWait = Seconds(_connectionWaitTicks);
        var retry = Seconds(_retryDelayTicks);
        var validation = Seconds(_validationTicks);
        var networkBytes = Interlocked.Read(ref _networkBytes);
        var diskBytes = Interlocked.Read(ref _diskBytes);
        var attempts = Interlocked.Read(ref _attempts);
        var attemptFailures = Interlocked.Read(ref _attemptFailures);

        // Os estágios rodam em `parallelChunks` threads, então o tempo somado é
        // dividido pela paralelismo para comparar com o relógio de parede.
        var divisor = Math.Max(1, parallelChunks);

        var builder = new StringBuilder();
        builder.Append("--- ").Append(phase).Append(" @ ").Append(Fixed(wall)).AppendLine("s wall ---");
        builder.Append("stage network   total=").Append(Fixed(network))
            .Append("s perWorker=").Append(Fixed(network / divisor))
            .Append("s bytes=").Append(networkBytes)
            .Append(" throughput=").Append(Rate(networkBytes, network)).AppendLine();
        builder.Append("stage diskWrite total=").Append(Fixed(disk))
            .Append("s perWorker=").Append(Fixed(disk / divisor))
            .Append("s bytes=").Append(diskBytes)
            .Append(" throughput=").Append(Rate(diskBytes, disk)).AppendLine();
        builder.Append("stage hash      total=").Append(Fixed(hash))
            .Append("s perWorker=").Append(Fixed(hash / divisor))
            .Append(" throughput=").Append(Rate(networkBytes, hash)).AppendLine();
        builder.Append("stage connWait  total=").Append(Fixed(connectionWait))
            .Append("s perWorker=").Append(Fixed(connectionWait / divisor)).AppendLine("s");
        builder.Append("stage retryWait total=").Append(Fixed(retry))
            .Append("s perWorker=").Append(Fixed(retry / divisor)).AppendLine("s");
        builder.Append("prepass validation=").Append(Fixed(validation))
            .Append("s bytesRead=").Append(Interlocked.Read(ref _validationBytesRead))
            .Append(" chunksHashed=").Append(Interlocked.Read(ref _validationChunksHashed))
            .Append(" chunksFromCache=").Append(Interlocked.Read(ref _validationChunksFromCache)).AppendLine();
        builder.Append("chunks completed=").Append(Interlocked.Read(ref _chunksCompleted))
            .Append(" failed=").Append(Interlocked.Read(ref _chunkFailures))
            .Append(" hashMismatch=").Append(Interlocked.Read(ref _hashMismatches))
            .Append(" attempts=").Append(attempts)
            .Append(" attemptFailures=").Append(attemptFailures)
            .Append(" attemptFailRate=")
            .Append(attempts > 0 ? Fixed(100.0 * attemptFailures / attempts) : "0.00")
            .AppendLine("%");

        if (!_failureReasons.IsEmpty)
        {
            builder.Append("failureReasons");
            foreach (var (reason, count) in _failureReasons.ToArray().OrderByDescending(entry => entry.Value))
                builder.Append(' ').Append(reason).Append('=').Append(count);
            builder.AppendLine();
        }

        var servers = _servers.ToArray();
        builder.Append("servers distinct=").Append(servers.Length).AppendLine();
        foreach (var (host, stat) in servers
            .OrderByDescending(entry => Interlocked.Read(ref entry.Value.Bytes))
            .Take(12))
        {
            var bytes = Interlocked.Read(ref stat.Bytes);
            var seconds = Seconds(Interlocked.Read(ref stat.Ticks));
            builder.Append("  server ").Append(host)
                .Append(" bytes=").Append(bytes)
                .Append(" ok=").Append(Interlocked.Read(ref stat.Successes))
                .Append(" fail=").Append(Interlocked.Read(ref stat.Failures))
                .Append(" busy=").Append(Fixed(seconds))
                .Append("s throughput=").Append(Rate(bytes, seconds)).AppendLine();
        }

        return builder.ToString().TrimEnd();
    }

    /// Uma linha para o veredito rápido, boa o bastante para caber num evento JSON.
    public string BuildVerdict(int parallelChunks)
    {
        var divisor = Math.Max(1, parallelChunks);
        var network = Seconds(_networkTicks) / divisor;
        var disk = Seconds(_diskWriteTicks) / divisor;
        var hash = Seconds(_hashTicks) / divisor;
        var connectionWait = Seconds(_connectionWaitTicks) / divisor;
        var retry = Seconds(_retryDelayTicks) / divisor;
        var networkBytes = Interlocked.Read(ref _networkBytes);
        var attempts = Interlocked.Read(ref _attempts);
        var attemptFailures = Interlocked.Read(ref _attemptFailures);

        var dominant = new (string Name, double Seconds)[]
        {
            ("network", network),
            ("diskWrite", disk),
            ("hash", hash),
            ("connWait", connectionWait),
            ("retryWait", retry),
        }.OrderByDescending(entry => entry.Seconds).First();

        return $"dominant={dominant.Name} ({Fixed(dominant.Seconds)}s/worker) " +
            $"net={Rate(networkBytes, Seconds(_networkTicks))} " +
            $"servers={_servers.Count} " +
            $"attemptFailRate={(attempts > 0 ? Fixed(100.0 * attemptFailures / attempts) : "0.00")}% " +
            $"validation={Fixed(Seconds(_validationTicks))}s";
    }

    /// Falha de chunk vira uma linha no log, mas com teto: um depot que esteja
    /// falhando em massa é exatamente o cenário a diagnosticar, e escrever
    /// milhões de linhas trocaria um problema de IO por outro. Os contadores
    /// agregados continuam completos no resumo.
    public void LogFailureSample(string line)
    {
        if (Interlocked.Increment(ref _failureLogLines) > MaxFailureLogLines)
            return;
        Log(line);
    }

    public void Log(string line)
    {
        if (_logPath == null)
            return;

        try
        {
            var stamped = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}";
            lock (_logGate)
                File.AppendAllText(_logPath, stamped);
        }
        catch
        {
            // Telemetria nunca derruba download.
        }
    }

    private static double Seconds(long ticks) => ticks / TicksPerSecond;

    private static string Fixed(double value) => value.ToString("F2", CultureInfo.InvariantCulture);

    private static string Rate(long bytes, double seconds)
    {
        if (seconds <= 0 || bytes <= 0)
            return "n/a";
        var perSecond = bytes / seconds;
        return perSecond >= 1024 * 1024
            ? $"{Fixed(perSecond / (1024 * 1024))}MB/s"
            : $"{Fixed(perSecond / 1024)}KB/s";
    }

    private sealed class ServerStat
    {
        public long Attempts;
        public long Successes;
        public long Failures;
        public long Bytes;
        public long Ticks;
    }
}
