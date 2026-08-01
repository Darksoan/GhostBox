# Catalogue Hover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir um painel fixo de preview abaixo do filtro “Ano” ao passar o mouse ou focar um jogo do catálogo, com screenshots, título, desenvolvedora e publisher.

**Architecture:** `CataloguePage` mantém o jogo ativo e o repassa para `CatalogueHoverPreview`, renderizado após as seções de filtros. `CatalogueListItem` apenas emite mudanças de hover/foco; o novo componente resolve/cacheia até três screenshots e apresenta os dados sem controlar navegação ou abrir modais.

**Tech Stack:** React 18 + TypeScript, Sass (`src/app.scss`), tokens semânticos em `_semantic.scss`/`_primitives.scss`, Vitest.

## Global Constraints

- Usar exclusivamente tokens semânticos existentes para cor, espaço, tipografia, raio, sombra e motion.
- Não criar uma nova fonte de URLs de imagens; usar `game.screenshots` e `withoutHeaderImageSources`.
- O painel não captura cliques e o clique no item continua abrindo o modal completo.
- Hover e foco via teclado devem produzir o mesmo preview.
- Sem screenshots válidas, mostrar mídia neutra e manter os detalhes textuais.
- Respeitar `prefers-reduced-motion`.

---

### Task 1: Travar o contrato visual e de acessibilidade com testes

**Files:**
- Create: `tests/catalogue-hover-preview.test.ts`
- Test target after implementation: `src/components/ui/CatalogueHoverPreview.tsx`, `src/app.scss`, `src/i18n.ts`

**Interfaces:**
- Consumes: selectors/classes and translation keys defined by Tasks 2–4.
- Produces: executable checks that fail before the implementation and guard the panel’s token-only styling and semantic labels.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Catalogue hover preview", () => {
  it("emits the preview selectors and reduced-motion rule", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    const mediaQueries: string[] = [];
    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));
    stylesheet.walkAtRules("media", (rule) => mediaQueries.push(rule.params));

    expect(selectors).toContain(".catalogue-hover-preview");
    expect(selectors).toContain(".catalogue-hover-preview__screenshots");
    expect(selectors).toContain(".catalogue-hover-preview__screenshot");
    expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");
  });

  it("keeps preview copy localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");
    expect(source).toContain('preview: {');
    expect(source).toContain('developer: "Desenvolvedora"');
    expect(source).toContain('publisher: "Publicadora"');
    expect(source).toContain('developer: "Developer"');
    expect(source).toContain('publisher: "Publisher"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalogue-hover-preview.test.ts`

Expected: FAIL because the preview selectors and `catalogue.preview` translations do not exist yet.

### Task 2: Build the presentational preview component

**Files:**
- Create: `src/components/ui/CatalogueHoverPreview.tsx`

**Interfaces:**
- Consumes: `GhostBoxGame`, `useSettings`, `useCachedImageSources`, and `withoutHeaderImageSources`.
- Produces: `CatalogueHoverPreview({ game }: { game: GhostBoxGame | null })`.

- [ ] **Step 1: Add the component contract and early empty state**

```tsx
interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
}

export function CatalogueHoverPreview({ game }: CatalogueHoverPreviewProps) {
  if (!game) return null;
  // render selected game below
}
```

- [ ] **Step 2: Resolve the media list from existing game sources**

Use `useMemo` to derive `withoutHeaderImageSources(game.screenshots ?? []).slice(0, 3)`, pass that list to `useCachedImageSources`, and render each resolved source as a lazy, async `<img>`. Do not synthesize Steam URLs or use cover/hero fallbacks.

- [ ] **Step 3: Render details and localized labels**

Use `useSettings()` for `t` and language. Render the title in an `aria-live="polite"` details region, then render the first developer and publisher values if present, using `t("catalogue.preview.developer")` and `t("catalogue.preview.publisher")`; omit a missing line rather than displaying invented data. Each screenshot alt must be `Screenshot N de {title}` in Portuguese or `Screenshot N of {title}` in English.

- [ ] **Step 4: Run the type check**

Run: `npx tsc --noEmit`

Expected: PASS for the isolated component (styles may still be absent).

### Task 3: Connect list hover/focus to page state

**Files:**
- Modify: `src/components/ui/CatalogueList.tsx`
- Modify: `src/pages/CataloguePage.tsx`

**Interfaces:**
- Consumes: `onHoverGame: (game: GhostBoxGame | null) => void` from the page.
- Produces: one selected game state in `CataloguePage` and a rendered `CatalogueHoverPreview` immediately after `catalogue-filters__sections`.

- [ ] **Step 1: Extend `CatalogueListItemProps` and event wiring**

Add `onHoverGame` and call it from `onPointerEnter`, `onPointerLeave`, `onFocus`, and `onBlur`. Keep the existing preload calls in `onPointerEnter`/`onFocus`; use `onPointerLeave`/`onBlur` only to clear the selection.

- [ ] **Step 2: Thread the callback through `CatalogueList`**

Add the prop to `CatalogueListProps` and pass it to every `CatalogueListItem` without local state or list-level effects.

- [ ] **Step 3: Own the selected game in `CataloguePage`**

Add `const [hoveredGame, setHoveredGame] = useState<GhostBoxGame | null>(null);`, pass `onHoverGame={setHoveredGame}` to `CatalogueList`, and render `<CatalogueHoverPreview game={hoveredGame} />` directly after the filters sections. Reset the state in an effect keyed by `displayedPage` and `visibleGamesCacheKey` so pagination/refetch cannot retain a stale item.

- [ ] **Step 4: Run TypeScript and existing catalogue tests**

Run: `npx tsc --noEmit; npx vitest run tests/catalogue-layout.test.ts tests/catalogue-hover-preview.test.ts`

Expected: TypeScript passes; the new CSS/translation test remains red until Tasks 4–5 land.

### Task 4: Add translations and token-based styles

**Files:**
- Modify: `src/i18n.ts: catalogue.preview` in both Portuguese and English dictionaries
- Modify: `src/app.scss` near the catalogue filter/list rules

**Interfaces:**
- Consumes: the class names emitted by `CatalogueHoverPreview` and the `catalogue.preview.*` keys consumed by it.
- Produces: responsive, non-interactive panel styling using only semantic variables.

- [ ] **Step 1: Add localized preview labels**

Add these exact entries to both locale dictionaries:

```ts
preview: {
  developer: "Desenvolvedora", // English: "Developer"
  publisher: "Publicadora",   // English: "Publisher"
}
```

- [ ] **Step 2: Implement the panel layout**

Style `.catalogue-hover-preview` as a non-positioned column with `overflow: hidden`, semantic surface/border/radius/shadow tokens, and a short opacity/transform transition. Use a two-column screenshot strip on desktop (`grid-template-columns: repeat(2, minmax(0, 1fr))`), let the first screenshot span two columns when there is only one, and keep each image in a fixed-ratio letterbox using `--surface-media-letterbox`. Details use existing type/spacing tokens and ellipsis for long title/company names.

- [ ] **Step 3: Add responsive and reduced-motion rules**

At the existing `max-width: 1200px` breakpoint, keep the panel in normal document flow below the filter sections. Add `@media (prefers-reduced-motion: reduce)` to set transition duration to `0s` for the panel and screenshot opacity.

- [ ] **Step 4: Run token and Sass tests**

Run: `npm run check:tokens; npx vitest run tests/catalogue-layout.test.ts tests/catalogue-hover-preview.test.ts`

Expected: PASS with no literal color/spacing values rejected by the token checker.

### Task 5: Verify the full feature and commit implementation

**Files:**
- Modify: files from Tasks 2–4 only
- Test: `tests/catalogue-hover-preview.test.ts`, `tests/catalogue-layout.test.ts`, full Vitest suite

**Interfaces:**
- Consumes: completed preview component, page/list wiring, translations, and styles.
- Produces: verified feature ready for manual hover/focus review.

- [ ] **Step 1: Run the complete verification suite**

Run: `npm run check:tokens; npx tsc --noEmit; npm test`

Expected: all commands exit 0.

- [ ] **Step 2: Perform manual interaction checks**

Open the catalogue and verify: moving across games swaps the panel; tab focus shows the same panel; click still opens `GameModal`; a game with no screenshots still shows title/company details; collapsing “Ano” leaves the panel below it; narrowing below 1200px keeps the panel in flow; reduced-motion removes transitions.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/components/ui/CatalogueHoverPreview.tsx src/components/ui/CatalogueList.tsx src/pages/CataloguePage.tsx src/app.scss src/i18n.ts tests/catalogue-hover-preview.test.ts
git commit -m "feat: add catalogue hover game preview"
```
