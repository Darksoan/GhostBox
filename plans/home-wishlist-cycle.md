# Seção "Da sua wishlist da Steam" — ciclo semanal + fluxo enxuto

## Context

A seção (`HomeWishlistRecommendations` em [src/pages/HomePage.tsx](src/pages/HomePage.tsx)) nasceu como "para cada jogo da wishlist, um jogo parecido", e a UI ainda carrega o custo dessa premissa mesmo depois de a frase "Já que X está na sua lista de desejos" ter sido removida do card:

- **Pipeline caro e serial**: até 10 jogos-fonte; para cada um, `loadSteamSimilarAppIds` + até 8 `loadGameStoreDetails`; se nada casar, até 7 `loadGames` (tag/gênero/publisher) + 1 `loadGames` popular — tudo em `for...of` com `await` ([HomePage.tsx:2066](src/pages/HomePage.tsx:2066), [HomePage.tsx:387](src/pages/HomePage.tsx:387)). Pior caso: ~150 requests em série para exibir 3 cards.
- **Dado morto**: o cache guarda `recommendationPairs` com `sourceAppId`/`sourceTitle` e a hidratação carrega os detalhes do jogo-fonte ([HomePage.tsx:1980](src/pages/HomePage.tsx:1980)) — dobro de requests para um dado que a UI não mostra mais.
- **Sem ciclagem**: o cache expira em 7 dias, mas nada reagenda; o conteúdo só muda se a Home remontar depois do vencimento. E nada impede o mesmo jogo voltar no ciclo seguinte.
- **Lista com estado supérfluo**: `expanded` + botão `.home-wishlist__more` para revelar o resto ([HomePage.tsx:1655](src/pages/HomePage.tsx:1655)).

**Resultado desejado**: 4 recomendações fixas por ciclo, trocando a cada 7 dias em data previsível, sem repetir jogo por ~4 ciclos, com uma passada de rede curta e paralela, e card/lista sem partes que não pagam o próprio custo.

## Decisões (confirmadas com o usuário)

| Item | Decisão |
|---|---|
| Cards por ciclo | 4 fixos, sem "ver mais" |
| Ciclo | 7 dias, ancorado em segunda-feira local |
| Repetição | histórico dos últimos 4 ciclos exclui candidatos |
| Escopo | pipeline + card + lista |

## 1. Novo módulo `src/utils/wishlistCycle.ts`

Espelha [src/utils/personalCalendar.ts](src/utils/personalCalendar.ts) (mesmo formato de `algorithmVersion`, `cycleStart`, `expiresAt`, freshness guard). Lógica pura, sem React e sem rede — testável.

```ts
export const wishlistCycleAlgorithmVersion = "wishlist-cycle-v1";

getWishlistCycleStart(date = new Date()): Date   // start-of-day da segunda-feira da semana
getWishlistCycleSeed(cycleStart: Date): number   // YYYYMMDD, mesmo formato de catalogueRotationSeed
isStoredWishlistCycleFresh(stored, steamId, expectedCount, now?): stored is StoredSteamWishlistCycle
rankWishlistCandidates(candidates, { sourceTraits, userTraits, excludedAppIds }): GhostBoxGame[]
pickWishlistCycleGames(candidates, { gameCount, sourceTraits, userTraits, excludedAppIds }): GhostBoxGame[]
createWishlistCycle({ steamId, selectedGames, storedCycle, cycleStart, refreshMs, historyLimit }): StoredSteamWishlistCycle
```

- `rankWishlistCandidates` é o scoring que já existe em `pickWishlistRecommendationCandidate` ([HomePage.tsx:314](src/pages/HomePage.tsx:314)) movido para cá e alterado para **devolver a lista ordenada** em vez de `[0]`. Mesmos pesos (`sourceMatch*1000 + userMatch*15 + quality*10 + popularity`).
- `pickWishlistCycleGames` escolhe `gameCount` do pool inteiro aplicando o mesmo anti-repetição de traços do calendário (`getPersonalCalendarOverlapScore`, [personalCalendar.ts:147](src/utils/personalCalendar.ts:147)) para os 4 cards não virarem quatro jogos do mesmo gênero.
- `getWishlistCycleSeed` usa a mesma forma de [src/utils/rotation.ts](src/utils/rotation.ts) e serve para escolher, de forma determinística por semana, **quais** jogos da wishlist são as fontes do ciclo (rotação também do lado das fontes, sem `Math.random`).
- `createWishlistCycle` mantém `history: string[][]` com os últimos `historyLimit` ciclos (`homeWishlistCycleHistoryLimit = 4`), o mais novo primeiro — mesmo papel de `monthGameIds` no calendário.

## 2. Storage — `src/utils/storage.ts`

Trocar `StoredSteamWishlistRecommendations` ([storage.ts:47](src/utils/storage.ts:47)) por `StoredSteamWishlistCycle`:

```ts
{ steamId, algorithmVersion, cycleStart, expiresAt, gameIds: string[], history: string[][] }
```

- **Sai** `recommendationPairs` (e o normalizador em [storage.ts:153](src/utils/storage.ts:153)) — sem a frase no card, o jogo-fonte não é mais renderizado.
- `normalizeStoredSteamWishlistCycle` valida `cycleStart`/`expiresAt` com `Date.parse` e limita `history` a 4 entradas, como o normalizador atual faz com os pares.
- Chave `steamWishlistRecommendationsStorageKey` continua a mesma; o bump de `algorithmVersion` já descarta o formato velho (o guard rejeita versão diferente).
- Manter os nomes exportados `readStoredSteamWishlistRecommendations`/`writeStoredSteamWishlistRecommendations` renomeados para `...WishlistCycle`, atualizando o import em HomePage e a lista de chaves de limpeza em [storage.ts:776](src/utils/storage.ts:776).

## 3. Pipeline — `src/pages/HomePage.tsx`

Reescrever o efeito de wishlist ([HomePage.tsx:1947](src/pages/HomePage.tsx:1947)) para uma passada curta:

1. `readStoredWishlistCycle()` → se `isStoredWishlistCycleFresh`, hidrata **só os 4 recomendados** (`Promise.all` de `loadWishlistDisplayGame`), agenda o refresh e retorna. Some o ramo duplicado `recommendationPairs` vs `gameIds`.
2. `loadSteamWishlist(steamId)` → `getUniqueWishlistAppIds` (já existe, [HomePage.tsx:184](src/pages/HomePage.tsx:184)).
3. Escolher `homeWishlistCycleSourceCount = 6` fontes por rotação determinística com `getWishlistCycleSeed` (offset = seed % total), e carregar os detalhes em **um** `Promise.all` — elimina o loop de batches sequenciais ([HomePage.tsx:2040](src/pages/HomePage.tsx:2040)) e a constante `homeWishlistDetailsBatchSize`.
4. `Promise.all` dos `loadSteamSimilarAppIds` das 6 fontes → união dos appIds, cortada em `homeWishlistSimilarPoolLimit = 16` → **um** `Promise.all` de `loadGameStoreDetails`.
5. `pickWishlistCycleGames(pool, …)` escolhe 4, excluindo biblioteca, wishlist e `history`.
6. Fallback único (só se sobrar menos de 4): **uma** chamada `loadGames({ query: "", limit: 30, sort: "popular" })` rankeada pelas tags do usuário (`loadSteamRecommendedTagsForUser`, já usada hoje). Some `loadWishlistRecommendationForGame` inteira ([HomePage.tsx:387](src/pages/HomePage.tsx:387)) com suas até 8 chamadas por fonte.
7. `createWishlistCycle` + `writeStoredWishlistCycle`.

**Refresh do ciclo** (hoje inexistente): copiar o par que o calendário pessoal já usa — `setTimeout` até `expiresAt` (`schedulePersonalCalendarRefresh`, [HomePage.tsx:1841](src/pages/HomePage.tsx:1841)) e listener de `visibilitychange` ([HomePage.tsx:1930](src/pages/HomePage.tsx:1930)). Assim a virada de semana acontece com o app aberto.

Custo de rede por ciclo: **~1 + 6 + 6 + 16 ≈ 29 requests, em 4 ondas paralelas** (contra ~150 seriais). Nos 6 dias seguintes: 4 requests de hidratação.

**Tipos e código morto a remover**: `HomeWishlistRecommendation` ([HomePage.tsx:63](src/pages/HomePage.tsx:63)) vira `GhostBoxGame[]` no estado e nas props; saem `loadWishlistRecommendationForGame`, `pickWishlistRecommendationCandidate`, `homeWishlistRecommendationSourceLimit`, `homeWishlistDetailsBatchSize`, `homeWishlistRecommendationAlgorithmVersion`, `isStoredSteamWishlistRecommendationsFresh` e `createWishlistFallbackGames` (a versão plural, se ficar sem uso).

## 4. UI — lista e card

**Lista** (`HomeWishlistRecommendations`, [HomePage.tsx:1638](src/pages/HomePage.tsx:1638)):
- Fora `expanded`, `visibleRecommendations`, `hiddenCount`, o `useEffect` que reseta o estado e o botão `.home-wishlist__more` (+ regra em app.scss).
- Renderiza os 4 do ciclo; `key` passa a ser o appId do jogo (não mais o par).
- Skeleton: 4 itens ([HomePage.tsx:1672](src/pages/HomePage.tsx:1672)).

**Card** (`HomeWishlistCardComponent`):
- Remover o carrossel de screenshots no hover: `screenshots`, `readyScreenshotIndexes`, `markScreenshotReady`, o `IntersectionObserver` de decode, o `setInterval` de 1400ms e as `<img>` escondidas ([HomePage.tsx:1403](src/pages/HomePage.tsx:1403)–[HomePage.tsx:1617](src/pages/HomePage.tsx:1617)) — ~150 linhas e 6 imagens decodificadas por card. A capa estática (`useLoadableImageCover`) e o realce de fundo no hover permanecem. **Este é o item de maior ganho e o mais visível: se o hover animado for para ficar, é só cortar esta linha do plano.**
- Mantém: capa, título, `HomeWishlistPlayerReview`, pills (reduzir de 4 para 3 tags, alinhando com o resto da Home).
- Limpar em [src/app.scss](src/app.scss) as regras órfãs (`__screenshot`, `__screenshot--active`, `home-wishlist__more`).

## 5. Testes — `tests/wishlist-cycle.test.ts`

Suíte nova em `tests/` (vitest, mesmo estilo de [tests/catalogue-rotation-seed.test.ts](tests/catalogue-rotation-seed.test.ts)), sobre o módulo puro:

- `getWishlistCycleStart` cai na mesma segunda-feira ao longo da semana e vira na seguinte.
- `isStoredWishlistCycleFresh` rejeita `algorithmVersion` antiga, `steamId` diferente, contagem errada e `expiresAt` vencido.
- `pickWishlistCycleGames` devolve exatamente 4, nunca repete appId, e ignora tudo que estiver no `history` ou nos excluídos.
- `createWishlistCycle` empurra o ciclo novo para o topo do `history` e corta em 4.

## Verificação

1. `npm run build` (roda `check:tokens` + `tsc` + vite build) e `npm test`.
2. `npm run dev` com uma conta Steam conectada: a seção mostra 4 cards, sem botão de expandir; DevTools → Network mostra a rede em ondas paralelas (contar as chamadas: dezenas, não centenas).
3. Recarregar: sem tráfego novo além das 4 hidratações (cache do ciclo em uso).
4. Virada de ciclo: no console, `JSON.parse(localStorage.getItem('<steamWishlistRecommendationsStorageKey>'))`, recuar `expiresAt` para o passado e voltar à aba (`visibilitychange`) — os 4 cards devem trocar e nenhum appId do `history` reaparecer.
5. Hover no card: fundo realça, capa fica estática, sem piscar de screenshot.
