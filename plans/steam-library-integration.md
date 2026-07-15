# Plano: Integração completa da biblioteca Steam

## Objetivo

Fazer a biblioteca do GhostBox refletir **todos os jogos da conta Steam do usuário** (não só instalados/plugin), migrar **conquistas e métricas do perfil Steam** para o app, e expor **controles na aba Ajustes → Biblioteca** para ligar/desligar e afinar a integração.

Produto permanece **local-first** e **não distribui jogos** (`POLICIES.md`). Steam Web API key continua só no worker `steam-stats` — nunca no desktop.

---

## Estado atual (o que já existe)

### Biblioteca local

| Peça | Onde |
|------|------|
| Scan de jogos **instalados** | `steam_scan_library` → `libraryfolders.vdf` + `appmanifest_*.acf` + `stplug-in/*.lua` |
| Persistência | `ghostbox-library.json` (`ghostbox_library.rs`) |
| UI | `LibraryPage.tsx` ← `addedLibraryGames` |
| Merge no frontend | `AppDataContext.applySteamLibraryScanResult` |

Hoje a library = **instalados no disco + jogos GhostBox/LuaTools**, não a owned library remota completa.

### Steam account / métricas (backend à frente da UI)

| Peça | Onde |
|------|------|
| Login OpenID | `steam_sign_in` / perfil em `SteamProfile` |
| Owned games + playtimes | Worker `GET /steam/owned-games`, Tauri `syncSteamPlaytimes` |
| Account stats (totais, perfect games, recent achievements) | Worker `GET /steam/account-stats`, tipo `SteamAccountStats` |
| Listener | `onSteamAccountStatsUpdated` / evento `steam-account-stats-updated` |
| Uso real no UI | quase só `ownedPlaytimes` para decidir `registerSteamLibraryGame` vs LuaTools; Profile **não** renderiza métricas completas |

### Conquistas

| Fonte | Uso |
|-------|-----|
| Schema/lista por jogo (store/catalogue) | `GameAchievementsPage`, detalhes do jogo |
| Unlock local (appcache) | `achievement_monitor.rs` durante sessão |
| Agregação de perfil | `profileAchievements.ts` a partir de library + history + appcache |
| Contas Steam (GetPlayerAchievements via worker) | entra em `SteamAccountStats` / scan progressivo, **pouco exposto no Profile** |

### Ajustes → Biblioteca

| Item | Status |
|------|--------|
| Caminho da pasta Steam | Implementado |
| `showSteamGames` (i18n + localStorage + state) | **Meio pronto**: state em `AppDataContext`, keys em `storage.ts` / `catalogue.ts`, labels em `i18n.ts` — **sem toggle na UI e sem filtro consumidor** |
| Sync / conquistas / métricas / filtros | **Não existem** na tab |

### Identidade

Tudo gira em `steamProfile.steamId` (Premium, Discord, cloud profile, stats).

---

## Não-objetivos

- Não embutir Steam Web API key no app desktop.
- Não baixar/instalar jogos Steam pela SteamCMD ou copiar DRM.
- Não substituir o catálogo remoto pela owned library.
- Não forçar cloud sync de conquistas (local-first; cloud opcional só se fizer sentido depois).
- Não refatorar `AppDataContext` inteiro — mudanças cirúrgicas.

---

## Modelo de dados alvo

### Origem de cada jogo na library

```ts
type LibraryGameSource =
  | "steam-installed"   // appmanifest no disco
  | "steam-owned"       // GetOwnedGames (não instalado)
  | "ghostbox"          // adicionado via GhostBox / LuaTools / register
  | "plugin";           // stplug-in
```

Estender `GhostBoxGame` (ou campo paralelo no scan result) com:

```ts
{
  librarySource?: LibraryGameSource;
  steamOwned?: boolean;       // true se está na conta
  installed?: boolean;        // true se tem manifest local
  // hours / lastTimePlayed já existem — preferir Steam owned quando source=steam
}
```

### Merge de fontes (prioridade)

1. **Identidade** = `appId` (string).
2. **Instalado** sobrescreve metadados de path/status (`installed` / playable).
3. **Owned remoto** preenche playtime Steam e garante presença na lista quando `includeOwnedSteamGames` estiver on.
4. **GhostBox/plugin** mantém jogos adicionados localmente mesmo se não estiverem na conta (comportamento atual).
5. **Títulos**: reutilizar `normalizeSteamGameTitles` + catálogo/cache de assets existentes.

### Snapshot local de owned library

Novo arquivo em app data (Rust), espelhando playtimes:

- `steam-owned-library.json`  
  - `{ steamId, fetchedAt, games: [{ appId, name?, playtimeForever, rtimeLastPlayed }] }`  
- Alimentado por `syncSteamPlaytimes` / owned-games (já existe pipeline parcial em `steam-owned-playtimes.json`).
- Evita depender de rede a cada abertura da Library.

### Conquistas migradas

Camadas (sem quebrar local):

| Camada | Persistência | Função |
|--------|--------------|--------|
| A — Local unlock | appcache + monitor (já existe) | realtime em sessão |
| B — Steam remote per-game | cache por `appId` (JSON ou SQLite leve) | unlocks oficiais + timestamps |
| C — Account aggregate | `SteamAccountStats` (já existe) | totais, perfect games, recent |
| D — UI Profile | `profileAchievements.ts` + Profile tabs | unificar B+C com fallback A |

Regra de merge por achievement:

- Se local diz unlocked e Steam diz locked → preferir **unlocked** (não regredir progresso).
- Se Steam tem `unlocktime` e local não → usar Steam.
- Ícones/títulos: schema store (já usado) como canônico.

---

## Controles em Ajustes → Biblioteca

Expandir a tab `library` em `SettingsPage.tsx` (padrão de opções igual às outras tabs).

### Grupo 1 — Caminho e scan local

| Opção | Default | Comportamento |
|-------|---------|---------------|
| Pasta Steam | (atual) | picker + rescan |
| Escanear biblioteca agora | action | chama `scanSteamLibrary(path)` + toast |
| Auto-scan ao abrir o app | on | já existe fluxo no boot; tornar explícito/opcional |

### Grupo 2 — Integração Steam (conta)

Requer `steamProfile.steamId`. Se deslogado, toggles desabilitados + CTA “Entrar com Steam”.

| Opção | Key sugerida | Default | Comportamento |
|-------|--------------|---------|---------------|
| Mostrar jogos da Steam (owned + instalados) | `showSteamGames` (**já existe**) | `true` | inclui owned remoto na Library |
| Incluir jogos não instalados | `includeUninstalledSteamGames` | `true` | se off, owned só se instalado |
| Sincronizar tempo de jogo da Steam | `syncSteamPlaytimesEnabled` | `true` | chama `syncSteamPlaytimes` no login/boot |
| Sincronizar conquistas da conta | `syncSteamAchievementsEnabled` | `true` | dispara/consome account-stats + hydrata profile |
| Sincronizar métricas do perfil | `syncSteamAccountStatsEnabled` | `true` | `getSteamAccountStats` + listener |
| Intervalo de re-sync | `steamSyncIntervalMinutes` | `60` | throttle; botão “Sincronizar agora” |

### Grupo 3 — Privacidade / exibição

| Opção | Default | Comportamento |
|-------|---------|---------------|
| Badge de origem na Library (Steam / Instalado / GhostBox) | off | chip sutil no card |
| Ocultar jogos com 0h e não instalados | off | filtro opcional |
| Notificar novas conquistas | usa `notifications.achievementsEnabled` | **expor** toggle que já existe no model |

### Persistência das novas flags

- Preferir `localStorage` no padrão de `showSteamGames` (`ghostbox:*:v1` + legacy map em `catalogue.ts` / `storage.ts`).
- Ou um único blob `ghostbox:steam-integration:v1` se o número de flags crescer (evitar N keys soltas).
- Não misturar com settings de aparência (`settings.tsx`) — integração Steam é domínio de `AppDataContext` + Steam path nativo.

### i18n

Mover copy de `settings.general.showSteamGames` → `settings.library.*` (PT/EN) e adicionar as novas chaves na mesma seção da tab Biblioteca.

---

## Fluxos principais

### 1) Bootstrap / login Steam

```
sign-in OK
  → se syncPlaytimes: syncSteamPlaytimes(steamId)
  → se syncAccountStats: getSteamAccountStats(steamId) + subscribe onSteamAccountStatsUpdated
  → se showSteamGames: mergeOwnedIntoLibrary(owned snapshot + scan local)
  → se syncAchievements: hydratar profile achievements (progressivo, não bloquear UI)
```

### 2) Library render

```
base = scan local (instalados + ghostbox/plugin)
if showSteamGames && steamId:
  owned = load steam-owned-library snapshot (ou stats.ownedPlaytimes)
  merge by appId
  if !includeUninstalled: filter !installed && source==steam-owned
apply hide-zero-hours filter se on
sort/filter UI existente (librarySort, collections)
```

### 3) Conquistas → Profile

```
on account-stats update:
  set steamAccountStats state (novo no AppDataContext)
  rebuild profile showcase: recentAchievements do worker + perfectGames + totals
per-game open achievements:
  local appcache first
  background: se syncAchievements, fetch schema+player achievements (já há paths Tauri/worker)
  merge unlock state
```

### 4) Settings toggle `showSteamGames` off

- Library volta ao comportamento atual (só instalados/GhostBox).
- Não apagar snapshots locais (só para de consumir).
- Playtime local de sessão continua.

### 5) Perfil privado Steam

`SteamAccountStats.private === true` → banner no Profile + na tab Biblioteca: “Perfil Steam privado; owned library/conquistas remotas indisponíveis”. Manter scan local.

---

## Superfície de UI

### Library (`LibraryPage.tsx`)

- Contador: “X jogos” pode incluir owned; subtítulo opcional “Y instalados · Z na Steam”.
- Filtro rápido: Todos | Instalados | Steam (owned) | Favoritos | coleções (reutilizar chips).
- Status card: não instalado = `discover` / badge “Na Steam” (sem botão de install Steam — só info / abrir no Steam se já existir launch path).
- Zero regressão: com `showSteamGames=false`, grid idêntico ao de hoje.

### Profile (`ProfilePage.tsx`)

Overview deve consumir `SteamAccountStats` quando disponível:

- Total de jogos na conta
- Tempo total jogado
- Conquistas desbloqueadas / total / % média
- Jogos perfeitos
- Progresso do scan (`scannedGames/pendingGames`) se `scanInProgress`
- Lista **recent achievements** do worker (além do showcase local)

Tab Conquistas: unificar fonte via `profileAchievements.ts` (local + remote merge).

### Settings (`SettingsPage.tsx` + `settingsTabsShared.ts`)

- Só expandir tab `library` (sem nova tab).
- Reutilizar layout de options rows (label + description + switch/path/button).
- Ações: “Sincronizar agora”, “Escanear pasta Steam”.

### Notifications

Expor na tab `notifications` os toggles já modelados e não wireados (desktop, achievements) — escopo adjacente, pode ser fase própria se quiser manter o PR focado.

---

## Backend / Tauri / Worker

### Já reutilizar

- `workers/steam-stats`: `/steam/owned-games`, `/steam/account-stats`, `/steam/player-level`
- `steam_sync_playtimes`, `getSteamAccountStats`, `onSteamAccountStatsUpdated`
- `steam_scan_library`, playtime store, achievement monitor

### Mudanças Rust (mínimas)

| Mudança | Arquivo |
|---------|---------|
| Retornar no scan (ou comando irmão) flags `installed` + lista de appIds instalados | `steam.rs` / scan result type |
| Snapshot owned library em disco + load | `steam.rs` (junto de owned playtimes) |
| Comando `steam_merge_library` **ou** merge só no frontend | preferir **frontend merge** primeiro para menos risco |
| Opcional: comando único `steam_get_owned_library(steamId)` que devolve snapshot tipado | facade `ghostboxApi` |

### Mudanças frontend

| Mudança | Arquivo |
|---------|---------|
| State `steamAccountStats`, flags de integração | `AppDataContext.tsx` |
| `mergeSteamOwnedIntoLibrary` | novo util `utils/steamLibraryMerge.ts` |
| Consumir `showSteamGames` de verdade na library | `LibraryPage` / selectors no context |
| Settings library options | `SettingsPage.tsx`, `i18n.ts`, storage keys |
| Profile metrics | `ProfilePage.tsx` |
| Merge conquistas | `profileAchievements.ts` |
| Types | `types/index.ts`, `ghostboxApi.types.ts`, `data.ts` se necessário |

### Worker

Só se faltar payload:

- Garantir `ownedPlaytimes` **com `name`** (hoje pode ser só appId/playtime) para cards sem round-trip ao catálogo.
- Rate limit / cache KV já existentes; não mudar auth.

---

## Fases de implementação

### Fase 0 — Wire do que já está meio pronto (1 PR pequeno)

1. Toggle **Mostrar jogos da Steam** na tab Biblioteca (state `showSteamGames` existente).
2. Definir comportamento mínimo: se on, após scan local + `ownedPlaytimes`/`syncSteamPlaytimes`, **inserir na library** jogos owned que faltam (status não instalado).
3. Se off, library = só scan atual.
4. i18n: mover keys para `settings.library`.
5. Typecheck + smoke manual: login, toggle on/off, abrir Library.

**Critério de aceite:** com login Steam e toggle on, Library lista mais jogos do que só os instalados; off restaura lista anterior.

### Fase 1 — Modelo de origem + UX Library

1. Campo `librarySource` / `installed` no merge.
2. Filtros Instalados vs Steam na Library.
3. Contadores e badges opcionais.
4. Persistência snapshot owned para cold start offline.
5. Botões “Escanear” / “Sincronizar agora” em Ajustes.

**Critério de aceite:** filtros corretos; offline mostra último snapshot owned; instalados continuam jogáveis.

### Fase 2 — Métricas no Profile

1. State global `steamAccountStats` + subscribe `onSteamAccountStatsUpdated`.
2. Cards de overview (playtime total, conquistas, perfect games, level já existe).
3. Recent achievements do worker no showcase.
4. Empty/private/error states.
5. Toggle “Sincronizar métricas” em Ajustes.

**Critério de aceite:** Profile logado mostra números coerentes com a conta (perfil público); privado explica limitação.

### Fase 3 — Migração de conquistas

1. Hydrate profile achievements com dados do account-stats scan + per-game quando aberto.
2. Merge rules local vs Steam (não regredir unlocks).
3. Progress indicator se scan account-stats ainda rodando.
4. Toggle “Sincronizar conquistas”.
5. Garantir que `GameAchievementsPage` e monitor local não regredem.

**Critério de aceite:** Profile/tab conquistas reflete unlocks da conta; unlock em sessão local ainda notifica e aparece.

### Fase 4 — Controles finos + polish

1. `includeUninstalledSteamGames`, hide 0h, intervalo de sync, badges.
2. Expor toggles de notificação de conquistas se ainda faltarem.
3. Performance: virtualização se owned library >> instalados (só se necessário; medir).
4. Docs internas curtas no próprio plan report.

---

## Ordem de arquivos a tocar (por fase)

### Fase 0

- `src/pages/SettingsPage.tsx`
- `src/i18n.ts`
- `src/context/AppDataContext.tsx` (merge + consumir flag)
- `src/pages/LibraryPage.tsx` (se filtro for na page)
- `src/utils/steamLibraryMerge.ts` (**novo**)
- `src/utils/storage.ts` + keys se novas flags

### Fase 1+

- `src-tauri/src/steam.rs` (snapshot/flags instalado)
- `src/lib/ghostboxApi.tauri.ts` + types
- `src/pages/ProfilePage.tsx`
- `src/utils/profileAchievements.ts`
- `src/types/index.ts`

---

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Library explode (500–3000 jogos) | merge lazy; cards com placeholders; filtro “só instalados” default opcional; virtualização na Fase 4 |
| Perfil Steam privado | UI clara; não falhar silent; manter scan local |
| Rate limit Steam API | worker KV cache; throttle settings; sync manual |
| Duplicatas appId | merge único por appId; testes unitários no util de merge |
| `AppDataContext` monólito | extrair só `steamLibraryMerge` + hooks finos; não reescrever context |
| Regressão play/remove | playable set continua baseado em instalado/plugin; owned-only não vira “removível” via LuaTools |
| Confusão GhostBox vs Steam owned | badges + copy; `registerSteamLibraryGame` só para owned reais (já parcialmente) |

---

## Testes manuais (checklist)

1. Sem login Steam: library = scan local; toggles conta desabilitados.
2. Login + perfil público + `showSteamGames` on: owned aparece.
3. Toggle off: owned some; instalados/GhostBox permanecem.
4. Jogo instalado + owned: um card, status instalado, horas Steam se sync on.
5. Jogo só owned: card não instalado; não quebra launch/remove.
6. Sync playtimes: horas batem com Steam.
7. Profile: totais e recent achievements; private profile message.
8. Jogar jogo: monitor local de conquista ainda funciona.
9. Trocar pasta Steam + rescan: instalados atualizam.
10. Offline após sync: snapshot owned ainda lista jogos.

## Validação automática

Após cada fase:

```powershell
npx tsc --noEmit
# eslint nos arquivos tocados, se configurado
```

Rust: `cargo check` no `src-tauri` se comandos mudarem.

---

## Métricas de sucesso

- Usuário logado vê **biblioteca Steam completa** no app com um toggle.
- Conquistas e métricas do perfil Steam **visíveis no Profile** sem sair do GhostBox.
- Aba **Ajustes → Biblioteca** controla path, o que entra na library, e o que sincroniza.
- Zero regressão: scan local, LuaTools, backups, Premium/cloud, playtime de sessão.

---

## Decisão aberta (default recomendado)

| Decisão | Recomendado |
|---------|-------------|
| Merge owned no frontend vs Rust | **Frontend** na Fase 0–1; Rust só se performance exigir |
| Default `showSteamGames` | **true** se logado, senão irrelevante |
| Default incluir não instalados | **true** (valor da feature); filtro Instalados a 1 clique |
| Cloud sync de conquistas | **não** nesta feature |
| Nova tab Settings | **não** — expandir `library` |

---

## Próximo passo de implementação

Começar pela **Fase 0**: ligar `showSteamGames` de ponta a ponta (Settings UI + merge owned → `addedLibraryGames`) reutilizando `syncSteamPlaytimes` / `SteamAccountStats.ownedPlaytimes` sem novos endpoints.
