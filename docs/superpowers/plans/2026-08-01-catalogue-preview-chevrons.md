# Catalogue Preview Chevrons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover/focus chevrons that manually navigate the catalogue preview screenshots while pausing autoplay during preview hover.

**Architecture:** Keep screenshot readiness and anti-flash layering inside `CatalogueHoverPreview`. Add a local paused state driven by pointer/focus entry, expose previous/next buttons over the media area, and derive navigation from the existing ready-source list. Keep retention ownership in `CataloguePage` and preserve the existing pointer callbacks used to keep the preview mounted between cards.

**Tech Stack:** React, TypeScript, Vitest, Sass, existing semantic design tokens and i18n settings.

## Global Constraints

- Use only existing semantic app tokens; do not add literal colors or a new outer border.
- Display one screenshot at a time and keep the automatic rotation at 1000 ms when not paused.
- Navigate only through screenshots that have finished loading/decoding.
- Keep the preview mounted during the existing 2500 ms retention window between cards.
- Provide localized accessible labels and keyboard activation for both controls.

---

### Task 1: Define navigation and pause behavior with tests

**Files:**
- Modify: `tests/catalogue-hover-preview.test.ts`
- Create: `tests/catalogue-preview-controls.test.ts`
- Modify: `src/utils/cataloguePreview.ts`

**Interfaces:**
- Consumes: `getNextReadyScreenshotSource(sources, readySources, currentSource)`.
- Produces: a pure helper `getAdjacentReadyScreenshotSource(sources, readySources, currentSource, direction)` where `direction` is `"previous" | "next"`, returning `string | null`.

- [ ] **Step 1: Write failing helper tests**

```ts
it("advances to the next ready screenshot and wraps", () => {
  const ready = new Set(["a", "b", "c"]);
  expect(getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "b", "next")).toBe("c");
  expect(getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "c", "next")).toBe("a");
});

it("skips unready screenshots in both directions", () => {
  const ready = new Set(["a", "c"]);
  expect(getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "a", "next")).toBe("c");
  expect(getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "c", "previous")).toBe("a");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx.cmd vitest run tests/catalogue-preview-controls.test.ts`

Expected: FAIL because the adjacent-source helper does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Add `getAdjacentReadyScreenshotSource` to `src/utils/cataloguePreview.ts`. Start from the current index, walk one position at a time in the requested direction, wrap at either end, and return the first ready source. Return the current valid source when no other ready source exists; return `null` when the list or ready set is empty.

- [ ] **Step 4: Run focused tests**

Run: `npx.cmd vitest run tests/catalogue-preview-controls.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper and tests**

```bash
git add tests/catalogue-preview-controls.test.ts src/utils/cataloguePreview.ts
git commit -m "test: define catalogue preview navigation"
```

### Task 2: Add pause state and accessible chevrons

**Files:**
- Modify: `src/components/ui/CatalogueHoverPreview.tsx`
- Modify: `tests/catalogue-preview-controls.test.ts`

**Interfaces:**
- Consumes: `getAdjacentReadyScreenshotSource`, cached screenshot sources, and existing `onPointerEnter`/`onPointerLeave` callbacks.
- Produces: preview buttons with `aria-label` text, click handlers, and pause behavior that prevents the 1000 ms interval from changing the active source while the preview is hovered or focused.

- [ ] **Step 1: Add source-level assertions for controls and pause**

Assert that the component contains previous/next buttons, localized labels for both languages, `onClick` handlers that call the adjacent-source helper, and an `isAutoplayPaused` guard around the interval callback.

- [ ] **Step 2: Run the focused test to verify the assertions fail**

Run: `npx.cmd vitest run tests/catalogue-preview-controls.test.ts`

Expected: FAIL because the component has no controls or pause guard.

- [ ] **Step 3: Implement component state and handlers**

In `CatalogueHoverPreview`:

```ts
const [isAutoplayPaused, setIsAutoplayPaused] = useState(false);
const navigateScreenshot = (direction: "previous" | "next") => {
  setActiveScreenshotSource((currentSource) =>
    getAdjacentReadyScreenshotSource(
      cachedScreenshotSources,
      readyScreenshotSourcesRef.current,
      currentSource,
      direction
    )
  );
};
```

Set pause on section `onPointerEnter` and `onFocusCapture`, clear it on `onPointerLeave` and `onBlurCapture` only when focus leaves the section. Keep the existing parent callbacks invoked in the same handlers so retention remains intact. Make the interval callback return early while paused. Render two `button` elements inside `catalogue-hover-preview__screenshots`, with `type="button"`, localized `aria-label`, and disabled state when fewer than two ready screenshots exist. Stop propagation on button pointer/click events so future card-level interactions remain isolated.

- [ ] **Step 4: Run focused tests**

Run: `npx.cmd vitest run tests/catalogue-hover-preview.test.ts tests/catalogue-preview-controls.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit component behavior**

```bash
git add src/components/ui/CatalogueHoverPreview.tsx tests/catalogue-hover-preview.test.ts tests/catalogue-preview-controls.test.ts
git commit -m "feat: add manual catalogue preview controls"
```

### Task 3: Style controls and verify the full surface

**Files:**
- Modify: `src/app.scss`
- Modify: `src/i18n.ts:75-80,428-433`
- Modify: `tests/catalogue-hover-preview.test.ts`

**Interfaces:**
- Consumes: the button class names emitted by `CatalogueHoverPreview`.
- Produces: token-based chevron affordances visible on hover/focus, adequate hit targets, reduced-motion compatibility, and translated labels.

- [ ] **Step 1: Add failing style/token assertions**

Assert that Sass defines previous/next control selectors under `.catalogue-hover-preview__screenshots`, uses semantic tokens, and contains no literal color values for the controls. Assert both locale resources contain the previous/next labels.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx.cmd vitest run tests/catalogue-hover-preview.test.ts`

Expected: FAIL until the selectors and labels are added.

- [ ] **Step 3: Implement token-based styles and labels**

Position the controls absolutely at the vertical center of the screenshot area, use existing surface/text/border/radius/shadow/spacing tokens, expose focus-visible outlines, and keep the controls visually quiet until hover/focus. Add localized `catalogue.preview.previousScreenshot` and `catalogue.preview.nextScreenshot` strings to the Portuguese and English objects in `src/i18n.ts`. Do not add an outer preview border or literal colors.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run check:tokens
npm.cmd run build
```

Expected: all commands exit 0; the build may retain the existing chunk-size warning.

- [ ] **Step 5: Commit styles and translations**

```bash
git add src/app.scss src/i18n.ts tests/catalogue-hover-preview.test.ts
git commit -m "style: add catalogue preview chevrons"
```

## Self-review checklist

- The plan covers pause-on-hover, resume-on-leave, manual previous/next navigation, readiness filtering, accessibility, token usage, and anti-flash stability.
- No task relies on an undefined helper or ambiguous direction value.
- Existing retention callbacks remain owned by `CataloguePage`; only autoplay pause is local to the preview.
