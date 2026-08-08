# Correções — ciclo semanal da seção "Da sua wishlist da Steam"

Auditoria da implementação de [plans/home-wishlist-cycle.md](../plans/home-wishlist-cycle.md).

## Estado da verificação

| Checagem | Resultado |
|---|---|
| `npx tsc --noEmit` | ok |
| `node scripts/check-tokens.mjs` | `check-tokens: ok.` |
| `npx vitest run` | **80 passaram, 3 falharam** |
| `npx vitest run tests/wishlist-cycle.test.ts` | 4/4 |

Das 3 falhas, **1 é da implementação** (F5) e **2 já eram vermelhas no HEAD** (ver "Pré-existentes").

---

## F1 — alta: ciclo incompleto é gravado e nunca revalida

[src/pages/HomePage.tsx:1737](../src/pages/HomePage.tsx#L1737) grava o ciclo mesmo quando `selectedGames.length < homeWishlistCycleGameCount`, mas [src/utils/wishlistCycle.ts:114](../src/utils/wishlistCycle.ts#L114) exige `gameIds.length === expectedCount` para considerar fresco. Com menos de 4 jogos, o cache **nunca** é aceito: o pipeline inteiro (~29 requests) roda em toda montagem da Home e em todo `visibilitychange`. Com 0 selecionados, `normalizeStoredSteamWishlistCycle` ainda rejeita na leitura (`gameIds.length === 0`), mesmo efeito.

```ts
// depois do fallback, antes de gravar
if (selectedGames.length < homeWishlistCycleGameCount) {
  setWishlistRecommendations(selectedGames);
  // sem writeStoredSteamWishlistCycle: um ciclo incompleto nunca passaria no
  // guard de freshness e viraria refetch em todo mount/visibilitychange.
  scheduleWishlistCycleRetry();          // ex.: 30 min, não o expiresAt do ciclo
  return;
}
```

## F2 — alta: `history` queima os 4 ciclos em regenerações da mesma semana

[src/utils/wishlistCycle.ts:215](../src/utils/wishlistCycle.ts#L215) sempre prepende a seleção nova. Toda regeneração dentro da mesma semana (F1, F9, troca de biblioteca) empurra mais uma entrada, então em 4 regenerações o histórico inteiro vira a **mesma semana** — perde a proteção dos ciclos anteriores e, ao mesmo tempo, exclui candidatos bons que acabaram de sair.

```ts
const startIso = normalizedStart.toISOString();
const previousHistory =
  storedCycle?.cycleStart === startIso
    ? (storedCycle.history ?? []).slice(1)   // substitui a entrada do próprio ciclo
    : storedCycle?.history ?? [];
const history = [gameIds, ...previousHistory].slice(0, Math.max(0, historyLimit));
```

Cobrir com um caso em `tests/wishlist-cycle.test.ts`: regenerar com o mesmo `cycleStart` mantém `history.length` e troca só o topo.

## F3 — alta: o pool de similares perde 4 das 6 fontes

[src/pages/HomePage.tsx:1688](../src/pages/HomePage.tsx#L1688) concatena os similares na ordem das fontes e corta em 16. A Steam devolve ~10+ appIds por jogo, então os 16 primeiros saem quase todos das duas primeiras fontes — as outras quatro chamadas são pagas e descartadas, e a diversidade prometida pelo plano não acontece.

Intercalar por fonte antes do corte:

```ts
const similarBySource = await Promise.all(
  sourceGames.map((game) => loadSteamSimilarAppIds(homeGameAppId(game)).catch(() => []))
);
const interleaved: string[] = [];
for (let round = 0; interleaved.length < homeWishlistSimilarPoolLimit; round += 1) {
  const before = interleaved.length;
  for (const list of similarBySource) {
    if (list[round]) interleaved.push(list[round]);
  }
  if (interleaved.length === before) break;   // todas as listas acabaram
}
const similarAppIds = [...new Set(interleaved)].slice(0, homeWishlistSimilarPoolLimit);
```

## F4 — média: sem guarda de execução concorrente

`loadWishlistCycle` é disparada por três caminhos — `runWhenIdle` ([HomePage.tsx:1754](../src/pages/HomePage.tsx#L1754)), `visibilitychange` ([HomePage.tsx:1758](../src/pages/HomePage.tsx#L1758)) e o `setTimeout` de expiração ([HomePage.tsx:1614](../src/pages/HomePage.tsx#L1614)) — sem nenhuma checagem de execução em andamento. Com F1 ativo, cada volta de foco à janela dispara outro pipeline completo por cima do anterior.

```ts
let inFlight: Promise<void> | null = null;
const runWishlistCycle = () => (inFlight ??= loadWishlistCycle().finally(() => { inFlight = null; }));
```

## F5 — média: teste quebrado pela remoção do "ver mais"

[tests/home-layout.test.ts:64](../tests/home-layout.test.ts#L64) (`keeps the terminal wishlist chevron clear of the window edge`) exige `.home-wishlist__more { margin-block-end: … }`, regra removida do [src/app.scss](../src/app.scss) junto com o botão — remoção **intencional** do plano.

```
AssertionError: the terminal chevron needs its own bottom clearance: expected undefined to be defined
```

Corrigir o teste, não o código: apagar o caso ou reapontá-lo para a folga inferior que a lista de 4 cards precisa (`.home-wishlist__list` / `.home-wishlist`). Não reintroduzir o botão.

## F6 — média: placeholders entram no pool e queimam slots

[src/pages/HomePage.tsx:1702](../src/pages/HomePage.tsx#L1702) usa `.catch(() => createWishlistFallbackGame(appId, index))`, que fabrica `Steam App <id>`. `rankWishlistCandidates` descarta esses títulos via `isSteamTitlePlaceholder` ([wishlistCycle.ts:137](../src/utils/wishlistCycle.ts#L137)) — ou seja, o item ocupa um dos 16 lugares do pool e some depois, aproximando o pipeline do fallback caro.

```ts
loadGameStoreDetails(appId).catch(() => null)
// …
).filter((game): game is GhostBoxGame => Boolean(game));
```

(O `createWishlistFallbackGame` continua correto no caminho das **fontes**, [HomePage.tsx:1678](../src/pages/HomePage.tsx#L1678), onde só interessam tags/gêneros.)

## F7 — baixa: rotação de fontes trava com wishlist múltipla de 7

[src/pages/HomePage.tsx:1671](../src/pages/HomePage.tsx#L1671): `getWishlistCycleSeed` é `YYYYMMDD`, e semanas consecutivas dentro do mesmo mês diferem em exatamente 7. Com 7 (ou 1) appIds elegíveis, `seed % newAppIds.length` dá sempre o mesmo `sourceOffset` — as mesmas fontes toda semana.

Usar índice de semana em vez da data:

```ts
export function getWishlistCycleIndex(cycleStart: Date) {
  return Math.floor(getWishlistCycleStart(cycleStart).getTime() / (7 * 24 * 60 * 60 * 1000));
}
```

## F8 — baixa: skeleton com 4 pills, card com 3

[src/components/ui/LoadingStates.tsx:242](../src/components/ui/LoadingStates.tsx#L242) renderiza 4 `__tag-skeleton`; o card real fechou em 3 tags ([HomePage.tsx:1263](../src/pages/HomePage.tsx#L1263)). Salto de layout na troca. Deixar 3.

## F9 — baixa: um jogo instalado descarta o ciclo inteiro

[src/pages/HomePage.tsx:1639](../src/pages/HomePage.tsx#L1639) só aceita o cache se os 4 sobreviverem ao filtro de biblioteca; basta o usuário instalar um deles para a semana inteira ser re-sorteada (e, com F2, consumir uma entrada de histórico). Melhor manter os sobreviventes e preencher só os slots que faltam, gravando o ciclo atualizado com o mesmo `cycleStart`.

## F10 — limpeza (pré-existente): CSS órfão

`.home-wishlist-card__short-info` ([app.scss:3473](../src/app.scss#L3473)) e `.home-wishlist-card__review` ([app.scss:3484](../src/app.scss#L3484)) não têm uso em TSX — já eram órfãos no HEAD, não vieram deste plano.

---

## Falhas de teste pré-existentes (fora do escopo do plano)

Ambas já falhavam no HEAD (`50e2274`), confirmado por `git show HEAD:<arquivo>`:

1. **`tests/home-layout.test.ts` — "lets Top rated cards show the game title without the short description"**
   `expected '…' to contain 'showTitle'`. A seção `home.featuredGames` ([HomePage.tsx:1846](../src/pages/HomePage.tsx#L1846)) passa `showMetadata` e `showSecondaryPills`, mas **não** `showTitle` — os cards de Top rated não exibem o nome do jogo, embora o comentário do componente e o teste digam que deveriam. Decidir entre passar a prop (comportamento que o teste descreve) ou atualizar o teste.

2. **`tests/typography-tokens.test.ts:120` — "keeps Home secondary copy above micro text size"**
   `expected '…' to contain '.home-wishlist-card__reason'`. A frase "Já que X está na sua lista de desejos" foi removida a pedido, e o seletor saiu do SCSS. Reapontar a asserção para outra cópia secundária da Home (ex.: `.home-wishlist-card__player-review-author`).

## O que está correto

- `getWishlistCycleStart` / `isStoredWishlistCycleFresh` / `pickWishlistCycleGames` / `createWishlistCycle` com 4 testes verdes.
- Storage migrado para `StoredSteamWishlistCycle` com `cycleStart`/`history` validados e `recommendationPairs` fora; o bump de `algorithmVersion` descarta o formato antigo pelo guard.
- Pipeline em ondas paralelas (`Promise.all` nas fontes, nos similares e nos detalhes), fallback único de `loadGames` popular, `loadWishlistRecommendationForGame` e `pickWishlistRecommendationCandidate` removidos.
- Lista com 4 cards fixos, sem estado `expanded`; card sem o carrossel de screenshots; refresh por `setTimeout` + `visibilitychange` presente (faltando só a guarda de F4).
