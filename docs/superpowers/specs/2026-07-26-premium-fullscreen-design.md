# Fullscreen Premium Subscription

## Goal

Open the Premium subscription cards in a fullscreen overlay instead of navigating to Settings.

## Scope

- Change the Premium entry point in the header.
- Reuse the existing subscription modal and plan cards.
- Keep checkout, Discord-linking, status loading, and close behavior unchanged.

## Design

Clicking the Premium control in the header opens `SubscriptionModal` through the existing overlay state. The modal occupies the full viewport and shows the existing modal subscription surface, including plans, subscription steps, Discord linking, and policy details.

The action must not call page navigation or select the Settings subscription tab. Closing the overlay restores the page that was already visible.

## Validation

- Run the TypeScript/Vite production build.
- Click Premium from a non-Settings page and confirm that Settings is not opened.
- Confirm the subscription overlay fills the viewport.
- Confirm closing returns to the original page.
- Confirm plan checkout and Discord-link actions remain available.

## Acceptance Criteria

- Premium opens the subscription cards in a fullscreen overlay.
- The current page remains selected; Settings is never opened by this action.
- The overlay can be closed normally without losing the prior page.
