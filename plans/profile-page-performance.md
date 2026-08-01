# Registro — Refatoração de desempenho da aba de perfil

> **Pendente e importante:** isto **não foi medido**. Não existe baseline antes/depois.
> As mudanças são justificadas por complexidade algorítmica e contagem de re-renders
> lidas no código, não por profiler. Enquanto a medição não rodar, trate o ganho como
> hipótese, não como fato.
>
> **Verificado:** `npx tsc --noEmit` limpo · `npm run build` passa (inclui `check:tokens`)
> · `npm test` 8 testes verdes (`tests/profile-performance.test.ts`, `tests/profile-sort.test.ts`).

Alvo: `src/pages/ProfilePage.tsx` e os utils de conquistas do perfil.
Sintoma relatado: entrada na aba trava/demora com biblioteca Steam grande (500+ jogos).
Código de partida: commit `347c0d0`.

Referências abaixo usam **nome de símbolo**, não número de linha — o arquivo cresceu de
2301 para 2386 linhas durante o trabalho e qualquer linha fixada aqui apodreceria.

---

## O que estava errado (estado em `347c0d0`)

**1. Pipeline de conquistas recomputava ~16x na entrada.**
`profileAchievementGames` dependia do state `localAchievementGamesByAppId`. A hidratação
local roda em lotes (`localAchievementHydrationLimit` / `localAchievementHydrationBatchSize`)
e cada lote chamava `setLocalAchievementGamesByAppId`, disparando rebuild completo do Map
mais três passadas `.map()` sobre a biblioteca inteira. A cascata (`achievementTabGames`,
`recentActivityGames`, `steamOverviewMetrics`) refazia sort e reduce completos junto.

**2. `mergeSteamAchievementsIntoGame` era O(N × M).**
Fazia `stats.achievements.find(...)` — varredura linear por jogo. 500 jogos × 500 entradas
= 250k comparações por rebuild, vezes 16 rebuilds. E chamava `buildSteamAchievementList`
duas vezes para o mesmo summary.

**3. Dois efeitos se reiniciavam a si mesmos.**
O de hidratação dependia de `localAchievementGamesByAppId`, que ele próprio setava; o
cleanup abortava o loop no meio, refiltrava e reordenava a lista de candidatos inteira e
recomeçava. O de resolução de títulos tinha o mesmo padrão com `resolvedGameTitlesByAppId`.

**4. Contadores alocavam array por chamada.**
`getProfileUnlockedAchievementCount` fazia `.filter()` e era invocado **dentro de
comparadores de sort** — O(n log n × tamanho da achievementList) por ordenação.

**5. Trabalho pesado dentro do JSX.**
Cada card de atividade filtrava, ordenava e `flatMap`ava a `achievementList` inteira em
todo render. `ProfileActivityCard` não era `memo()`, e o pai re-renderizava a cada
`setSteamLevel`, `setDiscordLink` e lote de hidratação.

**6. Trabalho de aba inativa.**
`shouldComputeOverviewData` era `!isOverviewActive || isOverviewDataReady` — verdadeiro na
aba *library*, que não consome `profileAchievementGames`.

**7. Map duplicado.** `overviewPreloadGames` repetia quase inteira a construção de
`profileAchievementGames`: mesmas quatro fontes, mesmo `getRicherAchievementGame`.

**8. Chaves de string O(n) por render.** `visibleGamesKey` e `overviewPreloadGamesKey`
faziam `.map().join("|")` sobre a lista toda a cada render, só para servir de dep.

---

## O que mudou

### Índices e contadores — `src/utils/`

- `steamAchievementMerge.ts`: novo `buildSteamAchievementIndex(stats)` devolve
  `Map<appId, SteamAchievement[]>`, memoizado num `WeakMap` chaveado pelo objeto `stats`.
  `mergeSteamAchievementsIntoGame` e `...IntoGames` aceitam o índice como terceiro
  parâmetro. `buildSteamAchievementList` roda uma vez por summary. O(N × M) → O(N).
- `profileAchievements.ts`: `getProfileUnlockedAchievementCount` conta em laço `for`,
  sem alocar array.
- `overviewSort.ts`: `sortOverviewGames` decora uma vez
  (`{ game, unlocked, total, playtime, lastPlayed }`) e ordena pelos campos cacheados.
  Mesmo tratamento em `achievementTabGames`.

### Efeitos — `ProfilePage.tsx`

- Dedupe da hidratação migrou do state para `localAchievementRequestedAppIdsRef`, e a
  resolução de títulos para `resolvedGameTitleAppIdsRef`. Os states saíram das deps, então
  os efeitos não se reiniciam mais sozinhos.
- Resultados dos lotes são acumulados e liberados em flush escalonado: lote 1 (para os
  primeiros cards pintarem cedo), depois a cada 4, mais o último. ~16 re-renders → ~5.
- Refs de "completado" (`localAchievementCompletedAppIdsRef`,
  `resolvedGameTitleCompletedAppIdsRef`) permitem o cleanup desmarcar só o que não foi
  commitado, para que um cancelamento não perca jogos permanentemente.

### Escopo e derivação

- `shouldComputeOverviewData` virou `isOverviewActive ? isOverviewDataReady : isAchievementsActive`.
- `profileGameBase` é a base única memoizada; `overviewPreloadGames` e
  `profileAchievementGames` derivam dela.
- `steamAchievementIndex` é memoizado no componente e repassado aos merges.

### Render

- `ProfileActivityCard` embrulhado em `memo()`. Funciona porque `t` é `useCallback` em
  `src/context/settings.tsx` — se isso mudar, o `memo` vira decoração inútil.
- `profileActivityViewModels` calcula fora do JSX, só para os jogos da página atual.
- `activeCollection` memoizado.
- `visibleGamesKey` / `overviewPreloadGamesKey` removidos; as deps passaram a ser os
  próprios arrays memoizados.

### IO e paint

- Banner com `decoding="async"` (era `"sync"`, que bloqueia), mantendo `fetchPriority="high"`.
- `content-visibility: auto` + `contain-intrinsic-size` em `.profile-page__activity-card`
  e `.profile-page__achievement-game`.

---

## Lições

**O limite de hidratação não pode ser cortado — a ideia original estava errada.**
O plano previa baixar `localAchievementHydrationLimit` de 80 para ~24 e carregar o resto
sob demanda. Foi aplicado e depois revertido. Motivo: os candidatos da hidratação são
filtrados por `remoteAchievementAppIds`, ou seja, são exatamente os jogos para os quais o
Steam **não** tem conquistas remotas. Sem hidratação local eles não passam por
`isRecognizedSteamProfileGame` (que exige `unlocked > 0`) e **somem da página** — não é
atraso, é perda de conteúdo. E "sob demanda por viewport" é impossível aqui: o jogo só
entra na lista *depois* de hidratado, então não há nada no viewport para observar.
O limite voltou para 80; o custo é pago por `requestIdleCallback` entre lotes e pelo flush
escalonado.

**Medir antes era a primeira etapa do plano e foi pulada.** Todo o resto foi executado sem
baseline. O plano original ainda condicionava as fases finais a "só se o profiler ainda
apontar problema" — condição nunca avaliada. Se o próximo passo for mexer mais em
desempenho aqui, medir primeiro, de verdade.

---

## Aberto

1. **Medir.** React DevTools Profiler na entrada da aba com biblioteca 500+: contar renders
   de `ProfilePage` e tempo de commit. `performance.mark` em volta de `profileGameBase`,
   `profileAchievementGames`, `achievementTabGames`, `recentActivityGames`.
   Sem isso, nada aqui está comprovado.
2. **Cobertura de teste.** Os utils puros têm testes; o comportamento dos efeitos de
   hidratação (dedupe por ref, flush escalonado, cleanup parcial) não tem nenhum, e é a
   parte mais sutil da mudança.
3. **160 chamadas IPC na entrada** (80 jogos × store + achievements) continuam de pé.
   Diagnosticado, nunca endereçado — e a saída óbvia (hidratar menos) está descartada pela
   lição acima. Precisaria de batching no lado Tauri, não no React.
