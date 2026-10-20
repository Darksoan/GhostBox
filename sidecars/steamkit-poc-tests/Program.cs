using System.Reflection;
using System.Text.Json;
using System.Text;
using System.Security.Cryptography;
using SteamKit2;
using SteamKitPoc;

// Testa retomada e nomes criptografados de manifests, sem login Steam ou CDN.
// dotnet run --project sidecars/steamkit-poc-tests
var directory = Path.Combine(Path.GetTempPath(), "opencode", $"ghostbox-resume-{Guid.NewGuid():N}");
Directory.CreateDirectory(directory);
try
{
    var runner = new SteamKitPocRunner(new Config());
    var type = typeof(SteamKitPocRunner);
    var validate = type.GetMethod("ValidateExistingChunksAsync", BindingFlags.NonPublic | BindingFlags.Instance)!;
    var load = type.GetMethod("LoadValidationIndex", BindingFlags.NonPublic | BindingFlags.Static)!;
    var save = type.GetMethod("SaveValidationIndex", BindingFlags.NonPublic | BindingFlags.Static)!;
    var file = Path.Combine(directory, "game.pak");
    var indexPath = Path.Combine(directory, ".ghostbox-chunks.json");
    var chunks = new[]
    {
        new DepotManifest.ChunkData { Offset = 0, UncompressedLength = 2, Checksum = 0x00040003 },
        new DepotManifest.ChunkData { Offset = 2, UncompressedLength = 2, Checksum = 0x000a0007 },
    };
    var passed = 0;

    object Index(long? ticks = null, long length = 4, bool secondChunk = false, ulong manifest = 123)
    {
        File.WriteAllText(indexPath, JsonSerializer.Serialize(new
        {
            Version = 1,
            ManifestId = manifest,
            Files = new Dictionary<string, object>
            {
                [file] = new
                {
                    FileLength = length,
                    LastWriteUtcTicks = ticks ?? File.GetLastWriteTimeUtc(file).Ticks,
                    Chunks = secondChunk ? chunks : chunks.Take(1).ToArray(),
                },
            },
        }));
        return load.Invoke(null, [indexPath, 123UL])!;
    }

    async Task<bool[]> Validate(object index, CancellationToken cancellation = default) =>
        await (Task<bool[]>)validate.Invoke(runner, [file, chunks, 4L, cancellation, index, new object()])!;

    void Check(string name, bool condition)
    {
        if (!condition) throw new Exception($"FAIL: {name}");
        passed++;
        Console.WriteLine($"PASS: {name}");
    }

    File.WriteAllBytes(file, [1, 2, 3, 4]);
    var result = await Validate(Index());
    Check("unchanged index skips unrecorded chunks even if their bytes match", result.SequenceEqual([true, false]));

    result = await Validate(Index(ticks: 1));
    Check("modified file is read and checksummed", result.SequenceEqual([true, true]));

    result = await Validate(Index(manifest: 124));
    Check("different manifest never reuses cached chunks", result.SequenceEqual([true, true]));

    File.WriteAllBytes(file, [1, 2]);
    result = await Validate(Index(length: 4, secondChunk: true));
    Check("truncated file cannot reuse chunks beyond EOF", result.SequenceEqual([true, false]));

    // Um indice invalidado nao pode conservar entradas antigas de chunks ruins.
    File.WriteAllBytes(file, [1, 2, 0, 0]);
    var invalidated = Index(ticks: 1, secondChunk: true);
    result = await Validate(invalidated);
    Check("changed file rejects corrupted bytes", result.SequenceEqual([true, false]));
    save.Invoke(null, [indexPath, invalidated]);
    result = await Validate(load.Invoke(null, [indexPath, 123UL])!);
    Check("saving after revalidation does not revive stale chunks", result.SequenceEqual([true, false]));

    // Novo arquivo sparse/pre-alocado sem nenhum chunk precisa de indice vazio.
    File.Delete(file);
    var emptyIndex = load.Invoke(null, [indexPath + ".missing", 123UL])!;
    result = await Validate(emptyIndex);
    Check("missing file starts with no validated chunks", result.SequenceEqual([false, false]));
    File.WriteAllBytes(file, [1, 2, 3, 4]);
    save.Invoke(null, [indexPath, emptyIndex]);
    result = await Validate(load.Invoke(null, [indexPath, 123UL])!);
    Check("empty saved index avoids scanning preallocated data", result.SequenceEqual([false, false]));

    using var cancelled = new CancellationTokenSource();
    cancelled.Cancel();
    try
    {
        await Validate(Index(), cancelled.Token);
        Check("cached validation observes cancellation", false);
    }
    catch (OperationCanceledException)
    {
        Check("cached validation observes cancellation", true);
    }
    var prepareManifest = type.GetMethod("PrepareManifestForDownload", BindingFlags.NonPublic | BindingFlags.Static)!;
    var resolvePath = type.GetMethod("ResolveManifestFilePath", BindingFlags.NonPublic | BindingFlags.Static)!;
    var key = Enumerable.Range(0, 32).Select(value => (byte)value).ToArray();
    var iv = Enumerable.Range(32, 16).Select(value => (byte)value).ToArray();
    const string plainName = "data/game.pak";
    using var aes = Aes.Create();
    aes.Key = key;
    var encryptedIv = aes.EncryptEcb(iv, PaddingMode.None);
    var encryptedName = aes.EncryptCbc(Encoding.UTF8.GetBytes(plainName + "\0"), iv, PaddingMode.PKCS7);
    var cipherText = Convert.ToBase64String(encryptedIv.Concat(encryptedName).ToArray());

    DepotManifest Manifest(string name, bool encrypted = false) => new()
    {
        FilenamesEncrypted = encrypted,
        Files = [new DepotManifest.FileData { FileName = name, Chunks = [chunks[0]] }],
    };

    var encryptedManifest = Manifest(cipherText, encrypted: true);
    prepareManifest.Invoke(null, [encryptedManifest, key, directory]);
    Check("encrypted manifest names are decrypted before planning files",
        !encryptedManifest.FilenamesEncrypted && encryptedManifest.Files![0].FileName.Replace('\\', '/') == plainName);
    Check("manifest preparation does not create output files", !Directory.Exists(Path.Combine(directory, "data")));
    Check("decrypted paths stay inside the installation directory",
        (string)resolvePath.Invoke(null, [directory, encryptedManifest.Files![0].FileName])! == Path.Combine(directory, "data", "game.pak"));

    var clearManifest = Manifest(plainName);
    prepareManifest.Invoke(null, [clearManifest, key, directory]);
    Check("already decrypted manifests still work", clearManifest.Files![0].FileName == plainName);

    void RejectManifest(string name, byte[] depotKey, bool encrypted, string message)
    {
        try
        {
            prepareManifest.Invoke(null, [Manifest(name, encrypted), depotKey, directory]);
            Check(message, false);
        }
        catch (TargetInvocationException error) when (error.InnerException is InvalidDataException)
        {
            Check(message, true);
        }
    }

    RejectManifest(cipherText, Enumerable.Repeat((byte)255, 32).ToArray(), true,
        "wrong depot key is rejected before filesystem access");
    RejectManifest("not valid base64!", key, true, "malformed encrypted names are rejected");
    foreach (var invalidName in new[] { "../outside.pak", "data/../../outside.pak", "C:\\outside.pak", "\\\\host\\share\\file.pak", "/outside.pak", "data/bad:name.pak", "data/CON.txt", "data/file.", "data/file ", "data/bad\0name.pak" })
        RejectManifest(invalidName, key, false, $"unsafe manifest path rejected: {invalidName.Replace("\0", "<NUL>")}");
    Check("invalid manifests never create files outside the destination", !File.Exists(Path.Combine(Path.GetDirectoryName(directory)!, "outside.pak")));
    Console.WriteLine($"{passed} worker tests passed.");
}
finally
{
    Directory.Delete(directory, recursive: true);
}
