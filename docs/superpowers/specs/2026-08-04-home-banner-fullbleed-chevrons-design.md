# Home banner full-bleed + hover chevrons

Date: 2026-08-04

## Goal

`HomeRecommendedBanner` (the hero at the top of the Home tab) currently sits
inset by the page's horizontal padding, like every other Home section. Make
it span 100% of the tab's horizontal viewport (edge-to-edge, no side gap),
and add hover-revealed prev/next chevrons that navigate the same recommended
carousel already driving the pagination dots.

## Scope

- `src/pages/HomePage.tsx`: `HomeRecommendedHero` — add chevron buttons.
- `src/app.scss`: full-bleed rule for `.home-recommended__banner` +
  `.home-recommended__stage`; new `.home-recommended__nav` styles.
- `src/i18n.ts`: two new label keys (pt/en) for chevron `aria-label`s.

Out of scope: extra banner content (ratings, tags, CTA button), changing
pagination dots, changing which games appear in the carousel.

## Layout: full-bleed banner

`.home-recommended` currently has `padding-inline: var(--home-content-inline-inset)`
(36px), and it sits inside `.home-page`, which has
`padding: ... var(--home-page-inline-padding) ...` (`--space-6`, 12px). So the
banner is inset from the real viewport edge by 48px total on each side today.

Only the banner (`.home-recommended__stage` → `.home-recommended__banner`)
breaks out to full-bleed; the section header ("Recomendados" title) keeps
normal padding. Approach: apply a negative inline margin + matching width
increase on `.home-recommended__stage`, sized to cancel both paddings:

```scss
.home-recommended__stage {
  position: relative;
  min-width: 0;
  margin-inline: calc(
    -1 * (var(--home-page-inline-padding) + var(--home-content-inline-inset))
  );
  width: calc(
    100% + 2 * (var(--home-page-inline-padding) + var(--home-content-inline-inset))
  );
}
```

`.home-recommended__banner` keeps `width: 100%` (now 100% of the wider
stage) and drops its `border-radius` to 0 — edge-to-edge hero reads flat,
not rounded. `aspect-ratio` and existing cover/overlay/meta children are
unaffected.

The pagination dots (`.home-recommended__pagination`) are positioned
`inset-inline-end`/`inset-block-end` relative to `.home-recommended__stage`
(the nearest `position: relative` ancestor) — since the stage is now the
full-bleed box, dots stay flush to the new (further-out) banner corner
automatically, no change needed there.

## Chevrons

Two new buttons inside `.home-recommended__stage`, siblings of
`HomeRecommendedBanner` and the pagination `div`:

```tsx
{visibleGames.length > 1 ? (
  <>
    <button
      type="button"
      className="home-recommended__nav home-recommended__nav--prev"
      aria-label={t.home.recommendedPreviousGame}
      onClick={() =>
        setActiveIndex((i) => (i - 1 + visibleGames.length) % visibleGames.length)
      }
    >
      <ChevronLeft aria-hidden="true" />
    </button>
    <button
      type="button"
      className="home-recommended__nav home-recommended__nav--next"
      aria-label={t.home.recommendedNextGame}
      onClick={() => setActiveIndex((i) => (i + 1) % visibleGames.length)}
    >
      <ChevronRight aria-hidden="true" />
    </button>
  </>
) : null}
```

Same guard as the pagination dots (`visibleGames.length > 1`) — single-game
carousels show neither dots nor chevrons.

`ChevronLeft`/`ChevronRight` imported from `lucide-react` alongside the
existing `ChevronDown` import in `HomePage.tsx`.

### Styling (`.home-recommended__nav`)

Follows the established hover-reveal control pattern from
`.catalogue-hover-preview__control`:

```scss
.home-recommended__nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: grid;
  place-items: center;
  width: var(--space-14);
  height: var(--space-14);
  border: 0;
  border-radius: var(--radius-circle);
  background-color: color-mix(in srgb, var(--black) 40%, transparent);
  color: var(--text-primary);
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity var(--motion-fast) var(--ease), background-color var(--motion-fast) var(--ease);
  cursor: pointer;

  &--prev {
    inset-inline-start: var(--space-6);
  }

  &--next {
    inset-inline-end: var(--space-6);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .home-recommended__stage:hover .home-recommended__nav {
    opacity: 1;
  }

  .home-recommended__nav:hover {
    background-color: color-mix(in srgb, var(--black) 55%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-recommended__nav {
    transition: none;
  }
}
```

Buttons stay `opacity: 0` + revealed via `:hover`/`:focus-visible` — not
`pointer-events: none`, so keyboard/focus-visible access always works even
without hover (matches how `.catalogue-hover-preview__control` behaves,
confirmed by its existing test asserting no `pointer-events: none`).

## i18n

`home.recommended` is an existing flat string key (`"Recomendados"` /
`"Recommended"`, the section title) — not an object, so the new labels
can't nest under it. Add two sibling flat keys to the `home` block instead,
in both `pt` and `en` (`src/i18n.ts`, next to the existing `recommended` key):

```ts
// pt
recommendedPreviousGame: "Jogo anterior",
recommendedNextGame: "Próximo jogo",

// en
recommendedPreviousGame: "Previous game",
recommendedNextGame: "Next game",
```

## Testing

- New/updated scss test (pattern: `tests/catalogue-hover-preview.test.ts`)
  asserting `.home-recommended__nav`, `--prev`, `--next` selectors exist,
  the reduced-motion rule exists, and the hover-reveal media query is
  present.
- Extend or add a home-layout test asserting `.home-recommended__stage` has
  the negative-margin/width full-bleed rule and `.home-recommended__banner`
  has `border-radius: 0`.
- Manual check in browser: hover banner → chevrons fade in on both sides;
  click each → active game changes, matching dot updates; keyboard tab to
  chevron → focus ring shows without hover; banner touches both edges of
  the tab at various viewport widths.
