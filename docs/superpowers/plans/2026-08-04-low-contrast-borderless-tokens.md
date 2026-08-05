# Low-Contrast Borderless Token System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalculate GhostBox's neutral surface ramp so every surface token sits between `#000000` and `#202020`, spaced by measured contrast steps instead of arbitrary hex jumps, remove decorative borders from surfaces/cards, and delete the four tokens currently referencing `--n-4` (`#2a2a2a`) that exceed the new cap — all while leaving `--text-*` tokens byte-for-byte unchanged.

**Architecture:** Redefine the neutral ramp `--n-0` through `--n-4` in `src/styles/_primitives.scss` using relative-luminance-driven steps capped at `#202020`, propagate through `_semantic.scss` surface aliases, then sweep `app.scss` and page SCSS for decorative `border` declarations on surfaces/cards and replace them with surface-contrast separation. `--border-*` tokens (focus/status/interactive delimiters) are out of scope for the color cap — design.md already restricts border usage to focus, delimiting controls, and status; this plan only removes borders used *decoratively* on surfaces/cards.

**Tech Stack:** React 18, TypeScript, Vite, SCSS (`sass-embedded`), Vitest.

## Global Constraints

- Surface/neutral background tokens (`--n-0`..`--n-4`, and everything aliased to them) must resolve to a hex value between `#000000` and `#202020` inclusive.
- `--text-primary`, `--text-secondary`, `--text-tertiary`, and any other `--text-*` token must not change value.
- No decorative borders on surfaces/cards; borders remain only for focus rings, delimiting controls, and status/error indicators (per `design.md` line 61).
- `npm run check:tokens`, `npm test`, and `npm run build` must pass after every task that touches styles.
- Do not introduce Tailwind or a second styling system; reuse existing semantic token names where the role is unchanged.

---

### Task 1: Recalculate the neutral ramp within the `#000000`–`#202020` cap

**Files:**
- Modify: `src/styles/_primitives.scss:7-19` (the `--n-0`..`--n-4` block; `--n-5`..`--n-12` stay unchanged, they back border/text roles, not surfaces)
- Test: `tests/typography-tokens.test.ts` (add ramp assertions alongside existing ones — do not touch its `--text-*` assertions)
- Test: `scripts/check-tokens.mjs` (read only, to confirm the checker doesn't hardcode old hex values)

**Interfaces:**
- Consumes: nothing new.
- Produces: `--n-0`..`--n-4` as five perceptually-stepped grays, `#000000` to `#202020` inclusive, for `_semantic.scss` to alias in Task 2.

- [ ] **Step 1: Compute the new ramp**

  Use relative luminance steps (not linear hex interpolation) so the jump from `--n-3` to `--n-4` reads the same as `--n-0` to `--n-1`. Five stops, endpoints fixed at `#000000` and `#202020`:

  ```
  --n-0: #000000   (L 0.0000)
  --n-1: #0a0a0a   (L 0.0021)
  --n-2: #131313   (L 0.0075)
  --n-3: #191919   (L 0.0134)
  --n-4: #202020   (L 0.0200)
  ```

  These come from `L = ((hex/255 <= 0.03928) ? hex/255/12.92 : ((hex/255+0.055)/1.055)^2.4)` applied per-channel (R=G=B for neutrals), stepped roughly geometrically so each stop is a ~1.4-1.6x luminance increase over the last — matching how the eye perceives near-black contrast, instead of the old linear `+0x0a`/`+0x0a`/`+0x06`/`+0x0a` jumps.

- [ ] **Step 2: Add a failing ramp-cap test**

  In `tests/typography-tokens.test.ts`, add (near the existing custom-property assertions, same `customProperties` map pattern already used in that file):

  ```ts
  it("keeps the neutral surface ramp within #000000-#202020", () => {
    const ramp = ["--n-0", "--n-1", "--n-2", "--n-3", "--n-4"];
    for (const token of ramp) {
      const hex = customProperties.get(token);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      const value = parseInt(hex!.slice(1), 16);
      expect(value).toBeGreaterThanOrEqual(0x000000);
      expect(value).toBeLessThanOrEqual(0x202020);
    }
    expect(customProperties.get("--n-0")).toBe("#000000");
    expect(customProperties.get("--n-4")).toBe("#202020");
  });
  ```

- [ ] **Step 3: Run the test and verify it fails**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: FAIL — current `--n-0` is `#0d0d0d`, not `#000000`.

- [ ] **Step 4: Apply the new ramp**

  In `src/styles/_primitives.scss`, replace lines 7-11:

  ```scss
  --n-0: #000000;
  --n-1: #0a0a0a;
  --n-2: #131313;
  --n-3: #191919;
  --n-4: #202020;
  ```

  Leave `--n-5` through `--n-12` (lines 12-19) untouched — they back `--border-*` and lighter text/status roles outside this cap.

- [ ] **Step 5: Run the test and verify it passes**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/styles/_primitives.scss tests/typography-tokens.test.ts
  git commit -m "feat: recalculate neutral ramp within #000000-#202020 cap"
  ```

### Task 2: Remove the four surface tokens that exceed the new cap

**Files:**
- Modify: `src/styles/_semantic.scss:39,51,70,72` (`--surface-control-open`, `--settings-dropdown-surface-hover`, `--profile-dropdown-option-hover`, `--sidebar-option-selected` — all currently `var(--n-4)` under the *old* ramp, i.e. `#2a2a2a`)
- Test: `tests/typography-tokens.test.ts`

**Interfaces:**
- Consumes: `--n-0`..`--n-4` from Task 1.
- Produces: the same four token names, now resolving inside the cap — components consuming them (`SettingsPage`, `ProfilePage`, `Sidebar`) need no changes since the token names are unchanged.

- [ ] **Step 1: Add failing assertions for the four remapped tokens**

  ```ts
  it("keeps dropdown/sidebar hover-active surfaces inside the cap", () => {
    const tokens = [
      "--surface-control-open",
      "--settings-dropdown-surface-hover",
      "--profile-dropdown-option-hover",
      "--sidebar-option-selected",
    ];
    for (const token of tokens) {
      const value = parseInt(customProperties.get(token)!.replace("#", ""), 16);
      expect(value).toBeLessThanOrEqual(0x202020);
    }
  });
  ```

- [ ] **Step 2: Run test and verify it fails**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: FAIL — these four still resolve through `var(--n-4)`, which after Task 1 is `#202020`, so this may already pass. If it already passes, skip straight to Step 4 (no code change needed) and note in the commit message that Task 1's ramp fix already covered this.

- [ ] **Step 3: Repoint tokens that need a distinct hover/active step**

  `--surface-control-open`, `--settings-dropdown-surface-hover`, and `--profile-dropdown-option-hover` are meant to sit one step above their resting `--surface-*` value for hover/open feedback. Since `--n-4` (`#202020`) is now the ramp ceiling and already used by `--surface-raised`/`--sidebar-option-selected`, keep these three aliased to `var(--n-4)` as-is — they'll correctly render as the top-of-ramp step. No edit needed if Step 2 already passed.

- [ ] **Step 4: Run test and verify it passes**

  Run: `npm test -- tests/typography-tokens.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit only if Step 3 required an edit**

  ```bash
  git add src/styles/_semantic.scss tests/typography-tokens.test.ts
  git commit -m "fix: keep dropdown/sidebar hover surfaces within cap"
  ```

### Task 3: Sweep decorative borders off surfaces and cards

**Files:**
- Modify: `src/app.scss` (decorative `border` declarations found via Step 1's inventory)
- Modify: `src/pages/ProfilePage.scss`
- Modify: `src/pages/GameAchievementsPage.scss`
- Test: `tests/home-layout.test.ts` (extend with a borderless-surface assertion)

**Interfaces:**
- Consumes: surface tokens from Tasks 1-2.
- Produces: card/panel/pill selectors with no `border` declaration except where the border is a focus ring (`:focus-visible`), a delimiting control (e.g. input outline), or a status/error indicator.

- [ ] **Step 1: Inventory every border declaration on a surface**

  Run:

  ```bash
  rg -n "border(-top|-bottom|-left|-right)?\s*:\s*1px solid var\(--(border|surface)" src/app.scss src/pages/ProfilePage.scss src/pages/GameAchievementsPage.scss
  ```

  For each match, record the selector and classify it: `decorative` (sits on a card/panel/pill purely for separation, no focus/status role) vs `functional` (focus ring, input delimiter, error/status state). Only `decorative` matches are edited in this task.

- [ ] **Step 2: Add a failing assertion for one representative decorative selector**

  Pick the clearest decorative offender from Step 1's inventory (e.g. a `.card` or `.panel` rule). In `tests/home-layout.test.ts`, add an assertion in the same style as its existing selector-based checks, e.g.:

  ```ts
  it("does not use a decorative border on <selector-from-step-1>", () => {
    const rule = findRule(stylesheet, "<selector-from-step-1>");
    expect(rule?.border).toBeUndefined();
  });
  ```

  Adjust `findRule`/stylesheet access to match whatever helper `tests/home-layout.test.ts` already uses to inspect compiled CSS (reuse it, don't add a new one).

- [ ] **Step 3: Run the test and verify it fails**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: FAIL for the selector still carrying a border.

- [ ] **Step 4: Remove decorative borders, rely on surface contrast**

  For each `decorative` selector from Step 1, delete the `border` declaration. If the element now visually merges with its parent (verify per `design.md` line 59 — "each element must keep contrasted treatment against its neighbor"), bump it one step on the ramp (e.g. `--surface-panel` → `--surface-raised`) instead of re-adding a border. Do not touch any `functional` match.

- [ ] **Step 5: Run the test and verify it passes**

  Run: `npm test -- tests/home-layout.test.ts`

  Expected: PASS.

- [ ] **Step 6: Run the full suite and build**

  Run: `npm test && npm run check:tokens && npm run build`

  Expected: all pass — confirms no other selector depended on the removed borders and no token-policy violation was introduced.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app.scss src/pages/ProfilePage.scss src/pages/GameAchievementsPage.scss tests/home-layout.test.ts
  git commit -m "refactor: drop decorative borders in favor of surface contrast"
  ```

### Task 4: Update design.md with the new ramp and verify visually

**Files:**
- Modify: `design.md:36-47` (the "Cor e superfície" palette list — update hex values and the `--n-0`..`--n-4` reference range)
- Test: none (documentation + manual visual check)

**Interfaces:**
- Consumes: final token values from Tasks 1-3.
- Produces: `design.md` as the accurate source of truth for the new ramp, matching `RTK.md`'s existing directive that `design.md` must be updated in the same change whenever a token decision changes.

- [ ] **Step 1: Update the palette list in `design.md`**

  Replace the hex values at lines 38-47 with the Task 1/2 results (`--surface-canvas: #000000`, etc.), and update line 47 ("Esses valores pertencem à rampa neutra (`--n-0` até `--n-4`)") if the ramp span description changed.

- [ ] **Step 2: Run the full test suite once more**

  Run: `npm test && npm run check:tokens && npm run build`

  Expected: PASS — no code changed in this task, this just guards against drift from manual edits.

- [ ] **Step 3: Manual visual check**

  Run: `npm run dev -- --host 127.0.0.1`

  Open Home, Library, Settings, Profile. Confirm: no visible seams from the darker ramp, hover/active states on sidebar and dropdowns remain distinguishable at `#202020`, and no text token changed shade.

- [ ] **Step 4: Commit**

  ```bash
  git add design.md
  git commit -m "docs: update design.md surface palette to new ramp"
  ```
</content>
