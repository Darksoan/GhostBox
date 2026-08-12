import type { Page } from "../../types";

/** Pages that only exist for a signed-in account. */
const ACCOUNT_ONLY_PAGES: Page[] = ["profile"];

export function isAccountOnlyPage(page: Page) {
  return ACCOUNT_ONLY_PAGES.includes(page);
}

/**
 * Reconciles the keep-alive mount set for a render.
 *
 * Adding the current page and dropping the signed-out profile used to be two
 * independent render-time state updates. Signing out from inside the profile
 * made them fight each other — one re-added the page the other had just
 * removed — and React aborted the tree with "Too many re-renders". Resolving
 * both rules in one place makes the result a fixed point: feeding the output
 * back in returns the very same Set, so the render-time update runs at most
 * once.
 */
export function resolveMountedPages(input: {
  current: Set<Page>;
  page: Page;
  keepAliveDisabled: boolean;
  isAuthenticated: boolean;
}): Set<Page> {
  const { current, page, keepAliveDisabled, isAuthenticated } = input;
  const isBlocked = (target: Page) =>
    !isAuthenticated && isAccountOnlyPage(target);

  const removals = Array.from(current).filter(isBlocked);
  const shouldAdd =
    !keepAliveDisabled && !current.has(page) && !isBlocked(page);
  if (!shouldAdd && removals.length === 0) return current;

  const next = new Set(current);
  for (const target of removals) next.delete(target);
  if (shouldAdd) next.add(page);
  return next;
}
