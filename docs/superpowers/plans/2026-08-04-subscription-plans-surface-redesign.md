# Subscription Plans Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `.subscription-plans` / `.subscription-plan-card` (upsell modal + Settings → Assinatura → Planos) to remove decorative borders and off-ramp gradients, replacing them with surface-level contrast — Free card at the ramp floor, Premium card at its current raised level — matching the borderless system already applied to `.subscription-account`.

**Architecture:** Pure CSS/SCSS edit in `src/app.scss` (no new files, no component restructuring) plus one line-height/letter-spacing/magic-number normalization pass. No test framework exists for visual CSS in this repo — verification is `npm run check:tokens` (static border/off-ramp lint), `npm run build`, `npm test` (existing 68 unit tests, must stay green — they don't cover this CSS but must not regress), and a manual visual check in the running app.

**Tech Stack:** SCSS, existing token system in `src/styles/_primitives.scss` / `src/styles/_semantic.scss`, `scripts/check-tokens.mjs` lint.

## Global Constraints

- No decorative borders on surfaces, cards, panels, or pills. Borders survive only on `:focus-visible` rings, form-control delimiters, and status/error indicators. (spec, borrowed from `docs/superpowers/plans/2026-08-04-black-to-202020-surface-system.md`)
- Every background/fill must resolve to a stop on the `--n-0..--n-4` ramp via the semantic tokens (`--surface-canvas`, `--surface-panel`, `--surface-raised`, `--surface-popover`) — no raw gradients/color-mix used as a surface fill.
- No rule outside `_semantic.scss`/`_mixins.scss` may reference `--n-*`/`--a-*`/`--gold-*` directly (header comment, `src/styles/_semantic.scss:1-2`).
- `letter-spacing`/`line-height` literals must use `--ls-*` (`src/styles/_primitives.scss:84-91`) / `--type-line-*` (`src/styles/_semantic.scss:172-181`) tokens, not raw values.
- Pixel sizes should come from the `--space-*` scale (`src/styles/_primitives.scss:48-61`) or a `calc()` over it; introduce local `--subscription-*` custom properties (pattern already used at `src/app.scss:4835-4844` in `.subscription-account`) when no exact scale stop fits.
- Run `npm run check:tokens && npm test && npm run build` before considering any task done.

---

### Task 1: Card base surfaces — Free vs Premium contrast

**Files:**
- Modify: `src/app.scss:4451` (`.subscription-plan-card` base), `:4468` (`--featured`)

**Interfaces:**
- Consumes: `--surface-canvas`, `--surface-raised` (defined in `src/styles/_semantic.scss:12-32`, already used elsewhere in the file — no new tokens needed).
- Produces: nothing consumed by later tasks — this is a leaf visual change.

- [ ] **Step 1: Change the Free card's base background**

In `src/app.scss`, inside `.subscription-plan-card` (starts line 4451):

```scss
.subscription-plan-card {
  position: relative;
  display: grid;
  min-height: 0;
  grid-template-rows: auto 1fr auto;
  gap: var(--space-7);
  padding: var(--space-8) var(--space-7) var(--space-7);
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--surface-canvas);
  transition:
    background var(--motion-fast) var(--ease);
```

(Only the `background` line changes, from `var(--surface-secondary)` to `var(--surface-canvas)`. Everything else stays as-is.)

- [ ] **Step 2: Confirm the featured (Premium) card is untouched**

Verify `&--featured` at line 4468 still reads:

```scss
  &--featured {
    background: var(--surface-raised);
  }
```

No edit needed here — it already sits one degree above the new Free background, which is the "max contrast within the ramp" outcome from the approved mockup.

- [ ] **Step 3: Verify**

```bash
npm run check:tokens
```
Expected: `check-tokens: ok.`

- [ ] **Step 4: Commit**

```bash
git add src/app.scss
git commit -m "style: sink free plan card to ramp floor for max contrast with premium"
```

---

### Task 2: Remove card-level borders (badge, billing toggle, action button)

**Files:**
- Modify: `src/app.scss:4472-4488` (`&__badge`), `:4528-4577` (`&__billing-toggle*`), `:4638-4671` (`&__action`)

**Interfaces:**
- Consumes: `--surface-popover`, `--surface-raised`, `--focus-ring-color` (all defined `src/styles/_semantic.scss`).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Badge — move off `--background`, add local offset token**

At the top of `.subscription-plan-card` (right after `padding:` line, before `border-radius`, i.e. just before line 4451's closing properties — insert as a new custom property block at the very start of the rule body, line 4452):

```scss
.subscription-plan-card {
  // Local scale-derived tokens — mirrors the pattern in .subscription-account.
  --plan-badge-offset: calc(var(--space-3) * -1 - var(--space-1));
  --plan-action-min-height: var(--space-14);

  position: relative;
```

Then update `&__badge` (line 4472):

```scss
  &__badge {
    position: absolute;
    top: var(--plan-badge-offset);
    left: 50%;
    padding: var(--space-2) var(--space-5);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-popover);
    color: var(--text-primary);
    font-size: var(--type-size-micro);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--ls-100);
    text-transform: uppercase;
    transform: translateX(-50%);
    transition: background-color var(--motion-fast) var(--ease);
    white-space: nowrap;
  }
```

(Only `top` and `background` changed.)

- [ ] **Step 2: Billing toggle — surface-raised track, surface-popover thumb, focus-ring token**

Replace the `&__billing-toggle`, `&__billing-toggle-thumb`, and `&__billing-toggle button` blocks (lines 4528-4577) with:

```scss
  &__billing-toggle {
    position: relative;
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
  }

  &__billing-toggle-thumb {
    position: absolute;
    top: var(--space-1);
    bottom: var(--space-1);
    left: var(--space-1);
    width: calc(50% - var(--space-1));
    border-radius: var(--radius-pill);
    background: var(--surface-popover);
    transition: transform var(--motion-base) var(--ease);

    &--quarterly {
      transform: translateX(100%);
    }
  }

  &__billing-toggle button {
    position: relative;
    z-index: 1;
    min-height: 28px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: var(--type-size-caption);
    font-weight: var(--weight-semibold);
    transition: color var(--motion-fast) var(--ease);

    &.is-active {
      color: var(--text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: 2px;
    }
  }
```

(Changes: toggle track background `--surface-canvas` → `--surface-raised`; thumb background `--sidebar-selector` → `--surface-popover`; thumb offsets `3px` → `var(--space-1)`; focus outline color `--icon-default` → `--focus-ring-color`.)

- [ ] **Step 3: Action button — drop border, raise surface, add focus ring**

Replace `&__action` (lines 4638-4671) with:

```scss
  &__action {
    min-height: var(--plan-action-min-height);
    width: 100%;
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-primary);
    cursor: pointer;
    font-size: var(--type-size-compact);
    font-weight: var(--weight-medium);
    transition:
      background var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      opacity var(--motion-fast) var(--ease);

    &:hover,
    &:focus-visible {
      background: var(--surface-popover);
      outline: none;
    }

    &:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: 2px;
    }

    &:disabled {
      cursor: default;
      opacity: 0.48;
    }

    &:disabled:hover {
      background: var(--surface-raised);
    }
  }
```

(Dropped `border: 1px solid var(--border)` and both `border-color` overrides; background now `--surface-raised` → `--surface-popover` on hover, matching the account tab's action-button pattern from `src/app.scss:5044` area.)

- [ ] **Step 4: Verify**

```bash
npm run check:tokens
npm run build
```
Expected: both succeed with no new violations.

- [ ] **Step 5: Commit**

```bash
git add src/app.scss
git commit -m "style: remove decorative borders from plan card badge, toggle, and action button"
```

---

### Task 3: Modal/settings card variants — normalize magic min-heights

**Files:**
- Modify: `src/app.scss:4674-4691` (`.subscription-plans--modal .subscription-plan-card`), `:4693-4698+` (`.subscription-plans--settings .subscription-plan-card`)

**Interfaces:**
- Consumes: local tokens from Task 2 (`--plan-action-min-height` not needed here) plus `--space-16`.
- Produces: nothing.

- [ ] **Step 1: Read the current settings-variant block to get its full extent**

Read `src/app.scss` lines 4693-4720 before editing (the file excerpt available at plan-writing time only went to line 4698 — confirm where the block's closing brace is before making the edit, since this task must not truncate later rules in the same selector).

- [ ] **Step 2: Replace the two literal `min-height` values**

In `.subscription-plans--modal .subscription-plan-card` (line 4675):

```scss
  min-height: calc(var(--space-16) * 6 + var(--space-9));
```
(replaces `min-height: 260px;` — 260px ≈ 16*16 + 4 = 260, closest scale composition using existing tokens; exact pixel match isn't required, this is a min-height floor, not a pixel-critical value).

In `.subscription-plans--settings .subscription-plan-card` (line 4695):

```scss
  min-height: calc(var(--space-16) * 7 + var(--space-9));
```
(replaces `min-height: 350px;`, same reasoning.)

- [ ] **Step 3: Verify**

```bash
npm run build
```
Expected: builds cleanly, no SCSS errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.scss
git commit -m "style: derive plan card min-heights from space scale"
```

---

### Task 4: `.subscription-plans` support blocks — surfaces, borders, line-height/letter-spacing

**Files:**
- Modify: `src/app.scss:4204-4448` (`&__highlight-card`, `&__discord-link`, `&__discord-action`, `&__step`, `&__detail-card`, `&__policy-note`)

**Interfaces:**
- Consumes: `--surface-panel`, `--surface-popover`, `--type-line-*`, `--ls-100`.
- Produces: nothing.

- [ ] **Step 1: Highlight card — drop the radial gradient, flatten to `--surface-panel`**

Replace `&__highlight-card` (lines 4210-4242):

```scss
  &__highlight-card {
    display: flex;
    align-items: flex-start;
    padding: var(--space-9);
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-panel);

    h4 {
      display: inline-flex;
      align-items: center;
      gap: var(--space-4);
      margin: 0 0 var(--space-3);
      color: var(--text-primary);
      font-size: var(--type-size-body);
      font-weight: var(--weight-semibold);
      line-height: var(--type-line-body);
    }

    p {
      margin: 0;
      color: var(--text-secondary);
      font-size: var(--type-size-compact);
      font-weight: var(--weight-semibold);
      line-height: var(--type-line-compact);
    }
  }
```

- [ ] **Step 2: Discord link/action and step — `--surface-canvas` → `--surface-panel`, remove step's icon border**

`&__discord-link` (line 4250): change `background: var(--surface-canvas);` → `background: var(--surface-panel);`.

`&__discord-action` (line 4298) and its `:hover`/`:focus-visible` (line 4317): change base `background: var(--surface-canvas);` → `var(--surface-panel);`, and hover `background: var(--surface-secondary);` → `var(--surface-popover);`.

`&__step` (line 4338): change `background: var(--surface-canvas);` → `var(--surface-panel);`. Its inner `span` (line 4351):

```scss
    span {
      display: inline-grid;
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: var(--radius-circle);
      background: var(--surface-popover);
      color: var(--text-primary);
      font-size: var(--type-size-micro);
      font-weight: var(--weight-semibold);
    }
```
(dropped `border: 1px solid var(--border-ui)`; background `--background-dark` → `--surface-popover`.)

Also update `&__step`'s own `line-height: 1.4;` → `line-height: var(--type-line-caption);`.

- [ ] **Step 3: Detail card / policy note — `--surface-canvas` → `--surface-panel`, line-height tokens**

`&__detail-card, &__policy-note` (line 4377): change `background: var(--surface-canvas);` → `var(--surface-panel);`.

Update literal `line-height` values in this file region to their token equivalents:
- `&__header h3` (line 4115) `line-height: 1.25;` → `var(--type-line-body);`
- `&__header p` (line 4124) `line-height: 1.45;` → `var(--type-line-compact);`
- `&__highlight-card` — already handled in Step 1.
- `&__detail-card li` (line 4406) `line-height: 1.45;` → `var(--type-line-compact);`
- `&__policy-note p` (line 4431) `line-height: 1.5;` → `var(--type-line-body-emphasis);`
- `&__checkout > span` (line 4158) `letter-spacing: 0.04em;` → `var(--ls-100);`

- [ ] **Step 4: Verify**

```bash
npm run check:tokens
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app.scss
git commit -m "style: flatten subscription-plans support blocks to panel surface, tokenize line-height"
```

---

### Task 5: Final normalization pass and full verification

**Files:**
- Modify: `src/app.scss` (spot-check remaining literals inside `.subscription-plans`/`.subscription-plan-card` listed in the spec: `4083`/`4511` `max-width: 220px/540px`, `4180`/`4189-4190` payment-method icon sizes, `4139-4140` eyebrow icon size, `4353-4354` covered in Task 4, `4020-4021`/`4027-4028` settings-variant step sizing, `4012` `clamp(8px, 2vh, 22px)`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — this is the closing verification task for the whole plan.

- [ ] **Step 1: Grep for remaining raw px/em inside the two blocks**

```bash
awk 'NR==3949,NR==4700' src/app.scss | grep -nE "[0-9]+px|[0-9.]+em" | grep -v "var(--"
```

For each hit that is a *sizing/spacing* value (icon width/height, max-width, min-height, gap), replace with the nearest `--space-*` token or a `calc()` composition, following the pattern already used in Tasks 1-4 and in `.subscription-account` (`src/app.scss:4835-4844`). Leave values that are legitimately not on the design scale unless the spec calls them out (e.g. `border-radius` circle icons sized to match an external SVG viewbox are out of scope for this plan — only touch what the spec's literal list names).

- [ ] **Step 2: Run full verification suite**

```bash
npm run check:tokens
npm test
npm run build
```
Expected: `check-tokens: ok.`, all 68 tests pass, build succeeds.

- [ ] **Step 3: Manual visual check**

```bash
npm run tauri dev
```

Open the Premium upsell modal and Settings → Assinatura → Planos. Confirm:
- No decorative borders anywhere in either card or support block.
- Free card visibly sits lower on the ramp than Premium (background contrast, not text color).
- Billing toggle thumb is solid, borderless, and focus-visible shows a ring.
- Hovering the plan action button and the Discord action shifts surface level without any border flash.

- [ ] **Step 4: Commit**

```bash
git add src/app.scss
git commit -m "style: normalize remaining magic numbers in subscription plans"
```
