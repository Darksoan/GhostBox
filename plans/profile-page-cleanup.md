# Plano — Limpeza da aba de perfil

**Objetivo:** eliminar redundâncias e reduzir `src/pages/ProfilePage.tsx` (2386 linhas).
**Não é um plano de desempenho.** Não há problema de lentidão relatado; a refatoração
estrutural anterior está registrada em [profile-page-performance.md](profile-page-performance.md).

Código de partida: working tree sobre `347c0d0`.

## Decisões já travadas

| Decisão | Escolha |
|---|---|
| Escopo | Dedupe + extrair componentes. Sem quebrar o componente principal em hooks. |
| Semântica de conquista desbloqueada | **Lenient**: `unlocked === true \|\| Boolean(unlockedAt)` |
| Destino dos componentes | `src/components/profile/` (pasta nova por domínio) |
| Sequência | Dedupe primeiro (etapa 1), extração depois (etapa 2). Commits separados. |

Alvo: `ProfilePage.tsx` de 2386 para ~1700 linhas.

---

## Estado atual — o que foi confirmado no código

### Contagem de conquistas: 3 semânticas diferentes, 7 implementações

| Onde | Predicado | Semântica |
|---|---|---|
| `utils/profileAchievements.ts:5` `isProfileAchievementUnlocked` | `unlocked === true` | estrita |
| `utils/gameCardData.ts:6` (privada) | `unlocked === true` | estrita |
| `components/ui/GameCard.tsx:110` (inline) | `unlocked === true` | estrita |
| `pages/GameAchievementsPage.tsx:12` | `unlocked === true` | estrita |
| `utils/storage.ts:286` (normalização) | `unlocked === true` | estrita |
| `utils/steamAchievementMerge.ts:21` `calculateAchievementStats` | `unlocked` (truthy) | **truthy** |
| `lib/profileHistoryGames.ts:51` `countUnlockedAchievements` | `unlocked === true \|\| Boolean(unlockedAt)` | **lenient** |

O mesmo jogo pode reportar contagens diferentes conforme o caminho que percorreu.

### Três funções duplicadas inteiras, não só o predicado

`utils/gameCardData.ts` tem cópias privadas de `getUnlockedAchievementCount`,
`getAchievementTotal` e `getRicherAchievementGame` que replicam
`getProfileUnlockedAchievementCount`, `getProfileAchievementTotal` e
`getRicherProfileAchievementGame` de `utils/profileAchievements.ts`.

Diferença real entre as duas versões de `getRicher*`: a de `profileAchievements` aceita
`current` indefinido e aplica preferência de título (`preferProfileGameTitle`); a de
`gameCardData` não faz nenhum dos dois. Não são intercambiáveis hoje — a unificação
precisa preservar os dois comportamentos via parâmetro.

### Redundâncias no componente

- **`mergeProfileGameCardData`** (`ProfilePage.tsx:617`) é wrapper de uma linha em volta
  de `mergeGameCardData`, sem nada além da chamada.
- **`gamesById` faz merge duplo** (`ProfilePage.tsx:948`): itera
  `enrichedAddedLibraryGames` / `enrichedFavoriteGames`, que já foram merged com
  `enrichedGameByAppId` em `:924` e `:936`, e aplica `mergeProfileGameCardData` com o
  mesmo `enrichedGameByAppId` de novo.
- **Ramos `"favorites"` transitórios** em `getGamesForCollection` e `visibleGames`:
  `profileCollections` só contém `overview`, `library` e `achievements`. O id
  `"favorites"` só chega via navegação da sidebar e é zerado para `"overview"` pelo efeito
  em `:1180` no render seguinte. Alcançável por um render — não é código morto provado.

### Componentes embutidos candidatos à extração

| Componente | Linhas | Dependências externas |
|---|---|---|
| `ProfileActivityCard` | 104–273 (~170) | `useCachedImageSources`, `useLoadableImageCover`, `getGameAppId`, `gameSteamHeaderFirstSources`, `layeredImageStyle`, `preloadGameListAssets`, `formatCompactPlaytime`, `Cup`, `CupStar`, `getGamePlaytime`, `emptyImageSources`, tipo `ProfileAchievementHighlight` |
| `LoadedProfileAchievementGameIcon` | 276–288 | `useGameIconUrl` |
| `ProfileAchievementGameIcon` | 291–323 | nenhuma (só React) |
| `ProfileAchievementCardRow` | 326–484 (~160) | nenhuma (refs + DOM puro) |

Total extraível: ~530 linhas.

---

## Etapa 1 — Dedupe (só lógica, sem mover componentes)

Toda a etapa vive em `src/utils/` e `src/lib/`. Funções puras, cobertas por vitest.

### 1.1 Criar `src/utils/achievementStats.ts`

Fonte única de verdade. Exporta:

```ts
isAchievementUnlocked(achievement)          // canônico: lenient
getUnlockedAchievementCount(game)
getAchievementTotal(game)
getRicherAchievementGame(current, incoming, options?)
```

`options.preferNonPlaceholderTitle` (default `false`) liga o comportamento de
preferência de título que hoje só existe em `getRicherProfileAchievementGame`. Sem a
flag, o retorno é idêntico ao de `gameCardData`.

O módulo não deve importar nada além de tipos e `steamTitles` (só quando a flag de título
estiver ligada). Verificar que isso não cria ciclo com `gameCardData`.

**Testes** (`tests/achievement-stats.test.ts`), antes da migração dos chamadores:
- predicado aceita `unlocked: true`; aceita `unlockedAt` sem `unlocked`; rejeita ambos ausentes
- contagem usa o máximo entre lista explícita e `achievements.unlocked`
- total usa o máximo entre `achievementList.length`, `achievements.total` e desbloqueadas
- `getRicherAchievementGame` com e sem `preferNonPlaceholderTitle`, e com `current` indefinido

### 1.2 Migrar os 7 chamadores

Um commit por arquivo, para bisect limpo:

1. `utils/gameCardData.ts` — apagar as três privadas, importar do novo módulo.
   `mergeGameCardData` passa a chamar `getRicherAchievementGame(game, details)` sem flag.
2. `utils/profileAchievements.ts` — manter só o que é específico do perfil
   (`isSteamSoftwareLikeGame`, `isRecognizedSteamProfileGame`). As três funções de
   conquista saem; os nomes antigos viram re-export fino para não estourar os imports de
   `ProfilePage.tsx` e `overviewSort.ts` nesta etapa.
3. `lib/profileHistoryGames.ts` — `countUnlockedAchievements` vira alias de
   `getUnlockedAchievementCount`. Como o canônico agora é lenient, **o comportamento aqui
   não muda**; muda nos outros seis.
4. `utils/steamAchievementMerge.ts` — `calculateAchievementStats` passa a usar
   `isAchievementUnlocked`. **Isto muda comportamento**: `unlocked` truthy → lenient.
5. `components/ui/GameCard.tsx:110` — trocar o inline pelo import.
6. `pages/GameAchievementsPage.tsx:12` — idem.
7. `utils/storage.ts:286` — **avaliar caso a caso.** Aqui é *normalização de persistência*,
   não leitura. Gravar `unlocked: true` porque existe `unlockedAt` altera o que vai pro
   disco e é irreversível para dados já salvos. Recomendação: **não migrar**, e deixar um
   comentário dizendo por quê.

### 1.3 Limpar o componente

- Apagar `mergeProfileGameCardData` (`ProfilePage.tsx:617`); usar `mergeGameCardData` direto.
- Corrigir o merge duplo em `gamesById`: iterar as listas já enriquecidas **sem** reaplicar
  `enrichedGameByAppId`. O mapa passa a ser só `id → jogo já enriquecido`.
- Ramos `"favorites"`: **não remover nesta etapa.** Antes, inverter a ordem — fazer o efeito
  de `:1180` normalizar o id *antes* do primeiro render que usa `visibleGames`
  (derivar `activeCollection` de um id já validado). Só depois o ramo vira inalcançável de
  fato e pode sair. Se isso ficar complexo, adiar para plano próprio.

### Verificação da etapa 1

```bash
npm test && npx tsc --noEmit && npm run build
```

Mais uma passada manual: abrir perfil e conferir que as contagens de conquista batem com
o Steam em 2–3 jogos conhecidos, incluindo um vindo de backup.

---

## Etapa 2 — Extrair componentes

Puramente mecânica. Nenhuma alteração de lógica no mesmo commit.

### 2.1 Criar `src/components/profile/`

| Arquivo novo | Conteúdo |
|---|---|
| `ProfileActivityCard.tsx` | o componente + `emptyImageSources` + `getGamePlaytime` |
| `ProfileAchievementGameIcon.tsx` | os dois componentes de ícone (o lazy e o carregado) |
| `ProfileAchievementCardRow.tsx` | o componente + a lógica de scrollbar custom |
| `types.ts` | `ProfileAchievementHighlight`, `ProfileActivityViewModel` |

`getGamePlaytime` é usado tanto pelo card quanto pelo componente principal — deve morar em
`types.ts` não, mas num `src/components/profile/playtime.ts` ou voltar para `utils/`.
Decidir na hora: se só esses dois usam, `src/utils/` é o lugar certo.

### 2.2 Ordem

Um componente por commit, do mais isolado para o mais acoplado:

1. `ProfileAchievementCardRow` — zero dependências externas, é o mais seguro
2. `ProfileAchievementGameIcon` — só `useGameIconUrl`
3. `ProfileActivityCard` — o mais acoplado, por último

Após cada um: `npx tsc --noEmit`.

### 2.3 SCSS

**Fora de escopo.** `ProfilePage.scss` (3451 linhas) continua monolítico. Dividir junto
dobraria a superfície de risco sem ganho para o objetivo declarado. Fica registrado como
trabalho futuro.

### Verificação da etapa 2

```bash
npx tsc --noEmit && npm run build
```

**Lacuna conhecida:** não há `@testing-library/react` no projeto, então não há teste
automatizado de componente. A etapa 2 depende de typecheck, build e verificação visual
manual: aba visão geral (cards de atividade, hover, progresso), aba conquistas (ícones,
scroll horizontal com arraste da barra, expandir/recolher).

Se essa lacuna incomodar, instalar `@testing-library/react` + `jsdom` é um pré-requisito
separado — decidir antes de começar a etapa 2, não no meio.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Lenient infla contagens se algum payload gravar `unlockedAt` lixo | Conferência manual contra o Steam antes de fechar a etapa 1 |
| `steamAchievementMerge` muda de truthy para lenient e afeta o catálogo inteiro, não só o perfil | É o passo 1.2.4, isolado em commit próprio e revertível sozinho |
| Unificar `getRicherAchievementGame` quebra o merge de cards fora do perfil | A flag `preferNonPlaceholderTitle` preserva os dois comportamentos; testar os dois |
| Ciclo de import entre `achievementStats` e `gameCardData` | `achievementStats` só importa tipos; verificar com o build |
| Extração quebra estilo por classe CSS perdida | As classes viajam junto no JSX; `ProfilePage.scss` não muda |

## Fora de escopo

- Dividir `ProfilePage.scss`
- Quebrar o componente principal em hooks (`useProfileGames`, `useAchievementHydration`)
- Reduzir as ~30 props de `ProfilePageProps`
- As ~160 requisições HTTP na entrada da aba (ver o registro de desempenho)
- `HomePage.tsx` (72.7K, mesmo padrão de componentes embutidos)
