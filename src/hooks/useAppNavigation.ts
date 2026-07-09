import { useCallback, useRef, useState } from "react";
import type { Page } from "../types";
import { useSettings } from "../context/settings";
import { runViewTransition } from "../utils/viewTransition";

const historyLimit = 12;

export function useAppNavigation(initialPage: Page = "home") {
  const { appearance } = useSettings();
  const [page, setPageState] = useState<Page>(initialPage);
  const [canGoBack, setCanGoBack] = useState(false);
  const pageHistoryRef = useRef<Page[]>([]);
  const pageScrollPositionsRef = useRef<Partial<Record<Page, number>>>({});
  const pendingPageScrollRestoreRef = useRef<Page | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  const syncCanGoBack = useCallback(() => {
    setCanGoBack(pageHistoryRef.current.length > 0);
  }, []);

  const setPage = useCallback(
    (nextPage: Page) => {
      runViewTransition(
        () => setPageState(nextPage),
        !appearance.disableTabAnimations
      );
    },
    [appearance.disableTabAnimations]
  );

  const navigate = useCallback(
    (newPage: Page) => {
      if (newPage !== page) {
        pageHistoryRef.current = [
          ...pageHistoryRef.current.filter((item) => item !== page),
          page,
        ].slice(-historyLimit);
        pendingPageScrollRestoreRef.current = newPage;
        syncCanGoBack();
        setPage(newPage);
      }
    },
    [page, setPage, syncCanGoBack]
  );

  const back = useCallback(() => {
    let previousPage = pageHistoryRef.current.pop();
    while (previousPage === page) {
      previousPage = pageHistoryRef.current.pop();
    }
    const nextPage = previousPage ?? "home";
    pendingPageScrollRestoreRef.current = nextPage;
    syncCanGoBack();
    setPage(nextPage);
  }, [page, setPage, syncCanGoBack]);

  const saveScrollPosition = useCallback(() => {
    if (contentRef.current) {
      pageScrollPositionsRef.current[page] = contentRef.current.scrollTop;
    }
  }, [page]);

  const restorePendingScroll = useCallback(() => {
    const pendingPage = pendingPageScrollRestoreRef.current;
    if (!pendingPage) return;
    pendingPageScrollRestoreRef.current = null;
    contentRef.current?.scrollTo({
      top: pageScrollPositionsRef.current[pendingPage] ?? 0,
    });
  }, []);

  return {
    page,
    setPage,
    navigate,
    back,
    canGoBack,
    contentRef,
    pageScrollPositionsRef,
    pendingPageScrollRestoreRef,
    saveScrollPosition,
    restorePendingScroll,
  };
}
