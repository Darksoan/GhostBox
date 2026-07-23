# Remove Game Modal Reviews

## Scope

Remove the player reviews section displayed at the bottom of the game modal. This includes the heading, sorting controls, review cards, loading placeholders, empty state, pagination, and styles used only by that section.

Keep the Recommendation section in the game modal sidebar unchanged from the user's perspective. It must continue to show the recommendation percentage, sentiment, meter, positive and negative totals, loading state, collapse behavior, and existing fallback data.

## Architecture

Replace the combined `GameReviewsSection` responsibility with a recommendation-only component. The component will continue loading the global Steam review summary through the existing cached review request and render into the sidebar slot through the existing portal.

The game modal will retain its lazy-loaded recommendation component and sidebar container. It will no longer render any reviews content in the main details column.

## Data Flow

The recommendation component receives the game ID, language, fallback positive ratio, fallback review count, and sidebar portal container. It requests only the unfiltered global summary (`all` language and `all` reviews) and uses the existing fallback values if no summary is available.

No localized review list, sorting filter, page state, viewport observer, review card data, or pagination data will be loaded.

## Cleanup

Delete review-list types, helpers, UI components, state, effects, icons, and CSS selectors that are not required by the recommendation sidebar. Preserve all `modal__review-summary-*` styles.

## Verification

Run the production build. Verify that the game modal has no reviews section below its main content and that Recommendation remains visible and functional in the sidebar, including loading and fallback states.
