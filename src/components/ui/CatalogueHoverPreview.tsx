import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { withCachedImageSources } from "../../utils/imageCache";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  getAdjacentReadyScreenshotSource,
  getNextReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../../utils/cataloguePreview";

const AUTOPLAY_INTERVAL_MS = 3200;

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function CatalogueHoverPreview({
  game,
  onPointerEnter,
  onPointerLeave,
}: CatalogueHoverPreviewProps) {
  const { appearance, t } = useSettings();
  const isEnglish = appearance.language === "en";

  // Kept mounted across `game` briefly going null so the exit transition can
  // play instead of the panel popping out instantly.
  const [displayedGame, setDisplayedGame] = useState<GhostBoxGame | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  const previewRef = useRef<HTMLElement | null>(null);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (game) {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setDisplayedGame(game);

      if (!wasVisibleRef.current) {
        // First appearance: paint hidden, then flip to visible a frame later
        // so the enter transition actually has a state change to animate.
        setIsVisible(false);
        const frameId = requestAnimationFrame(() => {
          wasVisibleRef.current = true;
          setIsVisible(true);
        });
        return () => cancelAnimationFrame(frameId);
      }

      return;
    }

    wasVisibleRef.current = false;
    setIsVisible(false);
    exitTimeoutRef.current = setTimeout(() => {
      exitTimeoutRef.current = null;
      setDisplayedGame(null);
    }, CATALOGUE_PREVIEW_EXIT_TRANSITION_MS);

    return () => {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
    };
  }, [game]);

  useEffect(() => {
    if (isVisible || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && previewRef.current?.contains(activeElement)) {
      (activeElement as HTMLElement).blur();
    }
  }, [isVisible]);

  const screenshotSources = useMemo(
    () =>
      displayedGame
        ? withoutHeaderImageSources(displayedGame.screenshots ?? []).slice(0, 3)
        : [],
    [displayedGame]
  );
  // Drives cache/manifest resolution and re-renders when a better URL lands.
  const resolvedScreenshotSources = useCachedImageSources(screenshotSources);
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // One source per screenshot: the resolved list holds several candidate URLs
  // for the same picture, and cycling through those looked like a dead chevron.
  const cachedScreenshotSources = useMemo(
    () =>
      pickDistinctScreenshotSources(
        screenshotSources.map((source) => withCachedImageSources([source])),
        failedScreenshotSources
      ),
    [screenshotSources, resolvedScreenshotSources, failedScreenshotSources]
  );
  const [activeScreenshotSource, setActiveScreenshotSource] = useState<
    string | null
  >(null);
  const [readyScreenshotCount, setReadyScreenshotCount] = useState(0);
  const [isAutoplayPaused, setIsAutoplayPaused] = useState(false);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");
  const screenshotKey = cachedScreenshotSources.join("\n");

  useEffect(() => {
    readyScreenshotSourcesRef.current = new Set();
    setReadyScreenshotCount(0);
    setFailedScreenshotSources(new Set());
    setActiveScreenshotSource(null);
  }, [screenshotSourceKey]);

  useEffect(() => {
    setActiveScreenshotSource((currentSource) => {
      if (currentSource && cachedScreenshotSources.includes(currentSource)) {
        return currentSource;
      }

      return getNextReadyScreenshotSource(
        cachedScreenshotSources,
        readyScreenshotSourcesRef.current,
        null
      );
    });
  }, [cachedScreenshotSources]);

  useEffect(() => {
    if (
      cachedScreenshotSources.length <= 1 ||
      isAutoplayPaused ||
      prefersReducedMotion
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveScreenshotSource((currentSource) =>
        getNextReadyScreenshotSource(
          cachedScreenshotSources,
          readyScreenshotSourcesRef.current,
          currentSource
        )
      );
    }, AUTOPLAY_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [cachedScreenshotSources, isAutoplayPaused, prefersReducedMotion, screenshotKey]);

  const navigateScreenshot = (direction: "previous" | "next") => {
    setActiveScreenshotSource((currentSource) =>
      getAdjacentReadyScreenshotSource(
        cachedScreenshotSources,
        readyScreenshotSourcesRef.current,
        currentSource,
        direction
      )
    );
  };

  const handlePreviewPointerEnter = () => {
    setIsAutoplayPaused(true);
    onPointerEnter?.();
  };

  const handlePreviewPointerLeave = () => {
    setIsAutoplayPaused(false);
    onPointerLeave?.();
  };

  const handlePreviewFocus = () => {
    setIsAutoplayPaused(true);
    onPointerEnter?.();
  };

  const handlePreviewBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsAutoplayPaused(false);
    onPointerLeave?.();
  };

  if (!displayedGame) return null;

  const developers = displayedGame.developers?.filter(Boolean) ?? [];
  const screenshotAlt = (index: number) =>
    isEnglish
      ? `Screenshot ${index + 1} of ${displayedGame.title}`
      : `Screenshot ${index + 1} de ${displayedGame.title}`;
  // A broken candidate must step aside so the group falls back to the next URL.
  const markScreenshotFailed = (source: string) => {
    readyScreenshotSourcesRef.current.delete(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
    setFailedScreenshotSources((currentFailed) => {
      if (currentFailed.has(source)) return currentFailed;
      const nextFailed = new Set(currentFailed);
      nextFailed.add(source);
      return nextFailed;
    });
  };
  const markScreenshotReady = async (
    source: string,
    image: HTMLImageElement
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (!cachedScreenshotSources.includes(source)) return;

    if (readyScreenshotSourcesRef.current.has(source)) return;
    readyScreenshotSourcesRef.current.add(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
    setActiveScreenshotSource((currentSource) =>
      currentSource && readyScreenshotSourcesRef.current.has(currentSource)
        ? currentSource
        : getNextReadyScreenshotSource(
            cachedScreenshotSources,
            readyScreenshotSourcesRef.current,
            null
          )
    );
  };

  return (
    <section
      ref={previewRef}
      className={`catalogue-hover-preview ${
        isVisible ? "catalogue-hover-preview--visible" : "catalogue-hover-preview--hidden"
      }`}
      aria-label={
        isEnglish
          ? `Preview of ${displayedGame.title}`
          : `Preview de ${displayedGame.title}`
      }
      aria-hidden={!isVisible}
      onPointerEnter={handlePreviewPointerEnter}
      onPointerLeave={handlePreviewPointerLeave}
      onFocusCapture={handlePreviewFocus}
      onBlurCapture={handlePreviewBlur}
    >
      <div className="catalogue-hover-preview__screenshots">
        {cachedScreenshotSources.length > 0 ? (
          cachedScreenshotSources.map((source, index) => {
            const isActive = source === activeScreenshotSource;
            return (
              <img
                className={`catalogue-hover-preview__screenshot${
                  isActive ? " catalogue-hover-preview__screenshot--active" : ""
                }`}
                key={source}
                src={source}
                alt={isActive ? screenshotAlt(index) : ""}
                aria-hidden={!isActive}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
                tabIndex={-1}
                onLoad={(event) => {
                  void markScreenshotReady(source, event.currentTarget);
                }}
                onError={() => markScreenshotFailed(source)}
              />
            );
          })
        ) : (
          <div className="catalogue-hover-preview__empty-media" />
        )}

        {cachedScreenshotSources.length > 1 && (
          <>
            <button
              className="catalogue-hover-preview__control catalogue-hover-preview__control--previous"
              type="button"
              aria-label={t("catalogue.preview.previousScreenshot")}
              disabled={readyScreenshotCount < 2}
              tabIndex={isVisible ? 0 : -1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                navigateScreenshot("previous");
              }}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="catalogue-hover-preview__control catalogue-hover-preview__control--next"
              type="button"
              aria-label={t("catalogue.preview.nextScreenshot")}
              disabled={readyScreenshotCount < 2}
              tabIndex={isVisible ? 0 : -1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                navigateScreenshot("next");
              }}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      <div className="catalogue-hover-preview__details" aria-live="polite">
        <strong className="catalogue-hover-preview__title">
          {displayedGame.title}
        </strong>
        {developers.length > 0 && (
          <span className="catalogue-hover-preview__credit">
            {developers.join(", ")}
          </span>
        )}
      </div>
    </section>
  );
}
