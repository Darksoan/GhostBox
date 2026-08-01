# Catalogue Preview UX Flow

## Context

`CatalogueHoverPreview` (sidebar) shows screenshots/details for the game under the cursor in `CatalogueList`. Current behavior has four flow problems:

1. Hover-in is instant (`onPointerEnter` → `onHoverGame(game)` with no delay), so scanning the list quickly thrashes the preview panel on every row.
2. The panel mounts/unmounts based on `hoveredGame` being `null`. The CSS already defines an opacity/translateY transition on `.catalogue-hover-preview`, but it never plays because the element isn't present during the transition — it just pops in/out.
3. Screenshot autoplay swaps every 1000ms with a hard cut (`opacity: 0/1`, no `transition` on `&__screenshot`), and manual chevron navigation has the same hard cut.
4. Exit retention (`CATALOGUE_HOVER_PREVIEW_RETENTION_MS`) is 2500ms, which was covering both "give the user time to scan the list without losing the preview" and "give the user time to move the mouse into the panel." With hover-in debounce added, the first job goes away, so this can shrink to a value that only covers the second job.

## Goals

- Panel appearance/disappearance is a real, visible fade+slide transition, not a pop.
- Fast mouse movement across list rows does not thrash the preview.
- Screenshot changes (autoplay and manual) crossfade instead of cutting.
- Exit delay is short enough to feel responsive but long enough to survive the pointer's travel from a list row to the panel.

## Non-goals

- No geometric "safe zone" / trajectory prediction for the cursor path (over-engineering for a sidebar panel).
- No change to what triggers a hover (`pointerEnter`/`focus` on `catalogue-list__item` stay the trigger sources).
- No change to keyboard focus behavior (`onFocus`/`onBlur` already show/hide the panel; focus should stay instant, not debounced — debounce only applies to pointer hover-in, since keyboard nav has no "scanning" problem).

## Design

### 1. Hover-in debounce

`CataloguePage.handleHoverGame(game)`:
- On `game !== null`: don't call `setHoveredGame` immediately. Start a ~120ms timer; on fire, cancel any pending exit-retention timer and commit `setHoveredGame(game)`. If `handleHoverGame` is called again (new hover target or `null`) before the timer fires, clear it — only the last hover target within the debounce window wins.
- On `game === null`: cancel any pending entry timer, then behave as today — call `hoverPreviewRetention.scheduleClear()`.

Focus-driven hover (`onFocus` in `CatalogueList`) goes through the same `onHoverGame` callback as pointer hover today. Since keyboard nav doesn't have a "scanning" problem the same way rapid mouse movement does, and adding a perceptible delay after a deliberate Tab press would feel laggy, the entry debounce is skipped when the hover originates from focus. `CatalogueList` gains a second callback path (or a flag) so `CataloguePage` can tell focus-driven calls from pointer-driven calls and commit those immediately.

Implementation: extend `createCatalogueHoverPreviewRetention`-style helper (or a sibling helper in `cataloguePreview.ts`) with a small `createCatalogueHoverPreviewIntent` utility exposing `scheduleShow(game)`, `showImmediately(game)`, `cancel()` — mirrors the existing retention helper's shape so `CataloguePage` composes both the same way.

### 2. Mount lifecycle (real enter/exit transition)

`CataloguePage` tracks two pieces of state instead of one:
- `hoveredGame` (committed hover target, drives what the panel currently shows) — set via the debounce logic above.
- The panel component itself receives `game: hoveredGame` as before, but `CatalogueHoverPreview` stops returning `null` immediately when `game` becomes `null`.

`CatalogueHoverPreview` internally keeps a `displayedGame` ref/state that only updates to a non-null incoming `game`, plus a CSS visibility class driven by `Boolean(game)`. Sequence:
- `game` goes from `null` → `X`: `displayedGame` becomes `X` immediately, panel renders with `--hidden` class, then flips to `--visible` on next frame (so the transition actually plays) — same enter pattern already used elsewhere in the app for mount-in transitions (check `GallerySlider`/existing fade-in patterns for the established approach before inventing a new one).
- `game` goes from `X` → `null`: panel keeps rendering `displayedGame` (still `X`), switches to `--hidden` class (fade out), and after the transition duration (`var(--motion-base)`, read as a matching JS timeout constant) clears `displayedGame` so the section unmounts / stops holding stale content. If `game` becomes non-null again before that timeout fires, cancel the pending clear and swap directly to the new content (no need to fully exit first).

CSS: rename/repurpose the existing base opacity:1/translateY(0) rule into an explicit `&--visible` state and add a `&--hidden` state (opacity: 0, translateY of a few px), both transitioning on the existing `var(--motion-base) var(--ease-out)`.

### 3. Screenshot crossfade

- `.catalogue-hover-preview__screenshot` gains `transition: opacity var(--motion-base) var(--ease);` (currently only `&--active` toggles opacity with no transition).
- Autoplay interval constant moves from `1000` to `3200` ms in `CatalogueHoverPreview.tsx`.
- No change to `getNextReadyScreenshotSource` / `getAdjacentReadyScreenshotSource` logic — this is CSS + one constant, both autoplay and manual chevron clicks already flow through the same `activeScreenshotSource` state and `&--active` class, so both get the crossfade for free.
- `prefers-reduced-motion: reduce` block already zeroes out `&__screenshot` transitions — no change needed there, confirm it still covers the new transition property (it targets the whole rule via `transition: none`, so yes).

### 4. Exit retention duration

- `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` in `cataloguePreview.ts`: `2500` → `500`.
- No other logic changes — `scheduleClear`/`cancelClear` behavior stays the same, just the timing constant.

## Testing

- `cataloguePreview.ts` unit tests (new): `createCatalogueHoverPreviewIntent`-equivalent behavior — scheduled show fires after delay, cancel prevents it, a second call before firing replaces the pending target, `showImmediately` bypasses the delay.
- `CatalogueHoverPreview` component test additions: source contains the new autoplay interval constant (`3200`), contains the crossfade transition declaration, contains the visible/hidden class names.
- `app.scss` test (existing `catalogue-hover-preview.test.ts` pattern): assert `&__screenshot` rule now contains `transition:`, assert `&--visible`/`&--hidden` selectors exist.
- Existing `catalogue-hover-retention.test.ts` / `catalogue-preview-rotation.test.ts` / `catalogue-preview-controls.test.ts` updated where they assert the old `1000`/`2500` constants.

## Risks

- Debounce timing (120ms) and retention timing (500ms) are judgment calls, not derived from user research — flagged as tunable constants, easy to adjust post-review if it feels off in practice.
- Keeping `displayedGame` alive during exit means the panel briefly shows stale content (the previous game) while fading out; this is intentional (that's what makes the fade visible) but worth confirming it doesn't read as a bug during manual QA.
