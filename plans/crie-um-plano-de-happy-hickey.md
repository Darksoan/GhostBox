# Redesign da aba Home — estrutura, cards e tipografia

## Context

A Home (`src/pages/HomePage.tsx`, 2359 linhas + bloco `.home-*` em `src/app.scss:2628-3901`) cresceu por acréscimo. Sintomas concretos encontrados na exploração:

- **Hierarquia plana**: as 5 seções (Recomendados, Bem avaliados, Explore, Calendário, Wishlist) usam o *mesmo* título 12px uppercase cinza. Nada indica o que é destaque e o que é fila secundária. Steam e Epic ambos abrem com um bloco editorial dominante.
- **CSS duplicado 4×**: `.home-recommended__title`, `.home-explore__title`, `.home-calendar__title`, `.home-wishlist__title` são regras idênticas copiadas (`app.scss:2674, 2999, 3521, 3771`). Já existe `.eyebrow` (`app.scss:2560`) com exatamente esse estilo, não usado aqui.
- **Alinhamento inconsistente**: header do explore/calendário usa `padding-inline-start: calc(28px + 8px)`, o do wishlist usa `14px`, o do recommended usa `0`. Os títulos não formam uma coluna vertical.
- **Grid morto**: `.home-categories` é `grid-template-columns: repeat(3, 1fr)` mas o único filho é `grid-column: 1 / -1` — wrapper inerte.
- **Card com dois comportamentos conflitantes**: `.home-category-card` default esconde o título (overlay revelado no hover), `--label-below` mostra sempre. Duas linguagens de card na mesma tela.
- **Aspect ratio acidental**: `--hero-capsule` + `--label-below` combinados forçam `aspect-ratio: 1` (`app.scss:3425-3429`), então "Recomendados" mostra capas quadradas — nem capsule nem header.
- **Carrosséis sem controle**: calendário tem 3 dias e a seta só aparece com `> 3` — as setas nunca renderizam. Recomendados carrega N grupos mas só exibe `availableGroups[0]`.
- **i18n furado**: 3 dos 5 títulos são ternários inline em `HomePage.tsx:2322, 2331, 2341`, fora do `t()`.

**Resultado esperado**: Home com hierarquia clara (hero editorial estilo Epic no topo, trilhos densos estilo Steam abaixo), um único componente de header de seção, uma única linguagem de card, tipografia escalonada por importância. **Sem novos tokens** — só recombinar `--fs-*`, `--space-*`, `--radius-*`, `--surface-*` existentes. Sem mudar fetch de dados nem adicionar seções novas.

Decisões já tomadas com o usuário: referência **híbrida** (Epic no hero, Steam nos trilhos); escopo **estilo + reordenar/ajustar markup**; raios **mantidos em 2-4px** (nada de `--radius-card` novo).

---

## Passo 1 — `SectionHeader` compartilhado

Novo arquivo `src/components/ui/SectionHeader.tsx`:

```tsx
type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  level?: "hero" | "primary" | "secondary";  // default "primary"
  action?: React.ReactNode;   // slot pras setas de carrossel / "ver mais"
};
```

Markup: `<div className="section-header section-header--{level}">` com `<h2 className="section-header__title">`, `<p className="section-header__subtitle">` opcional, `<div className="section-header__action">` opcional.

SCSS novo (bloco único, substitui as 4 cópias):

| level | fonte | peso | cor | transform |
|---|---|---|---|---|
| `hero` | `--fs-600` (20px) | semibold | `--text-primary` | none |
| `primary` | `--fs-400` (14px) | semibold | `--text-primary` | none |
| `secondary` | `--fs-200` (12px) | semibold | `--text-secondary` | uppercase + `--ls-100` |

Subtitle sempre `--fs-200` / `--text-tertiary`. `secondary` reaproveita literalmente o estilo do `.eyebrow` existente — usar `@extend`/mixin em vez de recopiar.

Trocar os 4 `<h3 class="home-*__title">` por `<SectionHeader>` em `HomePage.tsx:1301-1303, 1020, 1231, 1801` e apagar as 4 regras duplicadas (`app.scss:2674, 2999, 3521, 3771`).

**Ganho de hierarquia**: hoje tudo é `--fs-200` cinza; depois o hero fica 20px branco, os trilhos 14px branco, e só o calendário/wishlist ficam no eyebrow 12px cinza.

## Passo 2 — Alinhamento de grade unificado

Em `.home-page` (`app.scss:2628`), consolidar o inset:

```scss
--home-gutter: calc(var(--space-6) + var(--home-content-inline-inset)); // 48px
```

Toda seção passa a usar `padding-inline: var(--home-content-inline-inset)` e **zero** `padding-inline-start` extra no header. As setas de carrossel saem do fluxo (`position: absolute`, sobrepostas às bordas do rail, estilo Steam/Epic) em vez de empurrar o header — assim título e primeiro card compartilham a mesma borda esquerda em todas as 5 seções.

Arquivos: `app.scss:2999-3010` (explore header), `:3521` (calendar), `:3771` (wishlist), `:2667` (recommended).

## Passo 3 — Uma linguagem de card

Colapsar os modificadores de `.home-category-card` em **duas** variantes, não quatro:

- **`--tile`** (padrão dos trilhos, estilo Steam): capa `aspect-ratio: 460/215`, `--radius-sm`, título **sempre visível** abaixo, `--fs-300` (13px) / medium / 1 linha ellipsis, altura de label fixa (não `min-height: 52px` variável — evita cards de alturas diferentes na mesma linha). Hover: `translateY(-2px)` + `--surface-option-hover` + `--shadow-2`.
- **`--portrait`** (hero, estilo Epic): capa `aspect-ratio: 3/4`, `--radius-md`, título abaixo `--fs-400` semibold, 2 linhas.

Remover: o overlay-gradiente absoluto revelado no hover (`app.scss:3460-3492`) — é a terceira linguagem e some no hover-less/touch; e a regra acidental `--hero-capsule.--label-below { aspect-ratio: 1 }` (`:3425-3429`).

Trocar a detecção por sniff de string em `HomePage.tsx:608` (`className.includes("home-category--featured")`) por uma prop explícita `variant: "tile" | "portrait"`.

## Passo 4 — Reordenar e reescalar as seções

Ordem nova em `HomePage.tsx:2303-2357`:

1. **Recomendados** → vira o bloco hero. `SectionHeader level="hero"`. Grid `repeat(4, 1fr)` com cards `--portrait` (capas 3/4 reais, não quadradas). Já tem os 4 appIds fixos em `homeRecommendedAppIdGroups` (`:135-137`) — mantém. Remover o preload dos grupos não exibidos (`:1319-1327`), já que só `availableGroups[0]` é renderizado.
2. **Bem avaliados** → `level="primary"`, grid `--tile` de 3×2 (mantém `maxGames={6}`). Achatar o wrapper morto `.home-categories` (`app.scss:3310-3322`): apagar o `grid` e o `grid-column: 1/-1`, virar um `<section>` direto.
3. **Explore por categoria** → `level="primary"`, setas absolutas (Passo 2). Mantém 5 cards por viewport.
4. **Calendário pessoal** → `level="secondary"`. Remover a lógica de setas morta (`HomePage.tsx:1193` `canScrollCalendar`) já que são 3 dias fixos; vira grid `repeat(3, 1fr)` simples, sem carrossel.
5. **Wishlist** → `level="secondary"`, com `subtitle`. Header alinhado à grade comum.

Ritmo vertical: `--home-section-gap` sobe de `clamp(26px, 2.8vw, 38px)` para `clamp(32px, 3.4vw, 48px)` entre seções; **hero** ganha gap maior abaixo (`--space-16`) pra separar destaque de trilhos. Gap header→conteúdo padroniza em `--space-6` nas 5 seções (hoje varia entre `--space-5` e `--space-6`).

## Passo 5 — i18n

Mover os 3 títulos hardcoded (`HomePage.tsx:2322, 2331, 2341`) e o botão "Ver mais"/"See more" (`:1826`) pro `src/i18n.ts`, junto de `home.recommended` / `home.featuredGames` (`i18n.ts:124-129` pt, `:469-474` en). Novas chaves: `home.exploreByCategory`, `home.personalCalendar`, `home.steamWishlist`, `home.steamWishlistSubtitle`, `home.seeMore`.

## Passo 6 — Sincronizar skeleton

`HomePageLoadingState` (`LoadingStates.tsx:338-420`) ainda renderiza `<HomeRecentBannerSkeleton />` de uma seção que não existe mais. Reescrever pra espelhar a ordem nova: 4 tiles portrait, 6 tiles, rail de explore, 3 colunas de calendário, 3 cards de wishlist. Remover `HomeRecentBannerSkeleton` se ficar sem uso.

## Passo 7 — Limpeza de CSS morto

Apagar do `app.scss`: `.home-recent-banner*`, `.home-recent-list*`, `.home-carousel*` (`:3304` e vizinhança), `.home-recommended-hero*` (`:2711-2760+`, resquício do hero antigo). Nenhum é referenciado pelo `HomePage.tsx` atual.

---

## Arquivos tocados

| Arquivo | O quê |
|---|---|
| `src/components/ui/SectionHeader.tsx` | **novo** — header compartilhado |
| `src/pages/HomePage.tsx` | reordenar seções, usar `SectionHeader`, prop `variant`, remover carrossel morto do calendário, i18n |
| `src/app.scss` (`:2628-3901`) | bloco `.home-*`: grid, cards, ritmo; apagar títulos duplicados e CSS morto |
| `src/components/ui/LoadingStates.tsx` | skeleton da Home espelhando ordem nova |
| `src/i18n.ts` | 5 chaves novas (pt + en) |

**Nenhum arquivo de token muda.** `src/styles/_primitives.scss` e `_semantic.scss` ficam intactos — a proposta usa só `--fs-200/300/400/600`, `--space-*`, `--radius-sm/md`, `--surface-secondary/option-hover`, `--shadow-2`, `--text-primary/secondary/tertiary` já existentes.

## Verificação

1. `npm run build` — roda `scripts/check-tokens.mjs` (ratchet). Nenhum hex cru novo em `app.scss`, senão a build falha.
2. `npm run tauri dev`, abrir Home:
   - Títulos das 5 seções alinhados na mesma coluna vertical com os cards.
   - Recomendados em 3/4 (não quadrado), com 3 escalas tipográficas distintas visíveis na página.
   - Todos os cards com título sempre visível; nenhum overlay aparecendo só no hover.
   - Cards da mesma linha com altura idêntica.
3. Redimensionar janela: quebras em 1100px e 640px seguem funcionando; sem scroll horizontal na página (`overflow-x: clip` no `.home-page` preservado — ver comentário em `app.scss:2647-2649`).
4. Ligar `appearance.reduceAllAnimations` (Settings) e confirmar que os hovers novos não escapam do kill-switch `html.no-animations` (`app.scss:10347`).
5. Trocar idioma pt↔en: os 5 títulos + "Ver mais" mudam.
6. Estado de loading: forçar cache miss e conferir que o skeleton tem o mesmo formato do conteúdo real (sem salto de layout).
