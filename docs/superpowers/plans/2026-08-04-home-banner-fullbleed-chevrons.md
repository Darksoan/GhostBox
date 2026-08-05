# Home Banner Full-Bleed + Hover Chevrons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Home tab's recommended-game hero banner span 100% of the tab's horizontal width (edge-to-edge, no side padding) and add hover-revealed prev/next chevron buttons that navigate the same carousel already driving the pagination dots.

**Architecture:** Pure CSS full-bleed via negative margin + width compensation on `.home-recommended__stage` (the existing `position: relative` wrapper), so only the banner rectangle breaks out while the section header keeps normal padding. Two new `<button>` elements added to the existing `HomeRecommendedHero` component in `src/pages/HomePage.tsx`, styled as absolute-positioned circular controls that fade in on stage hover/focus, calling the existing `setActiveIndex` state setter with wraparound math.

**Tech Stack:** React (TSX), SCSS (via `sass-embedded`), `lucide-react` icons, Vitest + postcss for CSS assertions.

## Global Constraints

- Reference spec: `docs/superpowers/specs/2026-08-04-home-banner-fullbleed-chevrons-design.md`
- Full-bleed offset must exactly cancel `var(--home-page-inline-padding)` (12px, `--space-6`) + `var(--home-content-inline-inset)` (36px) on each side — do not hardcode 48px, use the CSS custom properties so the rule stays correct if those tokens change.
- `.home-recommended__banner` loses its `border-radius` entirely (becomes `0`) once full-bleed — do not keep any rounding.
- Chevron buttons only render when `visibleGames.length > 1` (same guard as the existing pagination dots block at `src/pages/HomePage.tsx:1223`).
- Chevron icons: `ChevronLeft` / `ChevronRight` from `lucide-react` (already a project dependency — `ChevronDown` is imported from it at `src/pages/HomePage.tsx:1`).
- Chevron visibility: default `opacity: 0`, revealed via `:hover`/`:focus-within` — never `pointer-events: none` (keyboard focus must always be able to reach and use them, matching `.catalogue-hover-preview__control`'s pattern).
- New i18n keys are flat siblings under `home` in `src/i18n.ts` — `home.recommended` is an existing flat string (the section title `"Recomendados"`/`"Recommended"`), so the new labels must NOT be nested under it.
- Respect `prefers-reduced-motion: reduce` for the chevron's opacity/background transitions.
- No hex colors in new CSS — use existing custom properties (`--black`, `--text-primary`, `--focus-ring-color`, `--space-*`, `--radius-circle`, `--motion-fast`, `--ease`) exactly as the codebase already does elsewhere.

---

## File Structure

- **Modify `src/app.scss`**: full-bleed rule on `.home-recommended__stage`, `border-radius: 0` on `.home-recommended__banner`, new `.home-recommended__nav` (+ `--prev`/`--next`) rules near the existing `.home-recommended__pagination`/`.home-recommended__page` block (around line 2764-2818).
- **Modify `src/pages/HomePage.tsx`**: add `ChevronLeft`, `ChevronRight` to the existing `lucide-react` import; add the two nav buttons inside `HomeRecommendedHero`'s stage `div` (around line 1216-1252).
- **Modify `src/i18n.ts`**: add `recommendedPreviousGame` / `recommendedNextGame` string keys to both the `pt` and `en` `home` blocks (around lines 132-141 and their `en` counterpart, currently at line 491 for `recommended: "Recommended"`).
- **Modify `tests/home-layout.test.ts`**: new `it(...)` asserting the full-bleed CSS rule and the zeroed border-radius.
- **Create `tests/home-recommended-nav.test.ts`**: new test file (pattern copied from `tests/catalogue-hover-preview.test.ts`) asserting chevron selectors, reduced-motion rule, hover-reveal media query, and i18n keys/markup.

---

### Task 1: Full-bleed banner CSS

**Files:**
- Modify: `src/app.scss:2623-2649` (`.home-recommended__stage`, `.home-recommended__banner`)
- Test: `tests/home-layout.test.ts`

**Interfaces:**
- Consumes: existing custom properties `--home-page-inline-padding` (`src/app.scss:2582`, value `var(--space-6)` = 12px) and `--home-content-inline-inset` (`src/app.scss:2583`, value `36px`).
- Produces: `.home-recommended__stage` now has `margin-inline` and `width` declarations that later tasks (chevron positioning) rely on being present on the same stacking context (`position: relative` is unchanged).

- [ ] **Step 1: Write the failing test**

Add this test to `tests/home-layout.test.ts` (append as a new `it` inside the existing `describe("Home layout", ...)` block, after the last `it`):

```ts
  it("makes the recommended banner span the full tab width", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const declarations = new Map<string, Map<string, string>>();

    stylesheet.walkRules((rule) => {
      const ruleDeclarations = new Map<string, string>();
      rule.walkDecls((declaration) => {
        ruleDeclarations.set(declaration.prop, declaration.value);
      });
      const existing = declarations.get(rule.selector) ?? new Map<string, string>();
      ruleDeclarations.forEach((value, prop) => existing.set(prop, value));
      declarations.set(rule.selector, existing);
    });

    const stage = declarations.get(".home-recommended__stage");
    expect(stage?.get("margin-inline")).toBe(
      "calc(-1 * (var(--home-page-inline-padding) + var(--home-content-inline-inset)))"
    );
    expect(stage?.get("width")).toBe(
      "calc(100% + 2 * (var(--home-page-inline-padding) + var(--home-content-inline-inset)))"
    );

    const banner = declarations.get(".home-recommended__banner");
    expect(banner?.get("border-radius")).toBe("0");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/home-layout.test.ts -t "full tab width"`
Expected: FAIL — `stage?.get("margin-inline")` is `undefined`, not the expected string.

- [ ] **Step 3: Write minimal implementation**

In `src/app.scss`, replace the current `.home-recommended__stage` rule (currently just `position: relative; min-width: 0;`):

```scss
.home-recommended__stage {
  position: relative;
  min-width: 0;
  margin-inline: calc(
    -1 * (var(--home-page-inline-padding) + var(--home-content-inline-inset))
  );
  width: calc(
    100% + 2 * (var(--home-page-inline-padding) + var(--home-content-inline-inset))
  );
}
```

And in `.home-recommended__banner`, change `border-radius: var(--radius-lg);` to `border-radius: 0;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/home-layout.test.ts -t "full tab width"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.scss tests/home-layout.test.ts
git commit -m "style: make home recommended banner span full tab width"
```

---

### Task 2: i18n keys for chevron labels

**Files:**
- Modify: `src/i18n.ts` (pt `home` block ~line 132-141, en `home` block ~line 491)
- Test: `tests/home-recommended-nav.test.ts` (created in this task)

**Interfaces:**
- Produces: `t.home.recommendedPreviousGame`, `t.home.recommendedNextGame` (string), available on both locale objects — consumed by Task 3's button `aria-label`s.

- [ ] **Step 1: Write the failing test**

Create `tests/home-recommended-nav.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home recommended banner chevrons", () => {
  it("keeps chevron labels localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");

    expect(source).toContain('recommendedPreviousGame: "Jogo anterior"');
    expect(source).toContain('recommendedNextGame: "Próximo jogo"');
    expect(source).toContain('recommendedPreviousGame: "Previous game"');
    expect(source).toContain('recommendedNextGame: "Next game"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/home-recommended-nav.test.ts`
Expected: FAIL — none of the four strings exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/i18n.ts`, find the pt `home` block (around line 132-141):

```ts
    home: {
      pageAria: "Jogos recomendados e categorias da página inicial",
      recommended: "Recomendados",
      featuredGames: "Bem avaliados",
      exploreByCategory: "Explore por categoria",
      personalCalendar: "Calendário pessoal",
      steamWishlist: "Da sua wishlist da Steam",
      steamWishlistSubtitle: "Recomendações baseadas nos seus jogos desejados",
      seeMore: "Ver mais ({count})",
    },
```

Add two keys after `recommended: "Recomendados",`:

```ts
      recommended: "Recomendados",
      recommendedPreviousGame: "Jogo anterior",
      recommendedNextGame: "Próximo jogo",
```

Find the matching `en` `home` block (around line 491, `recommended: "Recommended",`) and add the same two keys there:

```ts
      recommended: "Recommended",
      recommendedPreviousGame: "Previous game",
      recommendedNextGame: "Next game",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/home-recommended-nav.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts tests/home-recommended-nav.test.ts
git commit -m "i18n: add home recommended chevron labels"
```

---

### Task 3: Chevron buttons in `HomeRecommendedHero`

**Files:**
- Modify: `src/pages/HomePage.tsx:1` (lucide-react import)
- Modify: `src/pages/HomePage.tsx:1213-1255` (`HomeRecommendedHero` return block)
- Test: `tests/home-recommended-nav.test.ts` (extended)

**Interfaces:**
- Consumes: `t.home.recommendedPreviousGame` / `t.home.recommendedNextGame` (Task 2); existing `activeIndex`/`setActiveIndex` state and `visibleGames` array already in `HomeRecommendedHero` (`src/pages/HomePage.tsx:1194`, `1190-1193`); the component's existing `language` prop (`"pt" | "en"`) is unused for these new buttons since labels come from `t.home.*` — confirm `t` is already in scope in this file (it's the module-level translation object used elsewhere for `t.home.pageAria` etc.; if `HomeRecommendedHero` doesn't currently reference `t`, import/derive it the same way the rest of `HomePage.tsx` does, e.g. via the existing `useTranslations()`/`getTranslations(language)` helper already used by sibling components — check `src/pages/HomePage.tsx` for how `language` is turned into `t` elsewhere in the file and mirror that exact call).
- Produces: `.home-recommended__nav`, `.home-recommended__nav--prev`, `.home-recommended__nav--next` CSS class names, consumed by Task 4's styling.

- [ ] **Step 1: Write the failing test**

Add to `tests/home-recommended-nav.test.ts` (new `it` inside the existing `describe`):

```ts
  it("renders prev/next chevron buttons wired to the carousel", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");

    expect(component).toContain("ChevronLeft");
    expect(component).toContain("ChevronRight");
    expect(component).toContain("home-recommended__nav--prev");
    expect(component).toContain("home-recommended__nav--next");
    expect(component).toContain(
      "setActiveIndex((i) => (i - 1 + visibleGames.length) % visibleGames.length)"
    );
    expect(component).toContain(
      "setActiveIndex((i) => (i + 1) % visibleGames.length)"
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/home-recommended-nav.test.ts -t "chevron buttons"`
Expected: FAIL — none of these strings exist in `HomePage.tsx` yet.

- [ ] **Step 3: Write minimal implementation**

First, check how `HomeRecommendedHero` currently gets translated strings — it already receives a `language: "pt" | "en"` prop and uses it for `aria-label` text directly (see the pagination `aria-label` at `src/pages/HomePage.tsx:1227-1231`, which inline-ternaries rather than using a `t` object). Follow that exact same established pattern instead of introducing a new `t` lookup — do NOT assume a `t` object is in scope.

Update the pagination-adjacent aria-label pattern for consistency and add the two buttons using inline ternaries on `language`, matching the existing style exactly:

In `src/pages/HomePage.tsx:1`, update the lucide-react import to include the two new icons:

```tsx
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
```

Then in `HomeRecommendedHero`'s return block (`src/pages/HomePage.tsx:1213-1255`), add the two buttons as siblings before the pagination `div`, inside the same `visibleGames.length > 1 ? (...) : null` guard region — but since the existing pagination is its own separate conditional block, add a second conditional block right after `<HomeRecommendedBanner ... />` and before the pagination block:

```tsx
        {visibleGames.length > 1 ? (
          <button
            type="button"
            className="home-recommended__nav home-recommended__nav--prev"
            aria-label={
              language === "en" ? "Previous game" : "Jogo anterior"
            }
            onClick={() =>
              setActiveIndex(
                (index) => (index - 1 + visibleGames.length) % visibleGames.length
              )
            }
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        {visibleGames.length > 1 ? (
          <button
            type="button"
            className="home-recommended__nav home-recommended__nav--next"
            aria-label={
              language === "en" ? "Next game" : "Próximo jogo"
            }
            onClick={() =>
              setActiveIndex((index) => (index + 1) % visibleGames.length)
            }
          >
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
```

Note: this uses the same inline `language === "en" ? ... : ...` string literals as the existing pagination `aria-label` (`src/pages/HomePage.tsx:1227-1231`) rather than `t.home.*`, since that's the actual established pattern in this component — the i18n keys added in Task 2 exist in `src/i18n.ts` for consistency/future use and are asserted by Task 2's test directly against the source file, independent of whether this component reads them through a `t` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/home-recommended-nav.test.ts`
Expected: PASS (both `it` blocks)

- [ ] **Step 5: Commit**

```bash
git add src/pages/HomePage.tsx tests/home-recommended-nav.test.ts
git commit -m "feat: add hover chevrons to home recommended banner"
```

---

### Task 4: Chevron styling (hover-reveal, reduced motion)

**Files:**
- Modify: `src/app.scss` (new rules after `.home-recommended__page` block, before `.home-explore` — around line 2818-2820)
- Test: `tests/home-recommended-nav.test.ts` (extended)

**Interfaces:**
- Consumes: `.home-recommended__nav`, `--prev`, `--next` class names from Task 3.
- Produces: final visual behavior — no further tasks depend on this.

- [ ] **Step 1: Write the failing test**

Add to `tests/home-recommended-nav.test.ts`:

```ts
  it("emits hover-reveal chevron styles with a reduced-motion fallback", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    const mediaQueries: string[] = [];

    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));
    stylesheet.walkAtRules("media", (rule) => mediaQueries.push(rule.params));

    expect(selectors).toContain(".home-recommended__nav");
    expect(selectors).toContain(".home-recommended__nav--prev");
    expect(selectors).toContain(".home-recommended__nav--next");
    expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");
    expect(mediaQueries).toContain("(hover: hover) and (pointer: fine)");

    const navRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".home-recommended__nav"
    );
    expect(navRule?.toString()).toContain("opacity: 0");
    expect(navRule?.toString()).not.toContain("pointer-events: none");
    expect(navRule?.toString()).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/home-recommended-nav.test.ts -t "hover-reveal"`
Expected: FAIL — none of these selectors/media queries exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/app.scss`, add after the existing `@media (hover: hover) and (pointer: fine) { .home-recommended__page... }` block (around line 2818, right before `.home-explore`):

```scss
.home-recommended__nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: grid;
  width: var(--space-14);
  height: var(--space-14);
  place-items: center;
  border: 0;
  border-radius: var(--radius-circle);
  background-color: color-mix(in srgb, var(--black) 40%, transparent);
  color: var(--text-primary);
  opacity: 0;
  transform: translateY(-50%);
  transition:
    opacity var(--motion-fast) var(--ease),
    background-color var(--motion-fast) var(--ease);
  cursor: pointer;

  &--prev {
    inset-inline-start: var(--space-6);
  }

  &--next {
    inset-inline-end: var(--space-6);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .home-recommended__stage:hover .home-recommended__nav {
    opacity: 1;
  }

  .home-recommended__nav:hover {
    background-color: color-mix(in srgb, var(--black) 55%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-recommended__nav {
    transition: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/home-recommended-nav.test.ts`
Expected: PASS (all `it` blocks in the file)

- [ ] **Step 5: Commit**

```bash
git add src/app.scss tests/home-recommended-nav.test.ts
git commit -m "style: reveal home recommended chevrons on hover"
```

---

### Task 5: Full-suite verification and manual check

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including all four new `it` blocks across `tests/home-layout.test.ts` and `tests/home-recommended-nav.test.ts`.

- [ ] **Step 2: Manual browser check**

Start the app's dev server per the project's existing `run` skill/dev script, open the Home tab, and verify:
- The recommended banner touches both edges of the tab at the current window width (no gap on either side), and does so at a resized/wider window too.
- Hovering the banner fades in a left and a right chevron; moving the mouse away fades them out.
- Clicking each chevron changes the active game (banner image/title update) and the matching pagination dot becomes active, wrapping correctly at both ends of the list.
- Tabbing via keyboard reaches both chevrons and shows a focus ring even without mouse hover.
- With only one recommended game available, no chevrons and no pagination dots render (existing behavior preserved).

- [ ] **Step 3: Commit (if any manual-check fixes were needed)**

```bash
git add -A
git commit -m "fix: address manual QA findings for home banner chevrons"
```

If no fixes were needed, skip this commit — Task 4's commit is the final one for this feature.
