# Smooth Navigation and Layout Motion

## Goal

Add subtle, fast motion across GhostBox so page changes, internal tab changes, and visible layout updates feel continuous without delaying interaction or changing existing behavior.

## Scope

- Main navigation through the sidebar, browser-style back/forward actions, and tray navigation.
- Internal tabs in Profile and Settings.
- Repositioning, insertion, and removal in non-virtualized Library, Favorites, and Profile game grids, plus Catalogue active-filter chips.
- Existing desktop and narrow-window layouts.

Overlays and modals keep their current transition language. This work does not introduce a general animation library or redesign existing surfaces.

## Motion Language

- Motion is subtle and responsive: use `--motion-base` (180 ms) for page and panel transitions and `--motion-fast` (120 ms) for control feedback.
- Use the existing `--ease` curve for spatial movement.
- Page content moves only 6-8 px while fading. The shell, sidebar, and persistent header stay visually stable.
- New or rearranged elements may begin at `scale(0.985)` and reduced opacity before settling.
- No spring, bounce, large zoom, or decorative parallax effects.

## Architecture

Use a hybrid approach:

1. Use the existing View Transitions API adapter for main page changes. Apply a transition name only to the changing content region so the application shell is not captured.
2. Use CSS animations and transitions for internal tab panels and tab indicators.
3. Use FLIP-style movement for the named game grids and Catalogue active-filter chips. Measure before and after layout, then animate the visual delta with `transform` while the document remains in its final layout.
4. Keep an immediate fallback when View Transitions are unavailable or motion is disabled.

The implementation must not add a runtime animation dependency.

## Main Navigation

- Wrap all page-changing entry points in the same transition path so sidebar, tray, back, and forward navigation behave consistently.
- The outgoing content fades while translating up by about 6 px.
- The incoming content fades in while translating from about 8 px below.
- Existing keep-alive page instances, scroll restoration, lazy loading, and overlay closing behavior remain unchanged.
- Repeated navigation during a transition must resolve to the latest requested page without leaving stale classes or blocked pointer events.

## Internal Tabs

### Profile

- Keep the existing transform-based tab indicator and add a short transition once its first position is known.
- Determine direction from the previous and next tab positions.
- The outgoing panel fades and shifts 6 px opposite the navigation direction; the incoming panel enters from the selected direction.
- Preserve current image preloading, pagination, collection selection, and scroll behavior.

### Settings

- Animate the panel as one transition boundary when the active settings tab changes.
- Preserve the current staggered entry of setting rows, but reduce the interval so the last row does not make the page feel delayed.
- Subscription and download blocks use the same panel timing as standard settings rows.

## Layout Reflow

- Animate stable cards in non-virtualized Library, Favorites, and Profile game grids, and animate Catalogue active-filter chips when their screen position changes after filtering, sorting, insertion, or removal.
- Use stable application IDs as animation identities. Do not animate skeleton placeholders as if they were loaded content.
- Limit FLIP measurement to the affected visible container. Avoid document-wide queries and avoid measuring off-screen virtualized items.
- Layout reaches its final state immediately; only the visual transform interpolates. This keeps hit targets and accessibility geometry correct.

## Performance Constraints

- Spatial animation uses only `transform` and `opacity`.
- Do not animate `top`, `left`, `width`, `height`, margin, padding, or grid definitions.
- Avoid permanent `will-change`; apply compositor hints only for the active transition when needed.
- Do not replace existing virtualization or keep-alive behavior.
- Animation work must not introduce synchronous measurement loops or repeated layout reads and writes in the same frame.

## Accessibility

- Respect the existing `html.no-animations` application preference even when the operating system disables Windows animations globally.
- App reduced-motion mode performs state changes immediately and disables View Transitions, FLIP movement, stagger, and panel motion.
- Focus remains on the initiating control unless current behavior intentionally moves it.
- Hidden panels remain excluded from keyboard navigation and accessibility output.

## Validation

- Run the TypeScript and Vite production build.
- Verify sidebar navigation, tray navigation, and back/forward navigation, including rapid repeated input.
- Verify Profile tabs, user collections, Settings tabs, and the subscription/download variants.
- Verify filtering, sorting, adding, and removing cards in Library, Favorites, and Profile, plus Catalogue active-filter chips.
- Verify scroll restoration, lazy-loaded first visits, empty states, overlays, and narrow-window layouts.
- Verify the GhostBox reduced-motion setting produces immediate, stable updates without relying on the Windows animation setting.
- Inspect transitions for layout-triggering animated properties and visible flashes.

## Acceptance Criteria

- Page and tab changes no longer look like hard cuts when motion is enabled.
- Repositioned cards and active-filter chips in the named containers move smoothly to their new positions without delaying the final layout.
- Interactions remain responsive during and after transitions.
- No new dependency is added.
- Existing navigation state, scroll restoration, loading, and overlay behavior remain correct.
- Motion is fully disabled by the GhostBox reduced-motion setting.
