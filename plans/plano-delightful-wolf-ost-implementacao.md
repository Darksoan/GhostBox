# Implementação Fase 0 — PoC SteamKit2 + OpenSteamTools

## Visão geral

```
sidecars/
├── global.json                          # pin .NET 8
├── depotdownloader-mod/                 # fork limpo
└── steamkit-poc/
    ├── SteamKitPoc.csproj
    ├── Program.cs
    ├── LicenseGate.cs
    ├── OstKeyProvider.cs
    ├── ValveKeyProvider.cs
    └── Redaction.cs
```

---

## 1. Instalação .NET 8 SDK

```powershell
winget install Microsoft.DotNet.SDK.8
dotnet --list-sdks
# Deve mostrar algo como: 8.0.4xx
```

`global.json`:

```json
{
  "sdk": {
    "version": "8.0.400",
    "rollForward": "latestFeature"
  }
}
```

---

## 2. Fork DepotDownloaderMod

```powershell
cd sidecars
git clone https://github.com/niwia/DepotDownloaderMod-patched depotdownloader-mod
cd depotdownloader-mod
git remote add upstream https://github.com/SteamRE/DepotDownloader
git log --oneline -1   # registrar commit base
```

### Remoções no fork

| Arquivo | O que remover | Por quê |
|---------|---------------|---------|
| `DepotDownloader/DepotKeyStore.cs` | Arquivo inteiro | Carrega `depot.keys` de arquivo externo — fonte não rastreável |
| `DepotDownloader/Program.cs` | Flags `-depotkeys`, `-manifestfile`, `-apptoken`, `-packagetoken` | CLI aceita chave externa — burla o gate |
| `DepotDownloader/ContentDownloader.cs` | Chamadas a `DepotKeyStore`, injeção de `Steam3Session.DepotKeys` | Substituir por `LicenseGate.Resolve()` |
| `DepotDownloader/Steam3Session.cs` | Propriedade `DepotKeys` pública, métodos `LoadDepotKeys*` | Vazamento de interface de chave externa |

Escrever `FORK-NOTES.md` documentando cada remoção.

---

## 3. Componentes — especificação detalhada

### 3.1 `Redaction.cs`

**Responsabilidade:** Sanitizar todo output de log/stdout. Nenhum segredo vaza.

**Classes/estrutura:**

```csharp
/// <summary>
/// Filtro de stream que redige padrões sensíveis antes de escrever.
/// Envolve TextWriter — todo Write/WriteLine passa pelo filtro.
/// </summary>
class RedactionWriter : TextWriter
{
    // Padrões regex compilados:
    //   - KEY_PATTERN:     \b[0-9a-fA-F]{64}\b          → "[REDACTED_KEY]"
    //   - TOKEN_PATTERN:   eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+  → "[REDACTED_TOKEN]"
    //   - CHALLENGE_PATTERN: https://steamloopback\.host/.*  → "[REDACTED_CHALLENGE]"
    //   - STEAMID_PATTERN: (?!0)\d{17}                   → "[REDACTED_STEAMID]"
    
    private TextWriter _inner;
    private List<Regex> _patterns;
    
    // Construtor: inicializa patterns, recebe inner writer
    
    override void Write(char value);    // faz buffer de linha, aplica regex, escreve
    override void Write(string? value); // aplica regex, escreve
    override void WriteLine(string? value); // aplica regex + \n, escreve
    
    // Método utilitário público para redigir strings avulsas
    static string Sanitize(string raw);
}
```

**Uso:**

```csharp
// No Program.cs:
Console.SetOut(new RedactionWriter(Console.Out));
Console.SetError(new RedactionWriter(Console.Error));

// Qualquer output daqui em diante está sanitizado
```

**Testes unitários:**
- `"abc" + key64hex + "def"` → contém `[REDACTED_KEY]`, não o hex original
- `"ChallengeURL: https://steamloopback.host/challenge?token=abc"` → redigido
- `"Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3j1V1N9J6VQ"` → redigido
- String sem padrões → passa intacta

---

### 3.2 `OstKeyProvider.cs`

**Responsabilidade:** Ler depot keys dos arquivos `.lua` que GhostBox já instala em `config/stplug-in/`.

**Formato do `.lua`:**

```lua
-- addappid(depotId, ignored, "64hexkey")
addappid(1086940)
addappid(1086940, 0, "5954562e7f5260400040a818bc29b60b335bb690066ff767e20d145a3b6b4af0")
addappid(1086941, 0, "abc123...64hex")
setManifestid(1086941, "1234567890123456789")  -- comentado pelo GhostBox mas ignorado
```

**Classes/estrutura:**

```csharp
/// <summary>
/// Provedor de depot key que lê arquivos .lua do OpenSteamTool.
/// Parseia addappid(depotId, _, "hexkey") — o arg2 é ignorado (sempre 0 nos exemplos).
/// </summary>
class OstKeyProvider : IDepotKeyProvider
{
    // Regex: addappid\((\d+),\s*\d+,\s*"([0-9a-fA-F]{64})\)
    // Group 1: depotId (uint32)
    // Group 2: key (64 hex chars)
    private static readonly Regex AddAppIdKeyPattern = new(
        @"addappid\((\d+),\s*\d+,\s*""([0-9a-fA-F]{64})""\)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase
    );
    
    // Cache interno: depotId → key hex
    private Dictionary<uint, string> _keyCache = new();
    
    // Caminho para config/stplug-in/
    private string _stPlugInPath;
    
    // Timestamp da última leitura (para reload sob demanda)
    private DateTime _lastLoad = DateTime.MinValue;
    
    /// <param name="steamPath">Raiz da Steam (ex: C:\Program Files (x86)\Steam)</param>
    OstKeyProvider(string steamPath)
    {
        _stPlugInPath = Path.Combine(steamPath, "config", "stplug-in");
    }
    
    /// <summary>
    /// (Re)carrega todos os .lua do diretório stplug-in.
    /// Pula arquivos com erro de leitura (log aviso, não quebra).
    /// Chamado automaticamente se cache vazio ou força refresh.
    /// </summary>
    void LoadLuaFiles()
    {
        if (!Directory.Exists(_stPlugInPath))
            return; // sem OST instalado → sem chaves
        
        _keyCache.Clear();
        foreach (var file in Directory.GetFiles(_stPlugInPath, "*.lua"))
        {
            try
            {
                var content = File.ReadAllText(file);
                var matches = AddAppIdKeyPattern.Matches(content);
                foreach (Match match in matches)
                {
                    uint depotId = uint.Parse(match.Groups[1].Value);
                    string key = match.Groups[2].Value.ToLowerInvariant();
                    _keyCache[depotId] = key;
                }
            }
            catch (Exception ex)
            {
                Log($"Aviso: erro ao ler {file}: {ex.Message}");
            }
        }
        _lastLoad = DateTime.UtcNow;
    }
    
    /// <summary>
    /// IDepotKeyProvider.GetDepotKey
    /// Retorna null se não encontrar (LicenseGate cai para ValveKeyProvider).
    /// </summary>
    string? GetDepotKey(uint appId, uint depotId)
    {
        // Auto-load na primeira chamada ou se arquivos mudaram
        if (_keyCache.Count == 0)
            LoadLuaFiles();
        
        if (_keyCache.TryGetValue(depotId, out var key))
            return key;
        
        return null; // não encontrado → fallback para Valve
    }
    
    /// <summary>
    /// Força recarga dos .lua (útil se usuário instalou novo jogo via luatools_add_game).
    /// </summary>
    void Refresh() => LoadLuaFiles();
}
```

**Interface:**

```csharp
/// <summary>
/// Contrato para qualquer fonte de depot key.
/// </summary>
interface IDepotKeyProvider
{
    /// <summary>
    /// Tenta obter chave de descriptografia para um depot.
    /// Retorna null se não disponível.
    /// </summary>
    string? GetDepotKey(uint appId, uint depotId);
}
```

**Considerações:**
- OST não precisa estar rodando. Só os arquivos `.lua` em disco.
- `luatools.rs` já escreve esses arquivos — sem mudança no Rust.
- Keys entram pelo mesmo fluxo que já existe (`luatools_add_game`).
- Cache em memória; reload sob demanda via `Refresh()`.
- Nenhuma chave é persistida pelo PoC além do que já está nos `.lua`.

**Testes:**
- Fixture: `1086940.lua` com `addappid(1086940, 0, "5954562e7f5260400040a818bc29b60b335bb690066ff767e20d145a3b6b4af0")` → `GetDepotKey(0, 1086940)` retorna a key
- Fixture: `.lua` sem `addappid` → retorna null
- Fixture: `.lua` com key de 63 hex → ignorada (regex exige 64)
- Fixture: diretório vazio → retorna null sem crash

---

### 3.3 `ValveKeyProvider.cs`

**Responsabilidade:** Obter depot key via `SteamApps.GetDepotDecryptionKey` na sessão SteamKit2 autenticada.

**Classes/estrutura:**

```csharp
/// <summary>
/// Provedor de depot key via SteamKit2 — consulta a Valve diretamente.
/// Só funciona se a sessão estiver logada E o usuário possuir o conteúdo.
/// </summary>
class ValveKeyProvider : IDepotKeyProvider
{
    private SteamApps _steamApps;
    private bool _isReady;
    
    /// <param name="steamApps">Instância de SteamApps da sessão SteamKit2 já logada.</param>
    ValveKeyProvider(SteamApps steamApps)
    {
        _steamApps = steamApps;
        _isReady = steamApps != null;
    }
    
    /// <summary>
    /// IDepotKeyProvider.GetDepotKey
    /// Chama SteamApps.GetDepotDecryptionKey(depotId, appId).
    /// Retorna null se negado ou sessão não disponível.
    /// </summary>
    string? GetDepotKey(uint appId, uint depotId)
    {
        if (!_isReady) return null;
        
        var callback = _steamApps.GetDepotDecryptionKey(depotId, appId);
        
        // Aguarda resposta (com timeout)
        if (!callback.WaitForCallback(TimeSpan.FromSeconds(10)))
            return null; // timeout
        
        if (callback.Result != EResult.OK)
            return null; // Valve negou
        
        // callback.DepotKey é byte[] — converter para hex string
        return Convert.ToHexString(callback.DepotKey).ToLowerInvariant();
    }
    
    /// <summary>
    /// Marca provider como indisponível (ex: logout).
    /// </summary>
    void Invalidate() => _isReady = false;
}
```

**Fluxo SteamKit2 para obter a sessão:**

```
1. SteamClient.Connect()
2. ConnectedCallback → SteamUser.LogOnAnonymous()
3. OU: LogOn com refresh token (via QR)
4. LoggedOnCallback (EResult.OK) → SteamApps disponível
```

**Nota:** `GetDepotDecryptionKey` requer callback `Callback<DepotKeyCallback>`. Implementação real pode usar `var result = await _steamApps.GetDepotDecryptionKey(depotId, appId, cancellationToken)` do SteamKit2 3.x.

---

### 3.4 `LicenseGate.cs`

**Responsabilidade:** Ponto único de resolução de depot key. Two-stage: OST → Valve. Nenhum outro código produz chave.

**Classes/estrutura:**

```csharp
/// <summary>
/// Resolvedor two-stage de depot keys.
/// Ordem: 1. OstKeyProvider (.lua)  2. ValveKeyProvider (SteamKit2).
/// Se ambos falham, retorna null → download negado.
/// </summary>
class LicenseGate
{
    private OstKeyProvider _ost;
    private ValveKeyProvider _valve;
    
    // Registro de qual fonte serviu cada chave (para auditoria)
    public enum KeySource { None, Ost, Valve }
    private Dictionary<(uint AppId, uint DepotId), KeySource> _auditLog = new();
    
    LicenseGate(OstKeyProvider ost, ValveKeyProvider valve)
    {
        _ost = ost;
        _valve = valve;
    }
    
    /// <summary>
    /// Resolve chave para (appId, depotId).
    /// 1. Tenta OST (lê .lua).
    /// 2. Se falha, tenta Valve (GetDepotDecryptionKey).
    /// 3. Se ambos falham, retorna null.
    /// </summary>
    DepotKeyResult? Resolve(uint appId, uint depotId)
    {
        // Stage 1: OpenSteamTools
        var ostKey = _ost.GetDepotKey(appId, depotId);
        if (ostKey != null)
        {
            _auditLog[(appId, depotId)] = KeySource.Ost;
            LogDepotKeyResolved(appId, depotId, KeySource.Ost);
            return new DepotKeyResult(depotId, ostKey, KeySource.Ost);
        }
        
        // Stage 2: Valve
        var valveKey = _valve.GetDepotKey(appId, depotId);
        if (valveKey != null)
        {
            _auditLog[(appId, depotId)] = KeySource.Valve;
            LogDepotKeyResolved(appId, depotId, KeySource.Valve);
            return new DepotKeyResult(depotId, valveKey, KeySource.Valve);
        }
        
        // Negado
        _auditLog[(appId, depotId)] = KeySource.None;
        LogDepotKeyDenied(appId, depotId);
        return null;
    }
    
    /// <summary>
    /// Relatório de auditoria: lista todas as resoluções com fonte.
    /// Para verificação do critério 13.
    /// </summary>
    Dictionary<(uint, uint), KeySource> GetAuditLog() => _auditLog;
    
    private void LogDepotKeyResolved(uint appId, uint depotId, KeySource source)
    {
        Console.WriteLine($"MARCO=DepotAccessGranted ok=true source={source} appId={appId} depotId={depotId}");
    }
    
    private void LogDepotKeyDenied(uint appId, uint depotId)
    {
        Console.WriteLine($"MARCO=DepotAccessDenied ok=false appId={appId} depotId={depotId}");
    }
    
    /// <summary>
    /// Resultado da resolução.
    /// </summary>
    record DepotKeyResult(uint DepotId, string KeyHex, KeySource Source);
}
```

**Auditoria (critério 13):**
```csharp
// Ao final do PoC:
var log = gate.GetAuditLog();
foreach (var ((appId, depotId), source) in log)
{
    Console.WriteLine($"AUDIT: appId={appId} depotId={depotId} source={source}");
}
// grep no stdout deve mostrar só Ost ou Valve — nunca None para depots que baixaram.
```

---

### 3.5 `Program.cs`

**Responsabilidade:** Roteia os 15 passos do PoC, imprime marcos no formato `MARCO=<nome> ok=<bool>`.

**Estrutura:**

```
Program.cs
├── static async Task Main(string[] args)
│   ├── ParseArgs()              → --app-id, --deny-probe-app-id, --ost-provider, --reuse-session, --steam-path
│   ├── RedactOutput()           → Console.SetOut(new RedactionWriter(...))
│   ├── 
│   ├── === PASSO 1-7: LOGIN ===
│   ├── CallbackManager()
│   ├── SteamClient.Connect()
│   ├── WaitForConnected(timeout)
│   ├── BeginAuthSessionViaQRAsync()
│   ├── PollLogin()
│   ├── SteamUser.LogOn()
│   └── WaitForLoggedOn(timeout) → MARCO=AuthenticatedAccount ok=true/false
│   │
│   ├── === PASSO 8: LICENSES ===
│   ├── WaitForLicenseList(timeout)
│   ├── FetchPackageInfo(packageIds)
│   ├── BuildOwnedAppIdsSet()
│   ├── MARCO=LicenseCount ok={count > 0}
│   │
│   ├── === PASSO 9: APPINFO ===
│   ├── PICSGetProductInfo(appId)
│   ├── ExtractDepotsSection()
│   ├── MARCO=AppInfoResolved ok=bool
│   │
│   ├── === PASSO 10-11: LICENSE GATE ===
│   ├── LicenseGate gate(steamPath, steamApps)
│   │
│   ├── // Prova 1: depot possuído → espera ValveKeyProvider OK
│   ├── gate.Resolve(ownedAppId, ownedDepotId)
│   ├── MARCO=DepotAccessGranted ok=true source=Valve
│   │
│   ├── // Prova 2: depot NÃO possuído, sem OST → espera negação
│   ├── gate.Resolve(denyProbeAppId, denyProbeDepotId)
│   ├── MARCO=DepotAccessDenied ok=true
│   │
│   ├── // Prova 3: OST (se --ost-provider)
│   ├── if (ostProviderAppId != null)
│   │   gate.Resolve(ostProviderAppId, ostProviderDepotId)
│   │   MARCO=OstKeyProvided ok=true/false
│   │
│   ├── === PASSO 12: MANIFEST ===
│   ├── GetManifestRequestCode(appId, depotId)
│   ├── CDNClient.Pool()
│   ├── DownloadAndDecryptManifest()
│   ├── MARCO=ManifestResolved ok=bool
│   │
│   ├── === PASSO 13: CHUNK ===
│   ├── PickFirstChunk(manifest)
│   ├── DownloadChunk(cdnClient, server, chunk)
│   ├── ValidateChecksum(chunk)
│   ├── if (corruptChunk) flipByte()
│   ├── MARCO=ChunkDownloaded ok=bool
│   ├── MARCO=ChunkHashValid ok=bool
│   │
│   ├── === PASSO 14: PERSIST ===
│   ├── EncryptAndSaveSession(refreshToken)
│   ├── MARCO=SessionPersisted ok=bool
│   │
│   ├── === PASSO 15: REUSE (if --reuse-session) ===
│   ├── LoadAndDecryptSession()
│   ├── LogOnWithToken()
│   ├── if (rejected) clearInvalidAndExit()
│   ├── MARCO=SessionReused ok=bool/false
│   │
│   └── === AUDITORIA ===
│       PrintAuditLog()
```

**Parse de argumentos:**

```
--app-id <uint>               AppID possuído para teste de download
--deny-probe-app-id <uint>    AppID NÃO possuído para prova de negação
--ost-provider <uint>         AppID com .lua em stplug-in para prova OST
--steam-path <path>           Caminho da Steam (default: auto-detect)
--reuse-session               Reusar sessão salva (pula QR)
--corrupt-chunk               Flip 1 byte no chunk para testar validação
```

---

## 4. `SteamKitPoc.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="SteamKit2" Version="3.4.0" />
    <PackageReference Include="protobuf-net" Version="3.2.56" />
    <PackageReference Include="QRCoder" Version="1.8.0" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\depotdownloader-mod\DepotDownloader\DepotDownloaderMod.csproj" />
  </ItemGroup>

</Project>
```

---

## 5. Comandos de execução

```powershell
# Prova completa: login + license + chunk
dotnet run --project sidecars/steamkit-poc -- `
  --app-id 730 `                         # CS:GO (exemplo, usar jogo real da conta)
  --deny-probe-app-id 440 `              # TF2 (se não for possuído)

# Com prova OST
dotnet run --project sidecars/steamkit-poc -- `
  --app-id 730 `
  --deny-probe-app-id 440 `
  --ost-provider 1086940 `               # Baldur's Gate 3 (se tiver .lua)

# Reusar sessão
dotnet run --project sidecars/steamkit-poc -- `
  --reuse-session `
  --app-id 730

# Teste de corrupção
dotnet run --project sidecars/steamkit-poc -- `
  --app-id 730 --corrupt-chunk
```

---

## 6. Estrutura de callbacks SteamKit2 (Program.cs detalhado)

```csharp
class SteamKitPoc
{
    private SteamClient _client;
    private CallbackManager _manager;
    private SteamUser _steamUser;
    private SteamApps _steamApps;
    
    // Estados para sincronização
    private bool _connected;
    private bool _loggedOn;
    private EResult _loginResult;
    private SteamID _steamId;
    private List<uint> _packageIds;
    private List<uint> _ownedAppIds;
    private string? _refreshToken;
    
    async Task RunAsync(Config config)
    {
        Console.SetOut(new RedactionWriter(Console.Out));
        Console.SetError(new RedactionWriter(Console.Error));
        
        _client = new SteamClient(SteamConfiguration.Create(b => 
            b.WithProtocolTypes(ProtocolTypes.WebSocket) // só WebSocket, sem TCP local
        ));
        
        _manager = new CallbackManager(_client);
        
        // Registrar callbacks
        _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
        _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
        _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
        _manager.Subscribe<SteamUser.LicenseListCallback>(OnLicenseList);
        _manager.Subscribe<SteamApps.DepotKeyCallback>(OnDepotKey);
        
        // Thread de callbacks
        var callbackTask = Task.Run(() =>
        {
            while (!_shutdown)
            {
                _manager.RunWaitCallbacks(TimeSpan.FromMilliseconds(100));
            }
        });
        
        // Connect
        _client.Connect();
        await WaitForCondition(() => _connected, TimeSpan.FromSeconds(30));
        Console.WriteLine("MARCO=Connected ok=true");
        
        // QR Auth
        if (!config.ReuseSession)
        {
            var auth = _client.BeginAuthSessionViaQRAsync();
            // Poll para URLs
            while (auth.State != EAuthSessionState.Confirmed)
            {
                Console.WriteLine($"MARCO=QRChallenge url=<redacted> state={auth.State}");
                await Task.Delay(1000);
            }
            var loginKey = await auth.PollingWaitForResultAsync();
            
            _client.LogOn(new SteamUser.LogOnDetails
            {
                LoginID = 0xFEED, // ID próprio para não conflitar com steam.exe
                Username = loginKey.AccountName,
                RefreshToken = loginKey.RefreshToken,
            });
        }
        else
        {
            // Load session from file
            var session = LoadSession(config.SteamPath);
            _client.LogOn(new SteamUser.LogOnDetails
            {
                LoginID = 0xFEED,
                Username = session.AccountName,
                RefreshToken = session.RefreshToken,
            });
        }
        
        await WaitForCondition(() => _loggedOn, TimeSpan.FromSeconds(30));
        
        if (_loginResult != EResult.OK)
        {
            Console.WriteLine($"MARCO=AuthenticatedAccount ok=false error={_loginResult}");
            if (config.ReuseSession)
            {
                DeleteSession(config.SteamPath);
                Console.WriteLine("MARCO=SessionInvalidated ok=true");
            }
            return;
        }
        Console.WriteLine($"MARCO=AuthenticatedAccount ok=true steamId={_steamId}");
        
        // ... continua com LicenseList, Gate, etc.
    }
    
    void OnConnected(SteamClient.ConnectedCallback callback) { _connected = true; }
    void OnLoggedOn(SteamUser.LoggedOnCallback callback) { _loggedOn = true; _loginResult = callback.Result; _steamId = callback.ClientSteamID; _refreshToken = callback.RefreshToken; }
    void OnLicenseList(SteamUser.LicenseListCallback callback) { _packageIds = callback.Packages.Select(p => (uint)p).ToList(); }
    
    // Estados intermediários
    private async Task WaitForCondition(Func<bool> condition, TimeSpan timeout) { /* spin com timeout */ }
}
```

---

## 7. Persistência de sessão (ProtectedData)

```csharp
record SessionRecord
{
    int SchemaVersion = 1;
    ulong SteamId;
    string AccountName;
    byte[] EncryptedRefreshToken; // DPAPI
    string? TokenFingerprint;     // SHA256 parcial, nunca o token completo
    DateTime CreatedAt;
}

string SessionPath(string steamPath) =>
    Path.Combine(steamPath, "steamkit-poc", "session.json");

void SaveSession(SessionRecord session)
{
    var dir = Path.GetDirectoryName(SessionPath(steamPath));
    Directory.CreateDirectory(dir);
    
    // Criptografar token
    session.EncryptedRefreshToken = ProtectedData.Protect(
        Encoding.UTF8.GetBytes(session.TokenFingerprint ?? ""),
        null,
        DataProtectionScope.CurrentUser
    );
    
    var json = JsonSerializer.Serialize(session);
    File.WriteAllText(SessionPath(steamPath), json);
}

SessionRecord? LoadSession(string steamPath)
{
    if (!File.Exists(SessionPath(steamPath))) return null;
    var json = File.ReadAllText(SessionPath(steamPath));
    var session = JsonSerializer.Deserialize<SessionRecord>(json);
    // Descriptografar
    var tokenBytes = ProtectedData.Unprotect(
        session.EncryptedRefreshToken, null, DataProtectionScope.CurrentUser
    );
    return session;
}
```

---

## 8. Fluxo completo (diagrama simplificado)

```
┌─ Program.Main ──────────────────────────────────────────────┐
│                                                              │
│  RedactionWriter(Console.Out/Error)                          │
│       ↓                                                      │
│  SteamClient.Connect()                                       │
│       ↓                                                      │
│  ConnectedCallback                                           │
│       ↓                                                      │
│  QR Auth (ou reuse)                                          │
│       ↓                                                      │
│  LoggedOnCallback                                            │
│   → MARCO=AuthenticatedAccount ok=true                       │
│       ↓                                                      │
│  LicenseListCallback → PackageIDs                            │
│   → PICSGetProductInfo(packages) → OwnedAppIds               │
│   → MARCO=LicenseCount ok=42                                 │
│       ↓                                                      │
│  PICSGetProductInfo(appId) → depots section                  │
│   → MARCO=AppInfoResolved ok=true                            │
│       ↓                                                      │
│  LicenseGate.Resolve(appId, depotId)                          │
│   ├─ OstKeyProvider.GetDepotKey(depotId)                     │
│   │   └─ parse lua → key? → MARCO=DepotAccessGranted source=Ost│
│   └─ ValveKeyProvider.GetDepotKey(appId, depotId)             │
│       └─ GetDepotDecryptionKey → key?                        │
│           → MARCO=DepotAccessGranted source=Valve            │
│       └─ nenhum → MARCO=DepotAccessDenied ok=true            │
│       ↓                                                      │
│  GetManifestRequestCode(depotId) → gid                       │
│   → CDNClient.DownloadManifest(gid, depotKey)                │
│   → MARCO=ManifestResolved ok=true                           │
│       ↓                                                      │
│  CDNClient.DownloadChunk(server, chunk)                      │
│   → ValidateChecksum(chunk)                                  │
│   → MARCO=ChunkDownloaded ok=true                            │
│   → MARCO=ChunkHashValid ok=true                             │
│       ↓                                                      │
│  ProtectedData.Protect(refreshToken)                         │
│   → Write session.json                                       │
│   → MARCO=SessionPersisted ok=true                           │
│       ↓                                                      │
│  (se --reuse-session) LoadAndLogin →                         │
│   → MARCO=SessionReused ok=true                              │
│       ↓                                                      │
│  PrintAuditLog()                                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Marcos de saída (formato exato)

```
MARCO=Connected ok=true
MARCO=QRChallenge url=*** url=***
MARCO=AuthenticatedAccount ok=true
MARCO=LicenseCount ok=42
MARCO=AppInfoResolved ok=true
MARCO=DepotAccessGranted ok=true source=Ost
MARCO=DepotAccessGranted ok=true source=Valve
MARCO=OstKeyProvided ok=true
MARCO=ManifestResolved ok=true
MARCO=ChunkDownloaded ok=true
MARCO=ChunkHashValid ok=true
MARCO=SessionPersisted ok=true
MARCO=SessionReused ok=true
```

---

## 10. Critérios de verificação mapeados para implementação

| # | Verificação | Onde cobre |
|---|---|---|
| 1 | Login QR sem steam.exe | `Program.cs` passos 1-7 |
| 2 | Licenças lidas | `OnLicenseList` + PICSGetProductInfo |
| 3 | Conteúdo não licenciado negado | `LicenseGate.Resolve(denyProbeAppId, ...)` → null |
| 4 | Chunk baixado e íntegro | `CDNClient.DownloadChunk` + validação |
| 5 | Corrupção detectada | `--corrupt-chunk` → `ChunkHashValid ok=false` |
| 6 | Sessão reutilizável | `--reuse-session` → `SessionReused ok=true` |
| 7 | Token revogado tratado | `LoadSession` → login rejeitado → `DeleteSession` |
| 8 | Nenhuma senha persistida | Só `ProtectedData.Protect(refreshToken)` |
| 9 | Token não vaza em log | `RedactionWriter` filtra token/key patterns |
| 10 | Sessão usuário preservada | `LoginID = 0xFEED` (distinto do steam.exe) |
| 11 | Nenhuma escrita externa | Só escreve `session.json` em `steamkit-poc/` |
| 12 | OST como fonte | `OstKeyProvider` lê .lua → `OstKeyProvided ok=true` |
| 13 | Gate auditado | `LicenseGate.GetAuditLog()` + grep no fork |

---

## 11. Ordem de implementação (pull requests)

| # | Entrega | Arquivos |
|---|---|---|
| 1 | Scaffold: .NET 8, global.json, sidecars/ | `global.json`, `sidecars/` |
| 2 | Fork limpo: DepotDownloaderMod sem DepotKeyStore | `depotdownloader-mod/` purgado |
| 3 | Redação: Redaction.cs + testes | `steamkit-poc/Redaction.cs` |
| 4 | Gate: LicenseGate + OstKeyProvider + ValveKeyProvider | `teams/steamkit-poc/LicenseGate.cs`, `OstKeyProvider.cs`, `ValveKeyProvider.cs` |
| 5 | Login: Program.cs passos 1-7 | `steamkit-poc/Program.cs` (QR auth) |
| 6 | Licenças: passos 8-9 | `Program.cs` (LicenseList, AppInfo) |
| 7 | Download: passos 10-13 | `Program.cs` (Gate, Manifest, Chunk) |
| 8 | Sessão: passos 14-15 | `Program.cs` (Persist, Reuse) |
| 9 | Auditoria: critério 13 | `Program.cs` (PrintAuditLog, grep fork) |
