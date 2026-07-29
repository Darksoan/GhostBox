import { useCallback, useRef, useState, useLayoutEffect } from "react";
import type { Page } from "../types";

const historyLimit = 24;

type HistoryFlags = {
  canGoBack: boolean;
  canGoForward: boolean;
};

function flagsFromCursor(index: number, length: number): HistoryFlags {
  return {
    canGoBack: index > 0,
    canGoForward: index < length - 1,
  };
}

export function useAppNavigation(initialPage: Page = "home") {
  const [page, setPageState] = useState<Page>(initialPage);
  const [historyFlags, setHistoryFlags] = useState<HistoryFlags>({
    canGoBack: false,
    canGoForward: false,
  });

  // Linear browser-style history with a cursor:
  // - entries before the cursor = back
  // - entries after the cursor  = forward
  const historyRef = useRef<Page[]>([initialPage]);
  const historyIndexRef = useRef(0);
  const pageScrollPositionsRef = useRef<Partial<Record<Page, number>>>({});
  const pendingPageScrollRestoreRef = useRef<Page | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  /** Always the logical current page (updated synchronously on navigate/back/forward). */
  const pageRef = useRef<Page>(initialPage);

  const publishHistoryFlags = useCallback(() => {
    setHistoryFlags(
      flagsFromCursor(historyIndexRef.current, historyRef.current.length)
    );
  }, []);

  const restorePendingScroll = useCallback(() => {
    const pendingPage = pendingPageScrollRestoreRef.current;
    if (!pendingPage) return;
    pendingPageScrollRestoreRef.current = null;
    contentRef.current?.scrollTo({
      top: pageScrollPositionsRef.current[pendingPage] ?? 0,
      behavior: "instant",
    });
  }, []);

  const setPage = useCallback((nextPage: Page) => {
    // Keep pageRef in lockstep so history ops never race a stale page.
    pageRef.current = nextPage;
    // Synchronous commit so keep-alive tabs un-hide and queries/observers
    // (catalogue, virtualizers, image IO) run in the same frame as the click.
    setPageState(nextPage);
  }, []);

  const navigate = useCallback(
    (newPage: Page) => {
      if (newPage === pageRef.current) return;

      // Drop forward entries when branching (browser-style).
      const nextHistory = historyRef.current.slice(
        0,
        historyIndexRef.current + 1
      );
      nextHistory.push(newPage);

      if (nextHistory.length > historyLimit) {
        historyRef.current = nextHistory.slice(nextHistory.length - historyLimit);
      } else {
        historyRef.current = nextHistory;
      }
      historyIndexRef.current = historyRef.current.length - 1;

      pendingPageScrollRestoreRef.current = newPage;
      publishHistoryFlags();
      setPage(newPage);
    },
    [publishHistoryFlags, setPage]
  );

  const back = useCallback(() => {
    if (historyIndexRef.current <= 0) {
      publishHistoryFlags();
      return false;
    }

    historyIndexRef.current -= 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) {
      historyIndexRef.current = 0;
      publishHistoryFlags();
      return false;
    }

    pendingPageScrollRestoreRef.current = target;
    publishHistoryFlags();
    setPage(target);
    return true;
  }, [publishHistoryFlags, setPage]);

  const forward = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) {
      publishHistoryFlags();
      return false;
    }

    historyIndexRef.current += 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) {
      historyIndexRef.current = Math.max(0, historyRef.current.length - 1);
      publishHistoryFlags();
      return false;
    }

    pendingPageScrollRestoreRef.current = target;
    publishHistoryFlags();
    setPage(target);
    return true;
  }, [publishHistoryFlags, setPage]);

  const saveScrollPosition = useCallback(() => {
    const current = pageRef.current;
    if (contentRef.current) {
      pageScrollPositionsRef.current[current] = contentRef.current.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    restorePendingScroll();
  }, [page, restorePendingScroll]);

  return {
    page,
    pageRef,
    setPage,
    navigate,
    back,
    forward,
    canGoBack: historyFlags.canGoBack,
    canGoForward: historyFlags.canGoForward,
    contentRef,
    pageScrollPositionsRef,
    pendingPageScrollRestoreRef,
    saveScrollPosition,
    restorePendingScroll,
  };
}
