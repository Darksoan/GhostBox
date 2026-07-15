# GhostBox — Agent Rules

These rules are mandatory for every agent and contributor working on this codebase.
Follow them without exception.

---

## 1. Zero Regressions

- **Never break existing functionality.** Before touching any file, understand what it
  currently does and which other parts of the codebase depend on it.
- If a change risks side-effects in unrelated areas, call that out explicitly before
  proceeding — do not silently break things and move on.
- Prefer **surgical, minimal edits**: change only what is necessary to fulfill the
  request. Do not refactor, rename, or restructure code that is out of scope.
- When in doubt about impact, search the codebase for usages before editing.

---

## 2. Be Direct and Concise

- Get to the point. Do not pad responses with unnecessary preamble, summaries of
  what you are about to do, or repetition of what was already said.
- Responses should be **actionable and brief**. Explain only what is non-obvious.
- Do not ask trivial clarifying questions that can be reasonably inferred from
  context. Make a reasonable decision and proceed.
- Do not re-summarize completed work unless the user explicitly asks.

---

## 3. Run Checks After Every Edit

After completing any edit to source code, **always** run the appropriate validation:

- **TypeScript / JS**: run `tsc --noEmit` (or the project''s lint/type-check script)
  to verify no type errors were introduced.
- **Linting**: run `eslint` (or the configured linter) on changed files.
- **Build**: if the change touches critical paths, verify the build still succeeds.
- **Tests**: if tests exist for the affected module, run them.
- Report the output. If errors are found, fix them before ending your turn. Do not
  hand back broken code.

---

## 4. Frontend — Reuse Before Creating

When adding or modifying UI elements:

1. **Search first.** Before writing a new component, style, or utility, search the
   existing codebase for something that already does (or nearly does) the same thing.
2. **Copy and reference.** If a similar component or pattern already exists, copy its
   structure and reference its styles. Do not invent parallel implementations.
3. **Match the existing visual language exactly.** Inspect nearby components for:
   - CSS custom properties / design tokens in use
   - Spacing, border-radius, font-size, font-weight patterns
   - Animation durations and easing curves
   - Icon stroke widths and sizes
4. **Never introduce a one-off style** that duplicates a token or deviates from the
   established scale. Map every new value to an existing design token.
5. **No new dependencies** for UI primitives that already exist in the project
   (e.g., do not add a new icon library if the project already uses one).

---

## 5. Consistency is Non-Negotiable

- Every new piece of UI must be **indistinguishable in style** from adjacent,
  already-shipped components.
- If you are unsure how something should look, find the closest existing component
  and match it exactly — spacing, colors, typography, motion, and interaction states.
- When in doubt, look it up in the codebase rather than guessing. Use grep or file
  search to find reference implementations.
- Do not mix paradigms: if the project uses CSS custom properties, do not introduce
  inline styles or hardcoded values.
