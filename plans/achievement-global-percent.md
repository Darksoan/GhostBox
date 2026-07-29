# Corrigir "% de desbloqueio" indisponível nas conquistas do modal de jogos

## Sintoma

No `GameModal`, ao passar o mouse (ou focar) em qualquer conquista, o tooltip
mostra sempre **"Percentual global indisponível"** em vez de `12,3% dos jogadores`.
O mesmo ocorre na `GameAchievementsPage` e no showcase da `ProfilePage`.
Como efeito colateral, o realce de conquista rara
(`modal__achievement-item--rare`, `globalPercent <= 10`) nunca é aplicado.

## Diagnóstico

O campo existe no tipo e é consumido pela UI, mas **nenhuma camada do app o
produz**. É um pipeline incompleto, não um bug de renderização.

Consumidores (todos corretos):

- [GameModal.tsx:311-321](src/components/modals/GameModal.tsx:311) — formata
  `achievement.globalPercent`; cai no rótulo de indisponível quando não é `number`.
- [GameModal.tsx:298-302](src/components/modals/GameModal.tsx:298) — cálculo de raridade.
- [GameAchievementsPage.tsx:60-66](src/pages/GameAchievementsPage.tsx:60)
- [ProfilePage.tsx:271](src/pages/ProfilePage.tsx:271)
- [storage.ts:280-284](src/utils/storage.ts:280) — já sanitiza/persiste o campo.
- [steamAchievementMerge.ts:64](src/utils/steamAchievementMerge.ts:64) — já preserva no merge.

Produtores (todos ausentes):

1. **Worker** — `/steam/game-schema` só chama `GetSchemaForGame`
   ([index.ts:673-720](workers/steam-stats/src/index.ts:673)) e
   `normalizeSchemaAchievements` emite apenas
   `name/title/description/icon/iconGray`
   ([pure.mjs:29-50](workers/steam-stats/src/pure.mjs:29)). Nenhuma rota chama
   `ISteamUserStats/GetGlobalAchievementPercentagesForApp`.
2. **Rust** — `normalize_achievement` monta o JSON da conquista sem
   `globalPercent` ([catalogue.rs:843-862](src-tauri/src/catalogue.rs:843));
   `merge_game_achievement_details`
   ([lib.rs:581](src-tauri/src/lib.rs:581)) e o fallback local
   `read_local_achievement_definitions`
   ([steam_appcache.rs:243](src-tauri/src/steam_appcache.rs:243)) também não têm
   o dado (o schema binário local não contém percentuais).
3. **Front (caminho Steam account stats)** —
   `buildSteamAchievementList` ([steamAchievementMerge.ts:27-35](src/utils/steamAchievementMerge.ts:27))
   não mapeia `globalPercent`, então mesmo que o backend passe a enviá-lo por
   `SteamAccountStats`, ele seria descartado. O struct Rust
   `SteamRemoteAchievement` ([steam.rs:84-92](src-tauri/src/steam.rs:84)) também
   não tem o campo.

**Causa raiz:** `globalPercent` é opcional em `SteamAchievement`
([data.ts:19](src/data.ts:19)) e nunca é preenchido em nenhuma origem de dados.

Complicador de cache (precisa ser tratado na correção): quando `achievementList`
já existe no jogo persistido, `database_get_game_achievement_details` **não
refaz** o fetch ([catalogue.rs:1884-1906](src-tauri/src/catalogue.rs:1884)).
Listas já gravadas sem `globalPercent` continuariam sem percentual mesmo depois
do fix. Há ainda cache em memória/negativo no front
([gameCache.ts:195](src/utils/gameCache.ts:195)) e KV de 365 dias no worker.

## Estratégia

Buscar os percentuais no worker (proxy-first, como o resto da arquitetura) e
anexá-los à resposta de `/steam/game-schema`, mantendo um único round-trip no
desktop. O endpoint
`ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=<appId>` é
público (não exige chave), mas continua atrás do worker para aproveitar KV/edge
cache e o circuit breaker. Percentual muda com o tempo: cache próprio de ~24h,
separado do KV de 365 dias do schema.

Quando o worker não estiver configurado (modo offline / schema local),
`globalPercent` simplesmente fica ausente e a UI mantém o fallback atual — o
rótulo "indisponível" passa a ser exceção real, não regra.

## Passos

### 1. Worker — buscar e mesclar percentuais globais

- `workers/steam-stats/src/index.ts`:
  - `fetchGlobalAchievementPercentages(env, appId)`: chama
    `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/` via `steamJson`
    (endpoint `"global-percentages"` para métricas/circuit breaker), lê
    `achievementpercentages.achievements[] = { name, percent }` e devolve
    `Map<name, number>`.
  - Cache KV próprio `steam:v9:globalpct:<appId>` com `expirationTtl` de 24h
    (e TTL curto, ~1h, para resposta vazia).
  - Em `handleGameSchema` ([index.ts:1951](workers/steam-stats/src/index.ts:1951)),
    após resolver `achievements`, mesclar o percentual por `name` antes de
    montar o `jsonResponse`. Falha na busca de percentuais **não** pode derrubar
    a rota: `catch` → segue sem `globalPercent`.
  - `maxAge`/edge cache da rota passa a ser limitado pelo TTL dos percentuais.
- `workers/steam-stats/src/pure.mjs`:
  - `normalizeGlobalPercentages(payload)` → `Map` com `percent` numérico finito,
    clamp em `[0, 100]`.
  - `mergeGlobalPercentages(achievements, percentMap)` → mesma lista com
    `globalPercent` quando houver correspondência por `name`.
  - Exportar tipos em `pure.d.mts`.
- `workers/steam-stats/test/pure.test.mjs`: casos para payload válido, payload
  malformado/vazio, `percent` fora de faixa e nomes sem correspondência.
- `workers/steam-stats/README.md`: documentar a nova origem na linha da rota
  `/steam/game-schema` (GetSchemaForGame + GetGlobalAchievementPercentagesForApp,
  KV 365d schema / 24h percentuais).

### 2. Rust — propagar `globalPercent`

- `src-tauri/src/catalogue.rs`:
  - `normalize_achievement` ([:843](src-tauri/src/catalogue.rs:843)): ler
    `globalPercent` (e alias `percent`) como `f64` finito, clampar em `[0,100]`
    e incluir no JSON somente quando presente — nunca gravar `null`, para não
    virar `0%` na UI.
  - `merge_achievement_list` ([:996](src-tauri/src/catalogue.rs:996)): nenhuma
    mudança necessária (repassa o array inteiro), apenas confirmar.
- `src-tauri/src/lib.rs` — `merge_game_achievement_details`
  ([:581](src-tauri/src/lib.rs:581)) e `mark_local_unlocked_achievements`:
  garantir que os objetos de conquista são preservados por spread/merge e não
  reconstruídos campo a campo (auditar; corrigir se descartarem chaves extras).
- `src-tauri/src/steam.rs`: adicionar `global_percent: Option<f64>` a
  `SteamRemoteAchievement` ([:84](src-tauri/src/steam.rs:84)) para que o caminho
  de `SteamAccountStats` também carregue o dado quando o proxy o enviar.

### 3. Revalidação de dados já persistidos

- Em `database_get_game_achievement_details`
  ([catalogue.rs:1864](src-tauri/src/catalogue.rs:1864)), a condição de refetch
  deixa de ser apenas "lista vazia": refazer também quando a lista existe mas
  **nenhum** item tem `globalPercent` **e** `achievementMetadata.fetchedAt` for
  anterior ao marco do fix (ou ausente). Isso migra bases antigas uma única vez,
  sem loop de refetch em jogos que legitimamente não têm percentual (o
  `fetchedAt` novo é gravado em todo fetch).
- `src/utils/gameCache.ts`: nenhuma mudança de lógica, mas o cache em memória é
  por sessão — confirmar que o refetch acima chega ao usuário no primeiro
  reinício. Se houver versão de cache persistido em `storage.ts`, incrementá-la.

### 4. Front — não descartar o campo

- `src/utils/steamAchievementMerge.ts` — `buildSteamAchievementList`
  ([:27](src/utils/steamAchievementMerge.ts:27)): mapear
  `globalPercent: typeof a.globalPercent === "number" && Number.isFinite(...) ? ... : undefined`.
- `src/types/index.ts`: adicionar `globalPercent?: number` ao tipo de conquista
  remota do Steam.
- `src/components/modals/GameModal.tsx`: `formatAchievementPercent`
  ([:279](src/components/modals/GameModal.tsx:279)) usa `pt-BR` fixo; passar a
  respeitar `appearance.language` (`en-US` quando inglês), já que o rótulo ao
  lado já é traduzido.
- Reaproveitar a chave `i18n` existente `globalPercent`
  ([i18n.ts:171](src/i18n.ts:171) / [:688](src/i18n.ts:688)) em vez das strings
  inline de `GameModal.tsx:312-317`, alinhando com `GameAchievementsPage`.

## Verificação

1. `node --test workers/steam-stats/test/pure.test.mjs`
2. `npm run build`
3. `cargo check --manifest-path src-tauri/Cargo.toml`
4. Manual, com `GHOSTBOX_STEAM_STATS_API_URL` apontando para o worker publicado:
   - abrir o modal de um jogo com conquistas → tooltip mostra `X,X% dos jogadores`;
   - conquista desbloqueada com percentual ≤ 10% recebe o estilo `--rare`;
   - jogo cujo `achievementList` já estava persistido sem percentual passa a
     mostrar o valor após o refetch de migração;
   - sem proxy configurado (schema local), o app segue funcionando e exibe
     "Percentual global indisponível" sem erro de console;
   - trocar idioma para inglês → "of players" com formatação `en-US`.

## Riscos

- **Volume no worker**: uma chamada extra ao Steam por appId a cada 24h. Mitigado
  por KV + edge cache; a busca de percentuais é best-effort e não bloqueia a rota.
- **Correspondência por `name`**: se o schema e o endpoint de percentuais
  divergirem em algum jogo, aquelas conquistas ficam sem percentual — degradação
  silenciosa, já coberta pelo fallback atual.
- **Refetch de migração**: a condição precisa do `fetchedAt` para não refazer
  fetch em todo acesso de jogos sem percentual legítimo.
