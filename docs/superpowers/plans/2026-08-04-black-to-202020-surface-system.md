# Black-to-#202020 Low-Contrast Surface System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GhostBox's surface color system with a low-contrast, borderless hierarchy spanning `#000000` (floor) to `#202020` (ceiling), superseding the current `design.md` palette and the existing Figma-alignment plan. Text tokens (`--text-*`) are not touched.

**Architecture:** Rebuild `--n-0`..`--n-4` as five contrast-equalized stops between `#000000` and `#202020`. Decouple the border ramp from the surface ramp first (it currently aliases `--n-4`, so changing the surface ramp would silently move border colors). Re-map every `--surface-*` alias onto the new ramp. Strip decorative borders; separation comes from spacing first and ramp-step contrast second.

**Tech Stack:** React 18, TypeScript, Vite, SCSS (`sass-embedded`), Vitest, PostCSS (used by the existing token tests).

## Measured contrast basis

Steps use WCAG relative luminance, not linear hex distance. Linear hex steps look flat near black and abrupt near `#202020`; these are chosen so each adjacent pair has near-identical contrast ratio:

| pair | hex | contrast |
|---|---|---|
| `--n-0`→`--n-1` | `#000000`→`#0b0b0b` | 1.067:1 |
| `--n-1`→`--n-2` | `#0b0b0b`→`#141414` | 1.068:1 |
| `--n-2`→`--n-3` | `#141414`→`#1a1a1a` | 1.059:1 |
| `--n-3`→`--n-4` | `#1a1a1a`→`#202020` | 1.068:1 |
| full span | `#000000`→`#202020` | 1.289:1 |

Integer-hex quantization near black is coarse; 1.059 vs 1.068 is the best achievable evenness in this range.

**Consequence that drives Task 4:** a single step is ~1.07:1, far below the 3:1 WCAG non-text minimum. On a non-OLED panel in a lit room, one ramp step alone is not a reliable separator. Spacing and grouping must carry separation; contrast is a secondary cue. Where two surfaces must abut with zero gap, they get a **two-stop** jump (~1.13:1), not one.

## Global Constraints

- Every background/fill token must resolve within `#000000`-`#202020` inclusive. Text and border tokens are exempt.
- `--text-*` token values must not change.
- No decorative borders on surfaces, cards, panels, or pills. Borders survive only on `:focus-visible` rings, form-control delimiters, and status/error indicators.
- Border tokens (`--border-subtle`/`-default`/`-strong`/`-interactive`) must keep their current rendered values through this whole plan. They are a separate ramp and must not drift as a side effect.
- Ignore `docs/superpowers/plans/2026-08-04-figma-global-visual-system.md` and the existing `design.md` palette section — this plan replaces both.
- `npm run check:tokens`, `npm test`, and `npm run build` must pass after every styling task.

---

### Task 1: Decouple the border ramp from the surface ramp

**Files:**
- Modify: `src/styles/_primitives.scss` (add a border primitive; `--n-5`..`--n-7` already exist and stay)
- Modify: `src/styles/_semantic.scss:85` (`--border-subtle`)
- Test: `tests/typography-tokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `--border-subtle` pinned to `#2a2a2a` independently of `--n-4`, so Task 2 can change `--n-4` without moving border colors.

**Why this task exists:** `--border-subtle: var(--n-4)` and `--n-4` is currently `#2a2a2a`. Task 2 changes `--n-4` to `#202020`. Without this task, every subtle border in the app silently darkens — a change this plan explicitly does not want.

- [ ] **Step 1: Write the failing pin test**

  In `tests/typography-tokens.test.ts`, using the existing `collectTokens()` helper (it returns a `Map<string,string>` of `:root` custom properties compiled from `src/app.scss`) — note it stores the *declared* value, so `--border-subtle` currently reads back as the literal string `var(--n-4)`, not a hex. Assert the resolved hex instead by adding a small resolver:

  ```ts
  function resolveColor(name: string, tokens: Map<string, string>): string {
    const value = tokens.get(name);
    if (!value) throw new Error(`missing token ${name}`);
    const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
    return variable ? resolveColor(variable, tokens) : value;
  }

  it("keeps border tokens off the surface ramp", () => {
    const tokens = collectTokens();
    expect(resolveColor("--border-subtle", tokens)).toBe("#2a2a2a");
    expect(tokens.get("--border-subtle")).not.toBe("var(--n-4)");
  });
  ```

- [ ] **Step 2: Run and verify it fails**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: FAIL on the second assertion — `--border-subtle` is still `var(--n-4)`.

- [ ] **Step 3: Add the border primitive and repoint**

  In `src/styles/_primitives.scss`, next to `--n-5`, add:

  ```scss
  // Rampa de borda: independente da rampa de superfície. Superfícies são
  // limitadas a #202020; bordas não são.
  --b-0: #2a2a2a;
  ```

  In `src/styles/_semantic.scss:85`:

  ```scss
  --border-subtle: var(--b-0);
  ```

  Leave `--border-default: var(--n-5)`, `--border-strong: var(--n-6)`, `--border-interactive: var(--n-7)` alone — `--n-5`..`--n-7` are not modified by this plan.

- [ ] **Step 4: Run and verify it passes**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/styles/_primitives.scss src/styles/_semantic.scss tests/typography-tokens.test.ts
  git commit -m "refactor: decouple border ramp from surface ramp"
  ```

### Task 2: Build the new 5-stop surface ramp

**Files:**
- Modify: `src/styles/_primitives.scss:7-11` (`--n-0`..`--n-4`)
- Modify: `src/styles/_primitives.scss:21-23` (`--n-000` and its now-wrong comment)
- Test: `tests/typography-tokens.test.ts`

**Interfaces:**
- Consumes: `--b-0` decoupling from Task 1.
- Produces: `--n-0`..`--n-4` as the contrast-equalized stops in the table above, for Task 3 to alias.

**`--n-000` problem:** it is `#070707` and its comment says it "fica abaixo de `--n-0`". With `--n-0` becoming `#000000`, `#070707` is now *above* it, inverting `--surface-sunken`, `--surface-modal`, `--surface-media-letterbox`, and `--surface-tray-item-hover` — all four alias `--n-000`. Nothing can go below `#000000`, so `--n-000` loses its reason to exist and is folded into the ramp.

- [ ] **Step 1: Write the failing ramp test**

  ```ts
  it("uses the contrast-equalized surface ramp", () => {
    const tokens = collectTokens();
    expect(tokens.get("--n-0")).toBe("#000000");
    expect(tokens.get("--n-1")).toBe("#0b0b0b");
    expect(tokens.get("--n-2")).toBe("#141414");
    expect(tokens.get("--n-3")).toBe("#1a1a1a");
    expect(tokens.get("--n-4")).toBe("#202020");
    expect(tokens.has("--n-000")).toBe(false);
  });
  ```

- [ ] **Step 2: Run and verify it fails**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: FAIL — current ramp is `#0d0d0d, #101010, #1a1a1a, #202020, #2a2a2a` and `--n-000` still exists.

- [ ] **Step 3: Replace the ramp**

  `src/styles/_primitives.scss:7-11`:

  ```scss
  --n-0: #000000;
  --n-1: #0b0b0b;
  --n-2: #141414;
  --n-3: #1a1a1a;
  --n-4: #202020;
  ```

  Delete `--n-000` and its comment (lines 21-23). `--n-5`..`--n-12` stay unchanged.

- [ ] **Step 4: Repoint the four `--n-000` consumers**

  In `src/styles/_semantic.scss`, replace each `var(--n-000)` so the build still compiles. Final values are set properly in Task 3; for now use `var(--n-0)` at lines 14 (`--surface-sunken`), 46 (`--surface-tray-item-hover`), 63 (`--surface-media-letterbox`), 65 (`--surface-modal`). Lines 127-128 (`--spinner-track-on-light`, `--spinner-indicator-on-light`) draw on a *light* button surface, so they are not part of the dark surface ramp — repoint both to `var(--b-0)`'s darker sibling by using the literal `#070707` inline there with a comment explaining it is a fixed ink color on light backgrounds, not a surface.

- [ ] **Step 5: Run and verify it passes**

  Run: `npm test -- tests/typography-tokens.test.ts && npm run check:tokens`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/styles/_primitives.scss src/styles/_semantic.scss tests/typography-tokens.test.ts
  git commit -m "feat: rebuild surface ramp from #000000 to #202020"
  ```

### Task 3: Re-map every semantic surface alias onto the new ramp

**Files:**
- Modify: `src/styles/_semantic.scss` lines 7-72 (all `--surface-*`, `--sidebar-option-*`, `--settings-dropdown-*`, `--profile-dropdown-*`, `--library-box-active`, `--toggle-track`)
- Test: `tests/typography-tokens.test.ts`

**Interfaces:**
- Consumes: `--n-0`..`--n-4` from Task 2, `resolveColor()` helper from Task 1.
- Produces: same token names, every one capped at `#202020`, with no two *adjacent* layers sharing a stop.

- [ ] **Step 1: Set the layer mapping**

  Structural layers, one stop each, bottom to top:

  ```scss
  --surface-canvas:  var(--n-0);  /* #000000 */
  --surface-panel:   var(--n-1);  /* #0b0b0b */
  --surface-sidebar: var(--n-1);  /* #0b0b0b — same tier as panel, never adjacent to it */
  --surface-raised:  var(--n-2);  /* #141414 */
  --surface-popover: var(--n-3);  /* #1a1a1a */
  --surface-modal:   var(--n-4);  /* #202020 — one above popover, never equal */
  ```

  `--surface-sunken` cannot go below `#000000`. It stays `var(--n-0)` and is distinguished by geometry (inset padding, no fill change), not color. Anywhere `--surface-sunken` currently sits directly on `--surface-canvas` and relies on being darker, that rule must instead use spacing or move the container up a stop — record those selectors during Step 4 and fix them there.

  `--surface-media-letterbox: var(--n-0)` — pure black behind cover art is correct and needs no separation from canvas.

  Interactive states step **two** stops from their resting tier where the control abuts its container with no gap, one stop otherwise, capped at `--n-4`:

  ```scss
  --surface-option:         var(--n-1);
  --surface-option-hover:   var(--n-2);
  --surface-option-active:  var(--n-4);
  --surface-popover-hover:  var(--n-2);
  --surface-popover-active: var(--n-4);
  --surface-control:        var(--n-3);
  --surface-control-hover:  var(--n-4);
  --surface-control-open:   var(--n-4);
  --sidebar-option-hover:   var(--n-2);
  --sidebar-option-selected: var(--n-4);
  --settings-dropdown-surface:       var(--n-3);
  --settings-dropdown-surface-hover: var(--n-4);
  --profile-dropdown-surface:        var(--n-1);
  --profile-dropdown-surface-hover:  var(--n-2);
  --profile-dropdown-option-hover:   var(--n-4);
  --surface-tray-item-hover: var(--n-2);
  ```

- [ ] **Step 2: Write the failing cap sweep**

  ```ts
  it("caps every surface-role token at #202020", () => {
    const tokens = collectTokens();
    const surfaceRole = /^--(surface|sidebar-option|settings-dropdown-surface|profile-dropdown-surface|profile-dropdown-option|library-box-active)/;
    for (const name of tokens.keys()) {
      if (!surfaceRole.test(name)) continue;
      const resolved = resolveColor(name, tokens);
      if (!/^#[0-9a-f]{6}$/i.test(resolved)) continue; // color-mix composites verified in Step 4
      expect(parseInt(resolved.slice(1), 16), `${name} = ${resolved}`).toBeLessThanOrEqual(0x202020);
    }
  });
  ```

- [ ] **Step 3: Run and verify it fails**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: FAIL on hardcoded values still over cap — `--settings-dropdown-menu: #252525` (line 44 area) is the clearest.

- [ ] **Step 4: Apply the mapping and fix hardcoded hexes**

  Apply Step 1. Then replace every remaining raw hex surface value with its ramp stop, always rounding **down** so nothing exceeds the cap:

  - `--surface-titlebar-control: #1a1a1a` → `var(--n-3)`
  - `--surface-titlebar-popover: #1a1a1a` → `var(--n-3)`
  - `--surface-dropdown-menu: #1a1a1a` → `var(--n-3)`
  - `--settings-dropdown-menu: #252525` → `var(--n-4)` (rounds down from `#252525`)

  For the two `color-mix` composites, keep the function and swap the base operand, then compute the result by hand and confirm it lands ≤ `#202020`:

  - `--surface-explore-card: color-mix(in srgb, var(--surface-solid) 86%, var(--white) 4%)` — with `--surface-solid` now `#000000`, the white share lifts it to roughly `#0a0a0a`. If the computed result exceeds `#202020`, lower the white percentage until it does not.
  - `--toggle-track: color-mix(in srgb, var(--border-hover) 38%, var(--surface-sunken))` — this mixes a *border* color into a surface, so it can exceed the cap. Repoint its base to `var(--n-4)` and its mix partner to `var(--n-0)`, or accept it as a control-delimiter role and add it to the sweep's exclusion list with a comment saying why.

  Record every selector found in Task 3 Step 1's `--surface-sunken` note and fix it here.

- [ ] **Step 5: Run and verify it passes**

  Run: `npm test -- tests/typography-tokens.test.ts && npm run check:tokens && npm test`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/styles/_semantic.scss tests/typography-tokens.test.ts
  git commit -m "feat: map every surface alias onto the capped ramp"
  ```

### Task 4: Strip decorative borders and add spacing separation

**Files:**
- Modify: `src/app.scss`
- Modify: `src/pages/ProfilePage.scss`
- Modify: `src/pages/GameAchievementsPage.scss`
- Test: `tests/home-layout.test.ts`

**Interfaces:**
- Consumes: surface tokens from Task 3.
- Produces: surface selectors with no decorative `border`, and explicit `gap`/`padding` wherever a removed border was the only separator.

**Governing constraint:** one ramp step is ~1.07:1. Removing a border without adding spacing leaves two surfaces functionally merged on an LCD. Every border removed in this task must be replaced by either a gap, a two-stop jump, or both.

- [ ] **Step 1: Inventory borders on surface selectors**

  Run:

  ```bash
  rg -n "border(-top|-bottom|-left|-right)?\s*:\s*1px solid var\(--(border|surface)" src/app.scss src/pages/ProfilePage.scss src/pages/GameAchievementsPage.scss
  ```

  For each hit, record the selector and classify: `decorative` (separator on a card/panel/pill, no interaction or status role) or `functional` (`:focus-visible`, input delimiter, error/status). Only `decorative` hits are edited. For each decorative hit also note whether the element has a `gap` or `margin` from its neighbor — if not, it needs one in Step 4.

- [ ] **Step 2: Write the failing borderless test**

  `tests/home-layout.test.ts` has no `findRule` helper — it uses `postcss.parse(compile(...).css)` plus `walkRules`. Follow that pattern:

  ```ts
  it("removes decorative borders from surface containers", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const offenders: string[] = [];
    const decorative = [/* selectors classified decorative in Step 1 */];
    stylesheet.walkRules((rule) => {
      if (!decorative.includes(rule.selector)) return;
      rule.walkDecls(/^border(-(top|bottom|left|right))?$/, (declaration) => {
        offenders.push(`${rule.selector} { ${declaration.prop}: ${declaration.value} }`);
      });
    });
    expect(offenders).toEqual([]);
  });
  ```

  Populate `decorative` with the literal selector strings recorded in Step 1.

- [ ] **Step 3: Run and verify it fails**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL, listing each decorative border still present.

- [ ] **Step 4: Remove borders, add the replacement separator**

  For each decorative hit: delete the `border` declaration, then apply whichever replacement its Step 1 note calls for — add `gap`/`margin` using an existing `--space-*` token, or move one of the two surfaces a second stop up the ramp. Do not re-add a border to compensate, and do not introduce a new spacing value outside the `--space-*` scale.

- [ ] **Step 5: Run and verify it passes**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: PASS.

- [ ] **Step 6: Full suite and build**

  Run: `npm test && npm run check:tokens && npm run build`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app.scss src/pages/ProfilePage.scss src/pages/GameAchievementsPage.scss tests/home-layout.test.ts
  git commit -m "refactor: replace decorative borders with spacing separation"
  ```

### Task 5: Verify on a real display and rewrite design.md

**Files:**
- Modify: `design.md:34-61` ("Cor e superfície")
- Test: none — manual verification plus full suite guard

**Interfaces:**
- Consumes: final values from Tasks 1-4.
- Produces: `design.md` as accurate source of truth for the `#000000`-`#202020` system.

- [ ] **Step 1: Full suite guard**

  Run: `npm test && npm run check:tokens && npm run build`

  Expected: PASS.

- [ ] **Step 2: Verify on a non-OLED display at moderate brightness**

  Run: `npm run dev -- --host 127.0.0.1`

  This is the step that validates the whole premise. On an LCD (not OLED, not a dark room), open Home, Library, Settings, Profile, Notifications and check each adjacent surface pair — canvas/panel, panel/raised, raised/popover, popover/modal. For each: is the boundary locatable without a border?

  If a pair is indistinguishable, the fix is spacing or a two-stop jump, not a border and not raising the ceiling above `#202020`. Record which pairs failed before changing anything.

- [ ] **Step 3: Verify interactive states**

  Hover and select sidebar items, open every dropdown, open a modal. Confirm each state change is visible at `#202020` against its resting tier. Confirm `:focus-visible` rings still render — they use `--border-interactive` (`--n-7`, `#606060`), untouched by this plan.

- [ ] **Step 4: Confirm text is unchanged**

  Run: `git diff HEAD~4 -- src/styles/_semantic.scss | rg "^[+-].*--text-"`

  Expected: no output. Any line here means a text token drifted and must be reverted.

- [ ] **Step 5: Rewrite design.md**

  Replace lines 34-47 with the new hex values and the range statement (`--n-0` `#000000` to `--n-4` `#202020`). Replace lines 49-59 with the Task 3 layer mapping, and state explicitly that separation comes from spacing first and ramp contrast second, citing the ~1.07:1 per-step figure so the next person does not assume contrast alone is doing the work. Note the border ramp (`--b-0`, `--n-5`..`--n-7`) is deliberately outside the cap.

- [ ] **Step 6: Commit**

  ```bash
  git add design.md
  git commit -m "docs: rewrite surface section for #000000-#202020 system"
  ```
</content>
