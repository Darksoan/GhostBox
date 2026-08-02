# Remove Catalogue Personalization

## Goal

Show only the backend-ranked catalogue. Remove the local "For you" recommendation system and all code used exclusively by it.

## Scope

- Remove the personalized recommendation section from `CataloguePage`.
- Remove its recommendation hook, local affinity formula, translations, styles, and dedicated tests.
- Remove catalogue page props and routing calculations used only to build the local affinity profile.
- Remove the `match=any` request mode created only for recommendation candidate pools; regular filters keep their existing all-values semantics.
- Preserve unrelated in-progress changes in touched files.

## Data Flow

`useCatalogueState` continues requesting `sort: "popular"` with the daily rotation seed. The catalogue worker continues ranking games by descending `ranking_tier` and applying deterministic daily rotation within each tier. `CataloguePage` slices paginated chunks and renders games in response order without client-side sorting.

## Non-Goals

- Do not change backend score weights, tiers, rotation, regular filter semantics, pagination, or caching.
- Do not replace personalization with another recommendation algorithm.
- Do not alter home-page recommendations or Steam wishlist behavior.

## Verification

- Update catalogue layout assertions to require absence of personalized section.
- Run relevant frontend catalogue tests and TypeScript checks.
- Run catalogue worker ranking and rotation tests plus worker typecheck.
- Search for orphaned affinity and catalogue recommendation references.
