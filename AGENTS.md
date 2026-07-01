# PirateBox — Design & Style Rules

These rules are mandatory for any AI agent or contributor touching the UI.
The goal is a single, consistent visual language. Do not deviate.

## 1. Always use design tokens — never hardcode values

All structural colors, radii, motion, and weights are defined as CSS custom
properties in `src/app.scss` under `:root`. Use the token, never the raw value.

### Colors
- Backgrounds/surfaces: `--background`, `--background-dark`, `--surface-solid`,
  `--surface-deep`, `--surface-ui`, `--surface`, `--surface-subtle`,
  `--surface-hover`, `--surface-active`, `--surface-strong`.
- Borders: `--border`, `--border-subtle`, `--border-ui`, `--border-strong`,
  `--border-hover`.
- Text: `--text`, `--text-strong`, `--text-muted`, `--text-soft`, `--text-dim`,
  `--text-faint`.
- Overlays: `--overlay-subtle`, `--overlay-medium`, `--overlay-strong`.
- Semantic state: `--danger` / `--danger-hover` / `--danger-soft`,
  `--success` / `--success-hover` / `--success-soft`.

Do NOT introduce new hex literals like `#131313`, `#0b0b0b`, `#0f0f0f`,
`#101010`. Map them to the existing token. Do not create new green/red
variants — reuse `--success*` / `--danger*`.

### Accent / purple
- `--accent` (`#8b5cf6`) is the purple brand accent. It is ALSO injected
  per-game via inline styles on game cards.
- Do NOT use `--accent` (or any purple) for neutral UI hover states such as
  buttons, list items, or "Ver mais / See details" controls. Neutral hovers use
  `--surface-hover` for background and `#fff` / `--text-strong` for text.
- Reserve purple strictly for intentional brand/XP/game-themed accents.

### Radius — use the 6-tier scale only
`--radius-xs` (2px), `--radius-sm` (4px), `--radius-md` (8px),
`--radius-lg` (12px), `--radius-pill` (999px), `--radius-circle` (50%).
No arbitrary `border-radius` values.

### Modal radius and headers
- Main modal containers use `--radius-md`, not `--radius-lg`. The current visual
  language has less-rounded modal corners.
- Modal header title/subtitle spacing is compact: title and subtitle are close,
  with the subtitle at a smaller size.
- Modal subtitles start with lowercase in both languages, unless the string is a
  proper noun or a sentence that must start uppercase for grammar.
- Modal subtitles are supporting text: keep them muted, small, and concise.

### Motion — three tiers only
`--motion-fast` (0.12s), `--motion-base` (0.18s), `--motion-slow` (0.3s),
with `--ease` for the easing curve. Do not write raw durations like `0.2s`.
Animation keyframes (skeleton pulse, spinners) are exempt.

### Font weights — only loaded weights
Open Sans is loaded at 400, 500, 600, 700 only. Use the tokens
`--weight-regular` (400), `--weight-medium` (500), `--weight-semibold` (600),
`--weight-bold` (700). NEVER use 300, 800, or 900 — the browser fakes them and
they look inconsistent.

### Typography — Open Sans everywhere
- The entire app uses Open Sans via `--font-sans`, `--font-display`, and
  `--font-sidebar`. Do not introduce alternate UI fonts.
- Do not use `monospace` for visible UI text unless the user explicitly requests
  a code/terminal treatment.
- Prefer the weight tokens over raw numbers. Text should not look thin: use
  `--weight-medium` for normal UI labels, `--weight-semibold` for emphasized
  labels/headings, and `--weight-bold` only for strong hierarchy.
- Subtexts, descriptions, metadata, and helper copy must not look thin. Use at
  least `--weight-medium`; in dense cards/lists or very small text (`11px`-`12px`),
  prefer `--weight-semibold` with a muted text token instead of reducing weight.
- Keep compact section headings consistent with the profile/current UI style:
  small uppercase labels use `12px`, `--weight-medium` or stronger only when
  hierarchy requires it, and tokenized letter spacing if already present nearby.

### Icons — slightly heavier strokes
- Lucide icons should not look thin. The global CSS in `src/app.scss` increases
  default SVG stroke weight and maps common thin strokes upward.
- When adding explicit `strokeWidth`, prefer at least `2` for normal icons and
  `2.15` / `2.25` for small UI icons that need more presence.
- Preserve already-bold checkmarks or status icons (for example `strokeWidth={3}`)
  unless there is a clear visual mismatch.

## 2. Flat design — no shadows

A global reset enforces `box-shadow: none !important` and
`text-shadow: none !important` on all elements (`src/app.scss`). Do not add new
`box-shadow` / `text-shadow` declarations — they will be silently suppressed and
only add dead code. Depth is expressed via surfaces and borders, not shadows.

## 3. Interactive vs. non-interactive

- Tag/pill chips are NOT clickable: subtle background lighten on hover
  (e.g. 0.04 → 0.08) but `cursor` stays default (no `pointer`).
- The home banner hero is NOT clickable. Only the arrows, the "Ver detalhes /
  See details" button, and the selector pills are interactive.
- "Ver detalhes / See details" button: dim at rest (`rgba(255,255,255,0.25)`),
  fully white (`#fff`) on hover. Text-only, no icon.
- Icon-only edit controls should not jump or change background on hover unless
  the surrounding component already does that. Prefer keeping position and
  background stable and only lightening the icon color.

## 4. Profile UI rules

- The profile bottom tab bar shows only fixed profile tabs: Overview/Geral,
  Library/Biblioteca, Favorites/Favoritos, and Achievements/Conquistas. Do not
  add custom collection folders to this bar.
- The achievement showcase displays unlocked achievements only. Do not show
  locked achievements there.
- If there are fewer unlocked achievements than visible slots, fill the remaining
  slots with skeleton/empty placeholders.
- Editing the achievement showcase opens a modal. The modal lists unlocked
  achievements and selected items use a lightened border to indicate selection.
- Keep the achievement showcase edit icon visually stable on hover: only the icon
  color should brighten.

## 5. Bilingual labels

UI strings are bilingual via `language === "en" ? "English" : "Português"`.
Always provide both languages when adding user-facing text.

## 6. Before adding any style

1. Check `:root` in `src/app.scss` for an existing token first.
2. Reuse the closest token instead of inventing a value.
3. If a genuinely new token is needed, add it to `:root` and document the
   intent — do not scatter raw values across components.
