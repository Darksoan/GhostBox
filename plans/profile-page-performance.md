# Plano — Desempenho da aba de perfil

Alvo: `src/pages/ProfilePage.tsx` (2301 linhas) e utils de conquistas.
Sintoma: entrada na aba trava/demora, especialmente com biblioteca Steam grande (500+ jogos).

---

## Diagnóstico

### 1. Pipeline de conquistas recomputa ~16x na entrada
`src/pages/ProfilePage.tsx:934` — `profileAchievementGames` depende de
`localAchievementGamesByAppId`. A hidratação local roda em 16 lotes
(`localAchievementHydrationLimit` 80 / `localAchievementHydrationBatchSize` 5) e cada lote
chama `setLocalAchievementGamesByAppId`, disparando rebuild completo do Map + 3 passadas
`.map()` sobre a biblioteca inteira.

Cascata a jusante, tudo refeito por lote:
- `achievementTabGames` (`ProfilePage.tsx:1269`) — sort completo
- `recentActivityGames` (`ProfilePage.tsx:1310`) — `sortOverviewGames`
- `steamOverviewMetrics` (`ProfilePage.tsx:1315`) — reduce completo

### 2. `mergeSteamAchievementsIntoGame` é O(N x M)
`src/utils/steamAchievementMerge.ts:112` — `stats.achievements.find(...)` é varredura linear
por jogo. 500 jogos x 500 entradas = 250k comparações por rebuild, multiplicado por 16 rebuilds.
Além disso `buildSteamAchievementList(summary)` é chamada **duas vezes** (linhas 116 e 117)
para o mesmo summary.

### 3. Efeitos que se reiniciam a si mesmos
- `ProfilePage.tsx:1004-1138` — o efeito de hidratação depende de
  `localAchievementGamesByAppId`, que ele próprio seta. O cleanup marca `cancelled = true`,
  aborta o loop no meio, refiltra + reordena a lista completa de candidatos e recomeça.
- `ProfilePage.tsx:1451-1491` — mesmo padrão: depende de `resolvedGameTitlesByAppId`,
  que ele próprio seta.

### 4. Contadores alocam array por chamada
`src/utils/profileAchievements.ts:9` — `getProfileUnlockedAchievementCount` faz `.filter()`
(novo array a cada chamada) e é invocado **dentro de comparadores de sort**:
`ProfilePage.tsx:1272` e `src/utils/overviewSort.ts:64`.
Custo: O(n log n x tamanho da achievementList) por ordenação.

### 5. Trabalho pesado dentro do JSX
`ProfilePage.tsx:1963-1995` — cada card de atividade filtra + ordena + `flatMap` a
`achievementList` inteira (pode passar de 500 itens) em **todo render**.
`ProfileActivityCard` não é `memo()`, e o pai re-renderiza a cada `setSteamLevel`,
`setDiscordLink` e lote de hidratação.

### 6. Trabalho de aba inativa
`ProfilePage.tsx:780` — `shouldComputeOverviewData = !isOverviewActive || isOverviewDataReady`.
Na aba **library** isso é `true`, então todo o pipeline de conquistas roda mesmo sem a aba usá-lo
(`getGamesForCollection` só usa `profileAchievementGames` no caso `"achievements"`).

### 7. Map duplicado
`ProfilePage.tsx:811` (`overviewPreloadGames`) repete quase a mesma construção de
`ProfilePage.tsx:934` (`profileAchievementGames`): mesmas 4 fontes, mesmo
`getRicherAchievementGame`, mesmo filtro de reconhecimento.

### 8. 160 chamadas IPC na entrada
80 jogos x (`loadGameAchievementDetailsCached` + `loadGameStoreDetailsCached`).

---

## Fases

### Fase 0 — Medir (obrigatório antes de mexer)
- React DevTools Profiler: gravar entrada na aba perfil; contar renders de `ProfilePage`
  e tempo de commit.
- `performance.mark` / `measure` em volta dos useMemo em 803, 811, 934, 1269, 1310.
- Baseline com biblioteca grande (500+ jogos): tempo até o primeiro card pintado.
- Sem baseline não há como provar ganho — não pular.

### Fase 1 — Indexar lookups O(N x M) → O(N)
Maior ganho, menor risco.

1. `src/utils/steamAchievementMerge.ts`: adicionar
   `buildSteamAchievementIndex(stats): Map<appId, SteamAchievement[]>`, memoizada por
   `steamAccountStats`. `mergeSteamAchievementsIntoGame(s)` passa a receber o índice.
   Chamar `buildSteamAchievementList` **uma** vez, não duas.
2. `src/utils/profileAchievements.ts`: reescrever `getProfileUnlockedAchievementCount`
   com laço `for` contando, sem `.filter()`.
3. Sorts com Schwartzian transform: decorar uma vez
   `{ game, unlocked, total, playtime, lastPlayed }` e ordenar pelos campos cacheados.
   Aplicar em `ProfilePage.tsx:1269` e em `sortOverviewGames`.

### Fase 2 — Parar os efeitos de se auto-reiniciarem
1. Hidratação local: mover o dedupe de `localAchievementGamesByAppId` (state) para
   `useRef<Set<string>>`; remover o state das deps. O efeito passa a rodar uma vez por
   mudança real de biblioteca, não 16x.
2. Mesmo tratamento no efeito de títulos (`ProfilePage.tsx:1451`): ref com os appIds já
   pedidos, remover `resolvedGameTitlesByAppId` das deps.
3. Acumular resultados dos lotes e fazer **um** `setState` no fim (ou a cada 4 lotes),
   em vez de 16.

### Fase 3 — Cortar trabalho de aba inativa
1. `shouldComputeOverviewData = isOverviewActive ? isOverviewDataReady : isAchievementsActive`.
2. Unificar `overviewPreloadGames` e `profileAchievementGames` numa base comum memoizada
   (`profileGameBase`) e derivar as duas variantes dela.

### Fase 4 — Render
1. `memo()` em `ProfileActivityCard`. Verificar se `t` (de `useSettings`) é referencialmente
   estável; se não for, puxar de ref.
2. Mover o cálculo de `latestAchievements` / `statusLabel` do JSX para um `useMemo` que
   produz view-models prontos apenas dos 8 jogos paginados.
3. Memoizar `activeCollection` (`ProfilePage.tsx:762`).
4. Remover `visibleGamesKey` e `overviewPreloadGamesKey` (join de string O(n) por render) —
   usar contagem + primeiro/último id, ou o próprio array memoizado como dep.

### Fase 5 — IO e paint
1. Reduzir `localAchievementHydrationLimit` de 80 para ~24 iniciais; o resto sob demanda
   (paginação / IntersectionObserver).
2. Banner (`ProfilePage.tsx:1658`): `decoding="sync"` + `loading="eager"` bloqueia.
   Manter `fetchPriority="high"`, trocar `decoding` para `"async"`.
3. `content-visibility: auto` + `contain-intrinsic-size` em
   `.profile-page__achievement-game` e `.profile-page__activity-card` —
   `ProfilePage.scss` tem 32 ocorrências de blur / box-shadow / animation, o paint pesa.

---

## Ordem e expectativa

Fases 1 e 2 devem entregar ~80% do ganho. Fase 3 é barata e segura.
Fases 4 e 5 só se o profiler ainda apontar problema depois.
Remedir ao fim de cada fase contra o baseline da Fase 0.
