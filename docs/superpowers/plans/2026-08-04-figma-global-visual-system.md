# GhostBox Figma Global Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Figma visual language across GhostBox’s shared shell and every primary page while preserving existing data, navigation, and behavior.

**Architecture:** Keep the current React + SCSS architecture. Normalize visual decisions in `_semantic.scss` and `_primitives.scss`, apply shell geometry in `app.scss`, then tune existing page/component blocks instead of replacing page logic. Use CSS grid/flex/clamp for responsive interpolation and extend focused layout tests for the Figma reference viewport and smaller widths.

**Tech Stack:** React 18, TypeScript, Vite, SCSS (`sass-embedded`), Vitest, Tauri shell.

## Global Constraints

- Use Figma file `Lk5FI99Y53MYTNi0MUhUdu`, frame `15:3` as the visual reference.
- Treat 1920 × 1080 measurements as proportional reference values, never as required fixed dimensions.
- Preserve APIs, persistence, navigation, loading behavior, collections, achievements, account, and subscription behavior.
- Reuse existing components and semantic tokens; do not add Tailwind or a second styling system.
- Preserve the user’s pre-existing working-tree changes; commits must include only files intentionally changed by the implementation.
- Keep keyboard focus, reduced-motion behavior, accessible names, and non-hover access to essential information.

---

### Task 1: Lock visual tokens to the Figma surface hierarchy

**Files:**
- Modify: `src/styles/_semantic.scss` (surface, radius, spacing, shell geometry tokens)
- Modify: `src/styles/_primitives.scss` (only if a missing primitive is required)
- Test: `tests/home-layout.test.ts`

**Interfaces:**
- Consumes: existing `--n-*`, `--space-*`, `--radius-*`, and motion primitives.
- Produces: semantic tokens for canvas, sidebar, panel, selected option, media radius, and content gutter that all page styles can consume.

- [ ] **Step 1: Add failing assertions for the global visual contract**

  Extend the existing stylesheet test with assertions equivalent to:

  ```ts
  expect(customProperties.get("--surface-canvas")).toBe("#101010");
  expect(customProperties.get("--surface-sidebar")).toBe("#0a0a0a");
  expect(customProperties.get("--surface-pill")).toBe("#151515");
  expect(customProperties.get("--sidebar-option-selected")).toBe("#202020");
  expect(customProperties.get("--radius-media")).toBe("23px");
  expect(customProperties.get("--layout-content-gutter")).toBe("clamp(24px, 2.19vw, 42px)");
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL because `--radius-media` and `--layout-content-gutter` do not yet exist.

- [ ] **Step 3: Implement the minimum semantic token additions**

  Add these declarations to `src/styles/_semantic.scss`:

  ```scss
  --radius-media: 23px;
  --layout-sidebar-width: clamp(280px, 20.833vw, 400px);
  --layout-content-gutter: clamp(24px, 2.1875vw, 42px);
  --layout-content-max: 1440px;
  ```

  Keep existing aliases such as `--surface-pill`, `--sidebar-option-selected`, and `--surface-canvas` intact; update aliases only when they currently point to a conflicting visual role.

- [ ] **Step 4: Run focused tests and token verification**

  Run: `npm test -- tests/home-layout.test.ts` and `npm run check:tokens`

  Expected: PASS with no token policy violations.

- [ ] **Step 5: Commit only token/test changes**

  ```bash
  git add src/styles/_semantic.scss src/styles/_primitives.scss tests/home-layout.test.ts
  git commit -m "feat: align semantic tokens with Figma surfaces"
  ```

### Task 2: Apply responsive Figma geometry to the application shell

**Files:**
- Modify: `src/app.scss` (shell, sidebar/content geometry, titlebar and scrollbar surfaces)
- Modify: `src/components/layout/Sidebar.tsx` only if a semantic class or landmark is required
- Test: `tests/home-layout.test.ts`

**Interfaces:**
- Consumes: `--layout-sidebar-width`, `--layout-content-gutter`, and surface tokens from Task 1.
- Produces: a shell where the sidebar scales toward 400 px at 1920 px and page content scales toward the Figma 42 px gutter.

- [ ] **Step 1: Add failing shell geometry assertions**

  Assert that `.sidebar` uses `var(--layout-sidebar-width)`, `.container__content` uses `var(--layout-content-gutter)` for inline padding, and `.app-main` remains on `var(--app-gradient)` or the equivalent canvas gradient.

- [ ] **Step 2: Run the focused test and verify the geometry assertions fail**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL for the new sidebar width and content gutter assertions.

- [ ] **Step 3: Implement shell geometry without changing navigation behavior**

  Update the existing shell rules so the sidebar width is `var(--layout-sidebar-width)`, the content viewport has `padding-inline: var(--layout-content-gutter)`, and the content max width is applied through a wrapper-safe rule or `max-width`/`margin-inline` combination that does not constrain full-width pages unexpectedly. Keep overflow ownership on `.container__content` and retain all existing modal-open modifiers.

- [ ] **Step 4: Add responsive overrides for narrow windows**

  At the existing narrow-window breakpoint, reduce the sidebar to its current compact behavior and set content gutter to `var(--space-10)` or smaller. Do not add absolute positioning or a fixed 1920 px width.

- [ ] **Step 5: Run shell tests and build**

  Run: `npm test -- tests/home-layout.test.ts` and `npm run build`

  Expected: PASS; TypeScript, token checks, and Vite build complete successfully.

- [ ] **Step 6: Commit shell changes**

  ```bash
  git add src/app.scss src/components/layout/Sidebar.tsx tests/home-layout.test.ts
  git commit -m "feat: make app shell follow Figma geometry"
  ```

### Task 3: Tune shared cards, pills, headers, and loading states

**Files:**
- Modify: `src/app.scss` (shared card/header/pill/skeleton blocks and responsive media rules)
- Modify: `src/components/ui/SectionHeader.tsx` only if markup needs an accessible shared wrapper
- Modify: relevant card components under `src/components/ui/`
- Test: `tests/home-layout.test.ts` and existing component tests where selectors are already covered

**Interfaces:**
- Consumes: shared semantic tokens and shell geometry.
- Produces: reusable Figma-like surfaces for every page without altering game data or click/context-menu callbacks.

- [ ] **Step 1: Add failing selector assertions for shared surfaces**

  Assert that game covers and Home media use `var(--radius-media)`, metadata pills use `var(--surface-pill)` with transparent borders, and skeletons preserve the final card geometry.

- [ ] **Step 2: Run focused tests and verify failures**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL for any selector still using the old radius or a visible border.

- [ ] **Step 3: Update shared CSS using semantic tokens**

  Replace duplicated card/media radius values with `var(--radius-media)`, keep card backgrounds on the correct surface tier, remove decorative borders where contrast already separates the surface, and retain explicit `:focus-visible` outlines. Ensure pills use `display: inline-flex`, fixed minimum height, and no shrink when metadata wraps.

- [ ] **Step 4: Keep skeleton dimensions stable**

  Match skeleton `min-height`, media aspect ratio, and metadata row height to their loaded equivalents. Use the existing pulse animation and reduced-motion override; do not introduce a new animation library.

- [ ] **Step 5: Run all existing tests**

  Run: `npm test`

  Expected: PASS with no selector regressions.

- [ ] **Step 6: Commit shared component styling**

  ```bash
  git add src/app.scss src/components/ui tests/home-layout.test.ts
  git commit -m "feat: unify shared cards and controls with Figma surfaces"
  ```

### Task 4: Bring Home composition to the selected Figma frame

**Files:**
- Modify: `src/pages/HomePage.tsx` (only markup/class structure needed for layout)
- Modify: `src/app.scss` (Home hero, category, calendar, wishlist layout blocks)
- Test: `tests/home-layout.test.ts` and existing Home tests

**Interfaces:**
- Consumes: shared cards and shell from Tasks 2–3.
- Produces: Home hero and card groups aligned to the frame at 1920 × 1080, with responsive groups and intact actions.

- [ ] **Step 1: Add or tighten failing Home geometry assertions**

  Assert that `.home-recommended` has no inline page padding, `.home-recommended__banner` uses the shared media radius, hero arrows are transparent 28 px controls, featured cards use the shared card padding/radius, and wishlist cards share the same media surface.

- [ ] **Step 2: Run Home tests and confirm any new assertion fails**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL only for rules not yet aligned with the selected frame.

- [ ] **Step 3: Update Home layout and classes**

  Keep `HomeRecommendedHero`, `HomeCategorySection`, `HomeExploreCategories`, `HomePersonalCalendar`, and `HomeWishlistRecommendations` as the data/behavior boundaries. Adjust only wrappers, grid tracks, gaps, banner/card proportions, and class names needed to make the hero full-width within the content gutter and keep the card groups responsive.

- [ ] **Step 4: Verify Home interactions remain unchanged**

  Run: `npm test -- tests/home-layout.test.ts tests/catalogue-preview-controls.test.ts tests/catalogue-hover-preview.test.ts`

  Expected: PASS; no navigation, context-menu, carousel, or metadata behavior changes.

- [ ] **Step 5: Commit Home adjustments**

  ```bash
  git add src/pages/HomePage.tsx src/app.scss tests/home-layout.test.ts
  git commit -m "feat: align Home composition with Figma frame"
  ```

### Task 5: Adapt page-level panels and grids to the global system

**Files:**
- Modify: `src/pages/LibraryPage.tsx`, `src/pages/FavoritesPage.tsx`, `src/pages/CataloguePage.tsx`
- Modify: `src/pages/ProfilePage.tsx`, `src/pages/GameAchievementsPage.tsx`
- Modify: `src/pages/NotificationsPage.tsx`, `src/pages/SettingsPage.tsx`
- Modify: `src/app.scss`
- Test: existing page layout tests plus focused assertions added to `tests/home-layout.test.ts` only when a shared rule is involved

**Interfaces:**
- Consumes: shared shell, card, panel, pill, and header contracts from Tasks 2–4.
- Produces: page-specific layout adaptations that preserve each page’s current data and interaction model.

- [ ] **Step 1: Inventory page selectors before editing**

  Use `rg -n` for each page root and its major panel/grid class. Record the current selectors in the implementation diff and avoid introducing a duplicate page root.

- [ ] **Step 2: Add focused failing assertions for shared page roles**

  Assert that page roots inherit the canvas, major panels use `var(--surface-panel)`/`var(--surface-raised)`, selected controls use `var(--surface-option-active)`, and page media uses `var(--radius-media)`.

- [ ] **Step 3: Update each page in small, independently testable groups**

  For Library/Favorites/Catalogue, adjust grid columns, filters, previews, and result cards. For Profile/Achievements, adjust stat panels, progress, and activity cards. For Notifications/Settings, adjust rows, forms, plan cards, and section navigation. Reuse existing classes and tokens; do not move API calls or state logic.

- [ ] **Step 4: Add responsive page rules**

  Reuse existing media queries; collapse grids by available width and reduce padding/gaps with existing spacing tokens. Confirm long titles and controls remain reachable without horizontal scrolling.

- [ ] **Step 5: Run page test suite and build**

  Run: `npm test` and `npm run build`

  Expected: PASS across all existing tests and a successful production build.

- [ ] **Step 6: Commit page-level adaptations**

  ```bash
  git add src/pages src/app.scss tests
  git commit -m "feat: apply global visual system across app pages"
  ```

### Task 6: Visual and regression verification

**Files:**
- Modify: only tests or CSS files if verification exposes a concrete regression
- Test: `tests/typography-tokens.test.ts`, `tests/home-layout.test.ts`, all existing Vitest suites

**Interfaces:**
- Consumes: completed implementation from Tasks 1–5.
- Produces: verified build and a concise diff review confirming no unrelated files were changed.

- [ ] **Step 1: Run the full automated suite**

  Run: `npm test`

  Expected: all tests pass.

- [ ] **Step 2: Run the production build and token check**

  Run: `npm run build`

  Expected: `check:tokens`, `tsc`, and Vite build all pass.

- [ ] **Step 3: Inspect the reference viewport**

  Run: `npm run dev -- --host 127.0.0.1`; open the app at a 1920 × 1080 viewport and compare the Home sidebar/content gutter, hero, featured cards, and pills against Figma frame `15:3`.

  Expected: hierarchy, surfaces, radii, and spacing match the Figma reference without fixed-frame overflow.

- [ ] **Step 4: Inspect a narrow viewport**

  Use the smallest supported app viewport and check Home, Library, Catalogue, Profile, Notifications, and Settings.

  Expected: no horizontal overflow; controls, cards, modal actions, and keyboard focus remain usable.

- [ ] **Step 5: Review the final diff and working tree**

  Run: `git status --short` and `git diff --stat HEAD~5..HEAD`

  Expected: only intentional implementation/spec files are committed; unrelated pre-existing changes remain uncommitted and untouched.

- [ ] **Step 6: Commit any verification-only fixes**

  ```bash
  git add src/app.scss tests/home-layout.test.ts
  git commit -m "fix: resolve visual regression checks"
  ```
