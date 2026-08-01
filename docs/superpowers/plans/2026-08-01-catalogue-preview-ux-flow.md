# Catalogue Preview UX Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four UX flow gaps in the catalogue hover preview: hover-in thrash while scanning the list, an instant pop instead of an animated enter/exit, hard-cut screenshot swaps, and an overlong exit-retention delay.

**Architecture:** Two new small timer-based helpers in `src/utils/cataloguePreview.ts` (hover-in intent debounce, exit-transition constant) drive state changes in `CataloguePage.tsx` (hover commit timing) and `CatalogueHoverPreview.tsx` (mount lifecycle + screenshot crossfade). No new files; existing module boundaries are kept.

**Tech Stack:** React (function components, hooks), TypeScript, SCSS (BEM-style nesting already established in `app.scss`), Vitest for tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-catalogue-preview-ux-flow-design.md`
- Hover-in debounce delay: 120ms (spec §1).
- Exit retention delay: 500ms, replacing 2500ms (spec §4).
- Screenshot autoplay interval: 3200ms, replacing 1000ms (spec §3).
- Panel enter/exit transition duration must match `var(--motion-base)` = 180ms (`src/styles/_primitives.scss:104`).
- Focus-driven hover (keyboard nav) must NOT be debounced — only pointer hover-in is debounced (spec, Non-goals).
- No geometric safe-zone/trajectory tracking (spec, Non-goals).

---

## File Structure

- `src/utils/cataloguePreview.ts` — add `createCatalogueHoverPreviewIntent` (hover-in debounce helper), `CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS`, `CATALOGUE_PREVIEW_EXIT_TRANSITION_MS`; change `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` from 2500 to 500.
- `src/components/ui/CatalogueList.tsx` — `onHoverGame` callback gains an `options?: { immediate?: boolean }` second parameter; the `onFocus` handler passes `{ immediate: true }`.
- `src/pages/CataloguePage.tsx` — `handleHoverGame` composes the new intent helper with the existing retention helper.
- `src/components/ui/CatalogueHoverPreview.tsx` — internal `displayedGame`/`isVisible` state so the panel stays mounted during exit and gets a real two-frame enter transition; autoplay interval constant swap; screenshot crossfade CSS hook (no JS change needed beyond removing the old inline hard-cut assumption).
- `src/app.scss` — `.catalogue-hover-preview` gains explicit `&--visible`/`&--hidden` modifier classes (replacing the always-on base rule); `&__screenshot` gains an opacity transition.
- `tests/catalogue-hover-retention.test.ts` — update constant assertion (2500 → 500), if present.
- `tests/catalogue-preview-controls.test.ts` — add coverage for the new intent helper.
- `tests/catalogue-preview-rotation.test.ts` — update autoplay interval assertion (1000 → 3200), if present.
- `tests/catalogue-hover-preview.test.ts` — add coverage for the new CSS selectors/transition and the visible/hidden classnames.

---

## Task 1: Hover-in intent debounce helper

**Files:**
- Modify: `src/utils/cataloguePreview.ts:1-2` (constants section, top of file)
- Test: `tests/catalogue-preview-controls.test.ts`

**Interfaces:**
- Produces: `CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS: number`, `createCatalogueHoverPreviewIntent<T>(onShow: (target: T) => void, delayMs?: number): { scheduleShow(target: T): void; showImmediately(target: T): void; cancel(): void; dispose(): void }`

- [ ] **Step 1: Write the failing tests**

Add to `tests/catalogue-preview-controls.test.ts` (new `describe` block, place after the existing imports — add `vi` to the vitest import):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCatalogueHoverPreviewIntent,
  getAdjacentReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../src/utils/cataloguePreview";
```

```ts
describe("catalogue preview hover intent debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the target after the delay elapses", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    expect(onShow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);
    expect(onShow).toHaveBeenCalledWith("game-a");
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("replaces a pending target when scheduled again before it fires", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    vi.advanceTimersByTime(60);
    intent.scheduleShow("game-b");
    vi.advanceTimersByTime(120);

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("game-b");
  });

  it("cancel prevents a pending target from firing", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.cancel();
    vi.advanceTimersByTime(200);

    expect(onShow).not.toHaveBeenCalled();
  });

  it("showImmediately bypasses the delay and cancels any pending target", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.showImmediately("game-b");

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("game-b");

    vi.advanceTimersByTime(200);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels any pending target", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.dispose();
    vi.advanceTimersByTime(200);

    expect(onShow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalogue-preview-controls.test.ts`
Expected: FAIL — `createCatalogueHoverPreviewIntent` is not exported from `../src/utils/cataloguePreview`.

- [ ] **Step 3: Implement the helper**

In `src/utils/cataloguePreview.ts`, add near the top (after the existing `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` export, before `createCatalogueHoverPreviewRetention`):

```ts
export const CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS = 120;

/**
 * Debounces committing a hover target so scanning the list quickly (pointer
 * crossing many rows) doesn't thrash the preview panel. Callers pass the same
 * target repeatedly (once per rescheduled row); only the last one within the
 * delay window fires.
 */
export function createCatalogueHoverPreviewIntent<T>(
  onShow: (target: T) => void,
  delayMs = CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  return {
    scheduleShow(target: T) {
      cancel();
      timeoutId = setTimeout(() => {
        timeoutId = null;
        onShow(target);
      }, delayMs);
    },
    showImmediately(target: T) {
      cancel();
      onShow(target);
    },
    cancel,
    dispose() {
      cancel();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/catalogue-preview-controls.test.ts`
Expected: PASS (all tests in the file, including the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/utils/cataloguePreview.ts tests/catalogue-preview-controls.test.ts
git commit -m "feat: debounce catalogue preview hover-in intent"
```

---

## Task 2: Exit transition constant + shrink retention delay

**Files:**
- Modify: `src/utils/cataloguePreview.ts:1`
- Test: `tests/catalogue-hover-retention.test.ts`

**Interfaces:**
- Produces: `CATALOGUE_PREVIEW_EXIT_TRANSITION_MS: number` (180)
- Modifies: `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` value changes from `2500` to `500` (name/signature unchanged, consumed by `createCatalogueHoverPreviewRetention` in `CataloguePage.tsx` exactly as before)

`tests/catalogue-hover-retention.test.ts` already asserts behavior purely through the exported `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` constant (`vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_RETENTION_MS - 1)`, etc.) — no hardcoded `2500` literal exists there, so those tests need no edits and will keep passing once the constant changes. Add one explicit assertion so the 500ms value itself is pinned and a future accidental change is caught:

- [ ] **Step 1: Write the failing assertion**

Add to `tests/catalogue-hover-retention.test.ts`, as a new `it` inside the existing `describe` block:

```ts
  it("uses a 500ms retention delay", () => {
    expect(CATALOGUE_HOVER_PREVIEW_RETENTION_MS).toBe(500);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/catalogue-hover-retention.test.ts`
Expected: FAIL — constant is still `2500`.

- [ ] **Step 3: Update the constant and add the new one**

In `src/utils/cataloguePreview.ts`, change:

```ts
export const CATALOGUE_HOVER_PREVIEW_RETENTION_MS = 2500;
```

to:

```ts
export const CATALOGUE_HOVER_PREVIEW_RETENTION_MS = 500;
```

Add directly below the `CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS` constant added in Task 1:

```ts
// Matches --motion-base in src/styles/_primitives.scss so the panel's DOM
// content lives exactly as long as its fade-out transition.
export const CATALOGUE_PREVIEW_EXIT_TRANSITION_MS = 180;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/catalogue-hover-retention.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/cataloguePreview.ts tests/catalogue-hover-retention.test.ts
git commit -m "fix: shrink catalogue preview exit retention to 500ms"
```

---

## Task 3: Wire hover-in debounce into CatalogueList and CataloguePage

**Files:**
- Modify: `src/components/ui/CatalogueList.tsx:27,39,171-185`
- Modify: `src/pages/CataloguePage.tsx:338-467`

**Interfaces:**
- Consumes: `createCatalogueHoverPreviewIntent`, `CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS` from Task 1; `createCatalogueHoverPreviewRetention`, `CATALOGUE_HOVER_PREVIEW_RETENTION_MS` (unchanged shape, new value from Task 2)
- Produces: `CatalogueListItemProps.onHoverGame: (game: GhostBoxGame | null, options?: { immediate?: boolean }) => void` — consumed by Task 4's `CatalogueHoverPreview` wiring indirectly through `CataloguePage`'s `hoveredGame` state (no direct prop change to `CatalogueHoverPreview`).

- [ ] **Step 1: Update `CatalogueListItemProps` and call sites in `CatalogueList.tsx`**

In `src/components/ui/CatalogueList.tsx`, change the prop type (line 27):

```ts
  onHoverGame: (game: GhostBoxGame | null) => void;
```

to:

```ts
  onHoverGame: (game: GhostBoxGame | null, options?: { immediate?: boolean }) => void;
```

Change the `onFocus` handler (lines 171-174) from:

```tsx
      onFocus={() => {
        onPreloadGame(game);
        onHoverGame(game);
      }}
```

to:

```tsx
      onFocus={() => {
        onPreloadGame(game);
        onHoverGame(game, { immediate: true });
      }}
```

Leave `onBlur` (175-179), `onPointerEnter` (181-184), and `onPointerLeave` (185) unchanged — pointer entry stays debounced by default, and both exit paths (`onHoverGame(null)`) don't need the `immediate` flag since the null path has no debounce to begin with (see Task 3 Step 2).

The second usage site, `CatalogueGridItemProps`/wherever `onHoverGame` is threaded through as a plain pass-down prop (search for other `onHoverGame:` type declarations in this same file — there is one more interface around line 255 wrapping the list container), needs the same type update:

```ts
  onHoverGame: (game: GhostBoxGame | null) => void;
```

→

```ts
  onHoverGame: (game: GhostBoxGame | null, options?: { immediate?: boolean }) => void;
```

That one is a pure pass-through (`onHoverGame={onHoverGame}` at line 308) — no call-site body change needed there.

- [ ] **Step 2: Update `CataloguePage.tsx` hover wiring**

In `src/pages/CataloguePage.tsx`, update the import (find the existing import line for `createCatalogueHoverPreviewRetention`):

```ts
import { createCatalogueHoverPreviewRetention } from "../utils/cataloguePreview";
```

to:

```ts
import {
  createCatalogueHoverPreviewIntent,
  createCatalogueHoverPreviewRetention,
} from "../utils/cataloguePreview";
```

Change the state/helper block (lines 338-343):

```tsx
  const [hoveredGame, setHoveredGame] = useState<GhostBoxGame | null>(null);
  const clearHoveredGame = useCallback(() => setHoveredGame(null), []);
  const hoverPreviewRetention = useMemo(
    () => createCatalogueHoverPreviewRetention(clearHoveredGame),
    [clearHoveredGame]
  );
```

to:

```tsx
  const [hoveredGame, setHoveredGame] = useState<GhostBoxGame | null>(null);
  const clearHoveredGame = useCallback(() => setHoveredGame(null), []);
  const hoverPreviewRetention = useMemo(
    () => createCatalogueHoverPreviewRetention(clearHoveredGame),
    [clearHoveredGame]
  );
  const hoverPreviewIntent = useMemo(
    () => createCatalogueHoverPreviewIntent<GhostBoxGame>(setHoveredGame),
    []
  );
```

Change the cleanup effect (lines 443-446):

```tsx
  useEffect(
    () => () => hoverPreviewRetention.dispose(),
    [hoverPreviewRetention]
  );
```

to:

```tsx
  useEffect(
    () => () => {
      hoverPreviewRetention.dispose();
      hoverPreviewIntent.dispose();
    },
    [hoverPreviewRetention, hoverPreviewIntent]
  );
```

Change the page-change reset effect (lines 438-441) to also cancel a pending intent:

```tsx
  useEffect(() => {
    hoverPreviewRetention.cancelClear();
    setHoveredGame(null);
  }, [displayedPage, hoverPreviewRetention, visibleGamesCacheKey]);
```

to:

```tsx
  useEffect(() => {
    hoverPreviewRetention.cancelClear();
    hoverPreviewIntent.cancel();
    setHoveredGame(null);
  }, [displayedPage, hoverPreviewIntent, hoverPreviewRetention, visibleGamesCacheKey]);
```

Change `handleHoverGame` (lines 448-459) from:

```tsx
  const handleHoverGame = useCallback(
    (game: GhostBoxGame | null) => {
      if (game) {
        hoverPreviewRetention.cancelClear();
        setHoveredGame(game);
        return;
      }

      hoverPreviewRetention.scheduleClear();
    },
    [hoverPreviewRetention]
  );
```

to:

```tsx
  const handleHoverGame = useCallback(
    (game: GhostBoxGame | null, options?: { immediate?: boolean }) => {
      if (game) {
        hoverPreviewRetention.cancelClear();
        if (options?.immediate) {
          hoverPreviewIntent.showImmediately(game);
        } else {
          hoverPreviewIntent.scheduleShow(game);
        }
        return;
      }

      hoverPreviewIntent.cancel();
      hoverPreviewRetention.scheduleClear();
    },
    [hoverPreviewIntent, hoverPreviewRetention]
  );
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (no test yet covers this integration directly — that's fine, Task 1's unit tests cover the helper in isolation, and this task is wiring).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/CatalogueList.tsx src/pages/CataloguePage.tsx
git commit -m "feat: debounce pointer hover-in on catalogue list, keep focus instant"
```

---

## Task 4: Panel mount lifecycle (real enter/exit transition)

**Files:**
- Modify: `src/components/ui/CatalogueHoverPreview.tsx` (whole-file rewrite of the state/render sections)
- Modify: `src/app.scss:6613-6625`
- Test: `tests/catalogue-hover-preview.test.ts`

**Interfaces:**
- Consumes: `CATALOGUE_PREVIEW_EXIT_TRANSITION_MS` from Task 2
- Produces: no external prop/type change — `CatalogueHoverPreviewProps` stays `{ game: GhostBoxGame | null; onPointerEnter?: () => void; onPointerLeave?: () => void }`. Internal behavior only.

- [ ] **Step 1: Write the failing source-inspection tests**

Add to `tests/catalogue-hover-preview.test.ts` (inside the existing `describe` block, as a new `it`):

```ts
  it("keeps the panel mounted during exit and drives visibility via a class", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("CATALOGUE_PREVIEW_EXIT_TRANSITION_MS");
    expect(component).toContain("catalogue-hover-preview--visible");
    expect(component).toContain("catalogue-hover-preview--hidden");
    expect(component).toContain("displayedGame");
  });
```

Add to the `postcss`-based selector test (extend the existing assertions in the first `it` block, after the line `expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");`):

```ts
    expect(selectors).toContain(".catalogue-hover-preview--visible");
    expect(selectors).toContain(".catalogue-hover-preview--hidden");

    const screenshotRuleForTransition = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-hover-preview__screenshot"
    );
    expect(screenshotRuleForTransition?.toString()).toContain("transition:");
```

Note: this duplicates the existing `screenshotRule` lookup further down that currently asserts `not.toContain("transition:")` — update that existing assertion (search for `expect(screenshotRule?.toString()).not.toContain("transition:");` in the same file) to:

```ts
    expect(screenshotRule?.toString()).toContain("transition:");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalogue-hover-preview.test.ts`
Expected: FAIL — component doesn't contain `CATALOGUE_PREVIEW_EXIT_TRANSITION_MS`/`displayedGame`/the new classnames yet; `__screenshot` rule has no `transition:`.

- [ ] **Step 3: Rewrite `CatalogueHoverPreview.tsx`**

Replace the full file content with:

```tsx
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { withCachedImageSources } from "../../utils/imageCache";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  getAdjacentReadyScreenshotSource,
  getNextReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../../utils/cataloguePreview";

const AUTOPLAY_INTERVAL_MS = 3200;

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function CatalogueHoverPreview({
  game,
  onPointerEnter,
  onPointerLeave,
}: CatalogueHoverPreviewProps) {
  const { appearance, t } = useSettings();
  const isEnglish = appearance.language === "en";

  // Kept mounted across `game` briefly going null so the exit transition can
  // play instead of the panel popping out instantly.
  const [displayedGame, setDisplayedGame] = useState<GhostBoxGame | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (game) {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setDisplayedGame(game);

      if (!wasVisibleRef.current) {
        // First appearance: paint hidden, then flip to visible a frame later
        // so the enter transition actually has a state change to animate.
        setIsVisible(false);
        const frameId = requestAnimationFrame(() => {
          wasVisibleRef.current = true;
          setIsVisible(true);
        });
        return () => cancelAnimationFrame(frameId);
      }

      return;
    }

    wasVisibleRef.current = false;
    setIsVisible(false);
    exitTimeoutRef.current = setTimeout(() => {
      exitTimeoutRef.current = null;
      setDisplayedGame(null);
    }, CATALOGUE_PREVIEW_EXIT_TRANSITION_MS);

    return () => {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
    };
  }, [game]);

  const screenshotSources = useMemo(
    () =>
      displayedGame
        ? withoutHeaderImageSources(displayedGame.screenshots ?? []).slice(0, 3)
        : [],
    [displayedGame]
  );
  // Drives cache/manifest resolution and re-renders when a better URL lands.
  const resolvedScreenshotSources = useCachedImageSources(screenshotSources);
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // One source per screenshot: the resolved list holds several candidate URLs
  // for the same picture, and cycling through those looked like a dead chevron.
  const cachedScreenshotSources = useMemo(
    () =>
      pickDistinctScreenshotSources(
        screenshotSources.map((source) => withCachedImageSources([source])),
        failedScreenshotSources
      ),
    [screenshotSources, resolvedScreenshotSources, failedScreenshotSources]
  );
  const [activeScreenshotSource, setActiveScreenshotSource] = useState<
    string | null
  >(null);
  const [readyScreenshotCount, setReadyScreenshotCount] = useState(0);
  const [isAutoplayPaused, setIsAutoplayPaused] = useState(false);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");
  const screenshotKey = cachedScreenshotSources.join("\n");

  useEffect(() => {
    readyScreenshotSourcesRef.current = new Set();
    setReadyScreenshotCount(0);
    setFailedScreenshotSources(new Set());
    setActiveScreenshotSource(null);
  }, [screenshotSourceKey]);

  useEffect(() => {
    setActiveScreenshotSource((currentSource) => {
      if (currentSource && cachedScreenshotSources.includes(currentSource)) {
        return currentSource;
      }

      return getNextReadyScreenshotSource(
        cachedScreenshotSources,
        readyScreenshotSourcesRef.current,
        null
      );
    });
  }, [cachedScreenshotSources]);

  useEffect(() => {
    if (cachedScreenshotSources.length <= 1 || isAutoplayPaused) return;

    const intervalId = window.setInterval(() => {
      setActiveScreenshotSource((currentSource) =>
        getNextReadyScreenshotSource(
          cachedScreenshotSources,
          readyScreenshotSourcesRef.current,
          currentSource
        )
      );
    }, AUTOPLAY_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [cachedScreenshotSources, isAutoplayPaused, screenshotKey]);

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

  const handlePreviewPointerEnter = () => {
    setIsAutoplayPaused(true);
    onPointerEnter?.();
  };

  const handlePreviewPointerLeave = () => {
    setIsAutoplayPaused(false);
    onPointerLeave?.();
  };

  const handlePreviewFocus = () => {
    setIsAutoplayPaused(true);
    onPointerEnter?.();
  };

  const handlePreviewBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsAutoplayPaused(false);
    onPointerLeave?.();
  };

  if (!displayedGame) return null;

  const developers = displayedGame.developers?.filter(Boolean) ?? [];
  const screenshotAlt = (index: number) =>
    isEnglish
      ? `Screenshot ${index + 1} of ${displayedGame.title}`
      : `Screenshot ${index + 1} de ${displayedGame.title}`;
  // A broken candidate must step aside so the group falls back to the next URL.
  const markScreenshotFailed = (source: string) => {
    readyScreenshotSourcesRef.current.delete(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
    setFailedScreenshotSources((currentFailed) => {
      if (currentFailed.has(source)) return currentFailed;
      const nextFailed = new Set(currentFailed);
      nextFailed.add(source);
      return nextFailed;
    });
  };
  const markScreenshotReady = async (
    source: string,
    image: HTMLImageElement
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (!cachedScreenshotSources.includes(source)) return;

    if (readyScreenshotSourcesRef.current.has(source)) return;
    readyScreenshotSourcesRef.current.add(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
    setActiveScreenshotSource((currentSource) =>
      currentSource && readyScreenshotSourcesRef.current.has(currentSource)
        ? currentSource
        : getNextReadyScreenshotSource(
            cachedScreenshotSources,
            readyScreenshotSourcesRef.current,
            null
          )
    );
  };

  return (
    <section
      className={`catalogue-hover-preview ${
        isVisible ? "catalogue-hover-preview--visible" : "catalogue-hover-preview--hidden"
      }`}
      aria-label={
        isEnglish
          ? `Preview of ${displayedGame.title}`
          : `Preview de ${displayedGame.title}`
      }
      onPointerEnter={handlePreviewPointerEnter}
      onPointerLeave={handlePreviewPointerLeave}
      onFocusCapture={handlePreviewFocus}
      onBlurCapture={handlePreviewBlur}
    >
      <div className="catalogue-hover-preview__screenshots">
        {cachedScreenshotSources.length > 0 ? (
          cachedScreenshotSources.map((source, index) => {
            const isActive = source === activeScreenshotSource;
            return (
              <img
                className={`catalogue-hover-preview__screenshot${
                  isActive ? " catalogue-hover-preview__screenshot--active" : ""
                }`}
                key={source}
                src={source}
                alt={isActive ? screenshotAlt(index) : ""}
                aria-hidden={!isActive}
                loading="eager"
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
                onLoad={(event) => {
                  void markScreenshotReady(source, event.currentTarget);
                }}
                onError={() => markScreenshotFailed(source)}
              />
            );
          })
        ) : (
          <div className="catalogue-hover-preview__empty-media" />
        )}

        {cachedScreenshotSources.length > 1 && (
          <>
            <button
              className="catalogue-hover-preview__control catalogue-hover-preview__control--previous"
              type="button"
              aria-label={t("catalogue.preview.previousScreenshot")}
              disabled={readyScreenshotCount < 2}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                navigateScreenshot("previous");
              }}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="catalogue-hover-preview__control catalogue-hover-preview__control--next"
              type="button"
              aria-label={t("catalogue.preview.nextScreenshot")}
              disabled={readyScreenshotCount < 2}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                navigateScreenshot("next");
              }}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      <div className="catalogue-hover-preview__details" aria-live="polite">
        <strong className="catalogue-hover-preview__title">
          {displayedGame.title}
        </strong>
        {developers.length > 0 && (
          <span className="catalogue-hover-preview__credit">
            <span>{t("catalogue.preview.developer")}:</span> {developers.join(", ")}
          </span>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Update the SCSS enter/exit rule and screenshot transition**

In `src/app.scss`, change the base `.catalogue-hover-preview` rule (lines 6613-6625) from:

```scss
.catalogue-hover-preview {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
  box-shadow: var(--shadow-1);
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);
```

to:

```scss
.catalogue-hover-preview {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
  box-shadow: var(--shadow-1);
  transition:
    opacity var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);

  &--visible {
    opacity: 1;
    transform: translateY(0);
  }

  &--hidden {
    opacity: 0;
    transform: translateY(6px);
  }
```

(The rest of the `.catalogue-hover-preview` block — `&__screenshots`, `&__control`, etc. — stays exactly as-is, just now nested under this same rule as before.)

Change the `&__screenshot` rule (originally lines 6712-6724, shifted slightly by the edit above — locate by content, not line number) from:

```scss
  &__screenshot {
    position: absolute;
    inset: 0;
    z-index: var(--z-base);
    opacity: 0;
    backface-visibility: hidden;
    pointer-events: none;

    &--active {
      z-index: 1;
      opacity: 1;
    }
  }
```

to:

```scss
  &__screenshot {
    position: absolute;
    inset: 0;
    z-index: var(--z-base);
    opacity: 0;
    backface-visibility: hidden;
    pointer-events: none;
    transition: opacity var(--motion-base) var(--ease);

    &--active {
      z-index: 1;
      opacity: 1;
    }
  }
```

The existing `@media (prefers-reduced-motion: reduce)` block already sets `transition: none` on both `.catalogue-hover-preview` and `.catalogue-hover-preview__screenshot` — confirm it still reads (no change needed):

```scss
@media (prefers-reduced-motion: reduce) {
  .catalogue-hover-preview {
    transition: none;

    &__screenshot {
      transition: none;
    }
```

This still applies since `--visible`/`--hidden` inherit the `transition` declared on the parent `.catalogue-hover-preview` rule (they only set `opacity`/`transform` end states, not their own `transition`), so `transition: none` on the parent still wins under reduced motion.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/catalogue-hover-preview.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass. If `tests/catalogue-preview-rotation.test.ts` or `tests/catalogue-preview-controls.test.ts` assert the literal `1000` autoplay interval, update those assertions to `3200` now (search each file for `1000` in an autoplay/interval context before assuming none exist).

- [ ] **Step 8: Manual QA in the running app**

Run: `npm run dev`, open the catalogue page, and check:
- Hovering a list item with the mouse: preview appears with a visible fade+slide-in (not an instant pop).
- Quickly moving the pointer across several list rows: preview does not thrash — it settles on the row the pointer rests on.
- Tabbing to a list item with the keyboard: preview appears immediately (no debounce lag).
- Moving the pointer off the list (not into the preview panel) and waiting: preview fades out smoothly, not an instant disappearance.
- Moving the pointer from a list row into the preview panel itself: preview stays open (no premature fade-out while crossing the gap).
- With a game that has 2+ screenshots: autoplay crossfades every ~3.2s instead of hard-cutting every 1s; clicking the chevrons also crossfades.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/CatalogueHoverPreview.tsx src/app.scss tests/catalogue-hover-preview.test.ts tests/catalogue-preview-controls.test.ts tests/catalogue-preview-rotation.test.ts
git commit -m "feat: animate catalogue preview enter/exit and crossfade screenshots"
```

---

## Task 5: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Token check (project build gate)**

Run: `npm run check:tokens`
Expected: passes — the new SCSS uses only existing CSS custom properties (`--motion-base`, `--ease`, `--ease-out`), no new hex colors or magic values were introduced.

- [ ] **Step 4: Confirm spec goals are met**

Re-read `docs/superpowers/specs/2026-08-01-catalogue-preview-ux-flow-design.md` §Goals and confirm each is satisfied by Tasks 1-4:
- Real fade+slide transition on enter/exit: Task 4.
- No thrash while scanning: Task 1 + Task 3.
- Screenshot crossfade: Task 4 (SCSS transition + interval constant).
- Shorter, still-sufficient exit delay: Task 2.
