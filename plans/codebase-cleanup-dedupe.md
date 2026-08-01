# Limpeza e dedupe do codebase

## Context

O app funciona, mas cresceu por acréscimo: `app.scss` tem 13.623 linhas com blocos de declaração repetidos, há um `.css` compilado versionado que ninguém importa, 28 exports sem consumidor, e uma chamada de hook com 14 props duplicada em 6 arquivos. Nada disso quebra nada hoje — o custo é que cada mudança futura exige achar e editar N cópias, e foi exatamente esse o problema no redesign da Home (4 cópias idênticas da regra de título de seção).

Objetivo: reduzir superfície duplicada e remover código morto **sem mudar comportamento visível**. Cada etapa é independente e verificável isoladamente.

Números levantados nesta revisão (medidos, não estimados):

| Área | Achado |
|---|---|
| `src/app.css` | 13.323 linhas versionadas, **importado por nenhum arquivo** — artefato de build do `app.scss` |
| `app.scss` | 21 seletores de topo declarados 2-3x; ~6 receitas de declaração repetidas 4-6x |
| Exports TS | 28 exports sem nenhum consumidor |
| `useCollectionContextMenu` | 6 call sites repetindo o mesmo bloco de ~14 props |
| `sidecars/steamkit-poc/` | 53 arquivos versionados, órfãos desde `7ada651` |
| Rust | `cargo check` limpo, zero warnings — nada a fazer |

Ordem proposta: do mais seguro/mecânico para o que exige julgamento.

---

## Etapa 1 — Artefatos versionados que não deveriam estar (risco zero)

**`src/app.css`** — 13.323 linhas. `App.tsx:22` importa `./app.scss`; o `.css` não é referenciado por nenhum `import`, pelo `index.html` nem pelo `vite.config.ts`. É uma cópia compilada e **já desatualizada** do SCSS. Apagar e adicionar `src/app.css` ao `.gitignore`.

**`sidecars/steamkit-poc/`** — 53 arquivos C#. A integração foi removida em `7ada651` ("Remove CDN download functionality and SteamKit sidecar integration"). A única menção restante no app é um comentário em [storage.ts:809](src/utils/storage.ts:809) citando `SteamKitPocRunner`, que não existe mais. Apagar o diretório e corrigir o comentário.

**`nul`** (335 KB na raiz) — lixo de redirecionamento Windows (`> nul`). Já está no `.gitignore`, então é só apagar localmente.

**`design-tokens-x-com.json`** (28 KB) — tokens importados do X/Twitter, sem nenhuma referência no código. Confirmar com você antes de apagar: pode ser material de referência intencional.

Deixar de fora: `vendor/tao-0.35.3/` está em uso (`src-tauri/Cargo.toml:43`) e `sidecars/depotdownloader-mod/` é trabalho em andamento não versionado.

## Etapa 2 — Documentação que mente

`DESIGN_TOKENS.md` documenta tokens que não existem mais: `--background: #0b0b0b` (hoje `--n-1` = `#101010`), `--spacing: 8px` (substituído pela escala `--space-*`), `--text-primary: #f0f0f0` (hoje `#d6d6d6`), `--accent: #8b5cf6` e `--xp-color` (não existem). Um doc errado é pior que doc nenhum — quem seguir ele escreve código que o `check-tokens` rejeita.

Regenerar a partir de `src/styles/_primitives.scss` e `_semantic.scss`, ou reduzir o arquivo a um ponteiro para eles. Preferir a segunda: os SCSS já são a fonte da verdade e têm comentários explicando as regras.

## Etapa 3 — Exports mortos

28 exports sem consumidor. Concentrados em:

- `utils/image.ts` — 8 (`gameMainCapsuleSources`, `preloadGameHeroCapsuleSources`, `preloadGameHeaderSources`, `preloadGameHeaderOnlySources`, `preloadGameHeroSources`, `preloadGameLogoSources`, `preloadGameListAssetsReady`, `getImageFromCache`)
- `utils/imageCache.ts` — 4 (a API de status de capa: `getGameCoverStatusVersion`, `subscribeGameCoverStatus`, `isGameCoverFailed`, `isGameCoverAvailable`)
- `utils/storage.ts` — 3, `utils/steamLibraryMerge.ts` — 2, `utils/steamAssetManifest.ts` — 2, `constants/catalogue.ts` — 3, `queries/games.ts` — 2, e mais 4 avulsos

**Verificar caso a caso antes de apagar** — a busca foi por identificador, então não pega acesso dinâmico nem uso só em teste. Os de `imageCache.ts` formam uma API coerente de subscription: se a intenção era usá-la, o certo é ligar, não apagar. Tratar cada um como decisão consciente, não varrer em lote.

Depois de apagar, alguns imports internos e helpers privados ficam sem uso — a passagem tem que ser iterativa até `tsc --noEmit` ficar limpo.

## Etapa 4 — Dedupe do `app.scss`

**4a. Seletores declarados duas vezes.** 21 casos, entre eles `.header` (3x), `.settings-page`, `.home-explore`, `.home-calendar`, `.home-wishlist`, `.home-category-card__cover`, `.status-pill`, `.pagination-controls`. Alguns são intencionais (um bloco de `contain-intrinsic-size` separado do bloco de layout), outros são acidentes onde o segundo bloco silenciosamente sobrescreve o primeiro. Fundir cada par e verificar no CSS compilado que a cascata final não mudou.

**4b. Receitas repetidas — promover a mixin.** As mais frequentes:

| Repetições | Receita | Destino |
|---|---|---|
| 6x | `border: 0; border-radius: --radius-sm; background: transparent; color: --text-secondary; cursor: pointer` | `@mixin ghost-button` |
| 4x | `color: --text-secondary; font-size: --fs-200; font-weight: semibold; letter-spacing: --ls-100; text-transform: uppercase` | `.eyebrow` **já existe** (`app.scss:2540`) — trocar as cópias por `@extend` |
| 3x | `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` | `@mixin truncate` |
| 4x | `display: flex; box-sizing: border-box; width: 100%; min-width: 0; flex-direction: column` | `@mixin section-column` |

`_mixins.scss` já é o lugar canônico (tem `focus-ring`, `type-*`, `media-depth`) e o próprio arquivo declara que certas definições são "a única definição no app" — seguir esse padrão.

**4c. `ProfilePage.scss`** tem 3.468 linhas e não foi analisado nesta passagem. Rodar a mesma medição nele antes de decidir escopo.

## Etapa 5 — `useCollectionContextMenu`: 6 call sites idênticos

Os 6 consumidores (`Sidebar.tsx:140`, `CataloguePage.tsx:500`, `FavoritesPage.tsx:193`, `HomePage.tsx:2204`, `LibraryPage.tsx:218`, `ProfilePage.tsx:1763`) repetem o mesmo bloco de ~14 props, quase todas vindas do mesmo lugar (`AppDataContext`) e passadas por prop drilling.

Abordagem: um hook fino `useGameContextMenu({ game, ...overrides })` que lê de `AppDataContext` o que hoje é repassado à mão (`favoriteGameIds`, `libraryGameAppIds`, `removableGameAppIds`, `playableGameAppIds`, `addingGameId`, `launchingGameId`, `userCollections` e os callbacks `onAddGame`/`onPlayGame`/`onRemoveGame`/`onToggleFavorite`/`onAddGameToCollection`/`onRemoveGameFromCollection`), deixando só as diferenças reais por call site (`onOpenGame`, `directFavoriteAction`, `onlyCollectionActions`, `excludeCollectionId`).

`useCollectionContextMenu` continua existindo com a assinatura explícita atual — o hook novo é só o wrapper que injeta o contexto. Isso mantém o hook testável sem provider.

Migrar **um call site por commit**, começando por `FavoritesPage` (o mais simples), conferindo o menu de contexto na tela a cada passo.

## Etapa 6 — Skeletons duplicados

`ProfilePage.tsx:2136` reimplementa inline o mesmo skeleton de activity card que existe em `LoadingStates.tsx:438`. Mover para `LoadingStates.tsx`, que já é o módulo canônico de estados de carregamento.

Vale checar de passagem se os outros skeletons inline nas páginas têm equivalente lá — a Home tinha esse problema e foi resolvido extraindo `SectionHeaderSkeleton`.

---

## Fora de escopo

- **Rust**: `cargo check` passa sem um único warning. Não mexer.
- **Arquivos grandes** (`ProfilePage.tsx` 2.386, `HomePage.tsx` 2.278, `AppDataContext.tsx` 2.107): quebrar em módulos é refactor de arquitetura, não dedupe. Merece plano próprio se você quiser.
- **`app.scss` como arquivo único de 13k linhas**: dividir por feature é a mesma discussão acima.

## Verificação

Por etapa, não no fim:

1. `npm run build` — inclui o ratchet `scripts/check-tokens.mjs`, que falha se a contagem de violações de token subir em qualquer arquivo.
2. `npx tsc --noEmit` — obrigatório depois das etapas 3, 5 e 6.
3. `npx vitest run` — `tests/profile-sort.test.ts` e `tests/profile-performance.test.ts` cobrem a ProfilePage, tocada nas etapas 4c e 6.
4. Depois da etapa 4, diffar o CSS compilado (`dist/assets/index-*.css`) antes/depois: fundir seletores duplicados **não pode** mudar a cascata final. É a única verificação que pega regressão de estilo sem abrir o app.
5. `npm run tauri dev` ao fim das etapas 5 e 6: abrir menu de contexto em cada uma das 6 telas e forçar os estados de loading.

Commits pequenos, um por sub-item — a etapa 4 em particular é fácil de fundir errado, e um commit por seletor torna o bisect trivial.
