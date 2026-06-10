import { useCallback, useRef, useState } from "react";
import type { Page } from "../types";
import { useSettings } from "../context/settings";
import { runViewTransition } from "../utils/viewTransition";

export function useAppNavigation(initialPage: Page = "home") {
  const { appearance } = useSettings();
  const [page, setPageState] = useState<Page>(initialPage);
  const pageHistoryRef = useRef<Page[]>([]);
  const pageScrollPositionsRef = useRef<Partial<Record<Page, number>>>({});
  const pendingPageScrollRestoreRef = useRef<Page | null>(null);
  const contentRef = useRef<HTMLElement>(null);

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
        ].slice(-12);
        pendingPageScrollRestoreRef.current = newPage;
        setPage(newPage);
      }
    },
    [page, setPage]
  );

  const back = useCallback(() => {
    let previousPage = pageHistoryRef.current.pop();
    while (previousPage === page) {
      previousPage = pageHistoryRef.current.pop();
    }
    const nextPage = previousPage ?? "home";
    pendingPageScrollRestoreRef.current = nextPage;
    setPage(nextPage);
  }, [page, setPage]);

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
    contentRef,
    pageScrollPositionsRef,
    pendingPageScrollRestoreRef,
    saveScrollPosition,
    restorePendingScroll,
  };
}
