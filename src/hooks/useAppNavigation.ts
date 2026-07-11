import {
  useCallback,
  useRef,
  useState,
  startTransition,
  useLayoutEffect,
} from "react";
import type { Page } from "../types";
import { useSettings } from "../context/settings";
import { runViewTransition } from "../utils/viewTransition";
import { isPageLoaded } from "../utils/loadedPages";

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
  const { appearance } = useSettings();
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
    });
  }, []);

  const setPage = useCallback(
    (nextPage: Page) => {
      // Sync before any deferred visual transition so history ops never race
      // against a stale pageRef (View Transition / rAF).
      pageRef.current = nextPage;

      const animationsEnabled = !appearance.disableTabAnimations;
      const ready = isPageLoaded(nextPage);
      const useTransitionApi = animationsEnabled && ready;

      const apply = () => {
        startTransition(() => {
          setPageState(nextPage);
        });
        if (useTransitionApi) {
          restorePendingScroll();
        }
      };

      if (useTransitionApi) {
        window.requestAnimationFrame(() => {
          runViewTransition(apply, true);
        });
      } else {
        apply();
      }
    },
    [appearance.disableTabAnimations, restorePendingScroll]
  );

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
    const pendingPage = pendingPageScrollRestoreRef.current;
    if (!pendingPage) return;
    if (isPageLoaded(pendingPage)) {
      return;
    }
    pendingPageScrollRestoreRef.current = null;
    contentRef.current?.scrollTo({
      top: pageScrollPositionsRef.current[pendingPage] ?? 0,
    });
  }, [page]);

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
