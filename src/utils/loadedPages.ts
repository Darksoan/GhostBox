import type { Page } from "../types";

/**
 * Tracks which page chunks have already been imported at least once.
 * Populated by PageRouter as each lazy import resolves, and consulted by
 * useAppNavigation to decide whether a tab switch can use the View Transitions
 * API (page already loaded) or must fall back to a plain state update (chunk
 * still loading, avoid double-paint crossfade with the Suspense placeholder).
 */
const loadedPages = new Set<Page>();

export function markPageLoaded(page: Page): void {
  loadedPages.add(page);
}
