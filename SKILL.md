---
name: design-polish
description: Apply sophisticated refinements to UI design, color systems, contrast, hierarchy and visual elements, and enforce clean, token-based, maintainable front-end code. Use when creating or improving color palettes, dark themes, monochromatic scales, design systems, frontend interfaces, or when the user asks for polished design, better contrast, refined colors, professional visual hierarchy, accessible UI, or clean CSS architecture. Triggers include design polish, color hierarchy, contrast fixes, dark mode refinement, palette improvement, sophisticated UI, visual design upgrades, clean CSS, design tokens, accessibility audit.
---

# Design Polish

Apply rigorous, professional-grade refinements to color systems, contrast, visual hierarchy, UI elements, and the code that implements them. Prioritize perceptual clarity, accessibility, and subtle sophistication over decorative excess — and make sure the underlying code is as disciplined as the visual result.

## Core Principles

1. **Never sacrifice contrast for aesthetics.** Text and interactive elements must meet WCAG AA minimum (4.5:1 for normal text, 3:1 for large text/UI components). Aim for AAA (7:1) on primary content when possible.
2. **Colors that are too close destroy hierarchy.** Adjacent steps in a scale must be perceptually distinct. In grayscale/monochrome, aim for at least 15–25 RGB value difference (or ΔE > 8–10) between consecutive levels used for different roles.
3. **Dark themes require special care.** Pure black (`#000000`) creates harsh contrast and OLED issues. Prefer deep near-blacks (`#0f0f0f`–`#121212`). Elevate surfaces with subtle lightness steps rather than heavy shadows.
4. **Hierarchy > decoration.** Every color, border, shadow and spacing decision must serve a clear role in the visual hierarchy. Remove anything that does not.
5. **Code must mirror the design system.** Every color, spacing, radius, or type value that appears in code should trace back to a named token. A one-off hex code or pixel value in a component is a design-system leak, not a shortcut.
6. **Don't default to templated looks.** A palette or layout that would be the same answer for almost any brief is a sign you haven't made a real choice yet — see "Recognizing Generic Defaults" below.

## Color System Rules

### Building or Extending a Scale (especially monochromatic / dark)

- Define clear roles first: background, surface, elevated surface, border, muted text, secondary text, primary text, accent/highlight.
- Distribute steps evenly in perceptual space (not just linear RGB). For a pure grayscale from `#0f0f0f` (15) to `#f0f0f0` (240):
  - Use 9–11 steps maximum for a usable hierarchy.
  - Ensure consecutive role colors differ by ≥ 20–25 units in RGB for clear separation.
- Never place two colors closer than ~12–15 RGB units if they will sit next to each other or be used for different semantic roles.
- Test every text-on-background pair with a contrast checker. Reject any pair below 4.5:1 for body text.
- When adding a new accent or secondary hue, desaturate it slightly in dark themes and verify contrast against every surface it may appear on.

### Common Failure Modes to Avoid

- Using `#333` text on `#1a1a1a` (or similar near pairs) — looks "soft" but fails contrast and hierarchy.
- Adding multiple grays that are only 8–10 units apart "for subtlety." The result is muddy and unreadable.
- Applying the same border color to both low and high elevation surfaces.
- Using pure white (`#ffffff`) for primary text on deep dark backgrounds — creates eye strain. Prefer `#e8e8e8`–`#f0f0f0`.
- Ignoring hover/focus/active/disabled states. These must also meet contrast and be distinctly different from the resting state.
- Using color as the *only* signal for status (success/error/warning). Always pair with an icon, label, or shape.
- Overusing gradients or glow/blur effects to fake depth instead of a real elevation scale.

### Recommended Dark Monochrome Base (reference)

```
--bg-base:       #0f0f0f;   /* deepest background */
--bg-surface:    #1c1c1c;   /* cards, panels */
--bg-elevated:   #2a2a2a;   /* modals, popovers */
--border-subtle: #3a3a3a;
--border-strong: #525252;
--text-muted:    #8a8a8a;
--text-secondary:#b0b0b0;
--text-primary:  #e0e0e0;
--text-high:     #f0f0f0;   /* maximum emphasis */
```

Adjust steps only when contrast and perceptual distance are preserved.

## Element Refinement Rules

### Surfaces & Elevation
- Prefer lightness steps over large drop shadows in pure dark themes.
- If shadows are used: low opacity (8–16%), large blur, almost no spread. Color the shadow with a slightly elevated neutral, not pure black.
- Borders should be 1px and use a color at least 2–3 steps lighter than the surface they sit on.

### Typography
- Establish a clear type scale with sufficient size and weight contrast.
- Primary text ≥ 16px / 1rem for body. Line-height 1.5–1.7.
- Never rely on color alone for hierarchy — pair with size, weight or spacing.
- Keep line length readable: 45–75 characters for body text (`max-width: 65ch` is a convenient default).

### Interactive Elements
- Buttons, links and controls need distinct resting, hover, active, focus, and disabled states.
- Focus rings must have ≥ 3:1 contrast against adjacent colors and be clearly visible — never remove `:focus-visible` outlines without replacing them with an equally visible alternative.
- Disabled states should reduce opacity or shift to a muted step, never become the same color as the background.
- Touch targets: minimum 24×24px, 44×44px preferred on mobile/touch contexts.

### Iconography & Imagery
- Functional icons (buttons, controls) need an accessible label (`aria-label`, `title`, or visually-hidden text) — an icon alone is not a label.
- Icons must meet the same 3:1 contrast minimum as other UI components against their background.
- Keep stroke weight, corner radius, and optical size consistent across an icon set; mixed icon styles read as unpolished.
- Illustrations and imagery should not be the sole carrier of meaning — anything conveyed visually (status, category) needs a text or shape backup.

### Motion & Micro-interactions
- Respect `prefers-reduced-motion`; provide a reduced/no-motion fallback for any non-trivial animation.
- Animate `transform` and `opacity`, not layout-triggering properties (`width`, `height`, `top`, `left`) — this keeps transitions smooth and cheap.
- Typical micro-interaction timing: 150–250ms, ease-out for things entering, ease-in for things leaving.
- Spend motion deliberately on one or two signature moments per view rather than animating everything — over-animation reads as unfinished or artificial, not polished.

### Empty, Loading, and Error States
- Design these explicitly; don't ship the browser/framework default or a blank screen.
- Error copy states what happened and what to do next — never a bare "something went wrong."
- Loading states should reserve the final layout's space (skeletons) to avoid layout shift when content arrives.

### Spacing & Layout
- Use a consistent spacing scale (4/8px base). Prefer more generous spacing over tight packing when hierarchy is unclear.
- Group related elements tightly; separate unrelated groups with larger gaps.
- Design mobile-first and check at a minimum of ~375px, 768px, 1280px, and 1440px widths.
- Prefer fluid sizing (`clamp()`, relative units, max-width + padding) over fixed pixel widths and hard breakpoint jumps for type and containers.

## Accessibility Checklist (beyond contrast)

- Every interactive element must be reachable and operable by keyboard alone (Tab / Shift+Tab / Enter / Space), with a visible focus indicator at every step.
- Form inputs are always paired with a real `<label>` (or `aria-label`); validation errors are linked to their field via `aria-describedby`.
- Status/meaning is never color-only — pair with icon, text, or pattern.
- Prefer semantic HTML (`button`, `nav`, `header`, `main`, `label`) over generic `div`s with ARIA bolted on; correct semantics and accessibility reinforce each other and usually mean less code, not more.

## Code Quality Rules (Clean, Concise, Maintainable)

- **Centralize tokens.** Define all colors, spacing, radii, shadows, and type sizes as CSS variables (or a theme object) in one place. Components reference tokens; they never hardcode a hex value or raw pixel number inline.
- **Name tokens by role, not appearance.** Use `--text-primary`, not `--gray-e0` — role-based names survive a theme or palette change; appearance-based names don't.
- **Keep selectors flat.** Avoid nesting more than 2–3 levels deep. Watch for a type selector and a class-based override fighting each other on specificity (e.g. `.section` vs `.section .cta`) — this is a common source of styles silently cancelling out, especially around section/component padding and margin.
- **No `!important`**, except as a deliberate, documented last resort in a single-purpose utility class (e.g. `.sr-only`).
- **One spacing scale, one type scale.** Reuse them via variables or utility classes rather than scattering one-off values through the codebase.
- **Co-locate a component's styles.** Don't split one component's rules across unrelated blocks or files without reason.
- **Remove dead code before calling a pass done**: unused classes, leftover experiment styles, commented-out blocks.
- **Comment the "why," not the "what."** A comment should explain a non-obvious reason (why this magic number, why this workaround), not restate the CSS property next to it.

## Recognizing Generic / AI-Looking Defaults

Certain palette/layout combinations show up constantly in AI-generated UI regardless of the brief, which makes them read as a tell rather than a choice:
- Warm cream background (near `#F4F1EA`) with a high-contrast serif display and a terracotta/warm-clay accent (near `#D97757`).
- Near-black background with a single bright acid-green or vermilion accent and nothing else.
- Broadsheet-style layout: hairline rules, zero border-radius everywhere, dense newspaper-like columns.

None of these are wrong in isolation — but reach for them only when the brief actually calls for that direction, not as a safe default. If a request doesn't pin down a direction, treat these three as the options to actively avoid rather than fall back on.

This skill focuses on the color/contrast/hierarchy/code layer once a direction exists. For full brief-to-visual-identity work — typography pairing, layout concepts, copywriting, and taking a real aesthetic risk — see the `frontend-design` skill.

## Workflow When Polishing a Design

1. Audit all text/background pairs for contrast. Fix failures first.
2. Map every color to a role. Collapse any two colors that are too close and serve no distinct purpose.
3. Verify interactive, error, empty, and loading states are all designed and meet accessibility requirements.
4. Check elevation: surfaces should step up cleanly without muddiness.
5. Remove decorative noise (extra borders, unnecessary gradients, low-contrast icons, excess motion).
6. Audit the code itself: confirm every value traces to a token, no selectors are fighting on specificity, no `!important` abuse, no dead CSS.
7. Re-test the entire hierarchy at a glance — the eye should travel from primary → secondary → tertiary without confusion.
8. Sanity-check against real content — long paragraphs, dense tables, small labels, actual empty/error states — not just an empty mockup.

## When Generating or Suggesting Palettes / UIs

- Always state the intended role of each color, and whether a token is new or reused from the existing system.
- Provide contrast ratios for critical pairs when relevant.
- Prefer fewer, well-spaced steps over many nearly identical shades.
- In monochromatic or near-monochromatic systems, protect the perceptual gaps above all else.
- Suggest testing with real content (long paragraphs, dense tables, small labels) rather than empty mockups.

## Output Expectations

When applying this skill:
- Be explicit about which rules you are enforcing.
- Call out any remaining contrast, proximity, or accessibility risks.
- Flag any code-quality issues found along the way (specificity conflicts, magic values, dead code, missing tokens) alongside the visual issues.
- Prefer precise hex values and clear role names over vague descriptions ("darker gray," "softer tone").
- Keep suggestions minimal and purposeful — sophistication comes from restraint and clarity, not from adding more colors, effects, or code.