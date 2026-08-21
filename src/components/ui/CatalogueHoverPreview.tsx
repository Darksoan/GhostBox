import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Star } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { withCachedImageSources } from "../../utils/imageCache";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  pickDistinctScreenshotSources,
} from "../../utils/cataloguePreview";

const MEDIA_REVEAL_TIMEOUT_MS = 600;

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
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";

  const [displayedGame, setDisplayedGame] = useState<GhostBoxGame | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (game) {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setDisplayedGame(game);

      if (!wasVisibleRef.current) {
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
    if ((isVisible && isMediaReady) || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && previewRef.current?.contains(activeElement)) {
      (activeElement as HTMLElement).blur();
    }
  }, [isVisible, isMediaReady]);

  const screenshotSources = useMemo(
    () =>
      displayedGame
        ? withoutHeaderImageSources(displayedGame.screenshots ?? []).slice(0, 2)
        : [],
    [displayedGame]
  );

  const resolvedScreenshotSources = useCachedImageSources(screenshotSources);
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const cachedScreenshotSources = useMemo(
    () =>
      pickDistinctScreenshotSources(
        screenshotSources.map((source) => withCachedImageSources([source])),
        failedScreenshotSources
      ),
    [screenshotSources, resolvedScreenshotSources, failedScreenshotSources]
  );

  const displayShots = cachedScreenshotSources;

  const [readyScreenshotCount, setReadyScreenshotCount] = useState(0);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");

  useEffect(() => {
    readyScreenshotSourcesRef.current = new Set();
    setReadyScreenshotCount(0);
    setFailedScreenshotSources(new Set());
    setIsMediaReady(false);
  }, [screenshotSourceKey]);

  useEffect(() => {
    if (!displayedGame || isMediaReady) return;

    if (displayShots.length === 0) {
      setIsMediaReady(true);
      return;
    }

    if (readyScreenshotCount > 0) {
      setIsMediaReady(true);
      return;
    }

    const timeoutId = window.setTimeout(
      () => setIsMediaReady(true),
      MEDIA_REVEAL_TIMEOUT_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [displayShots.length, displayedGame, isMediaReady, readyScreenshotCount]);

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
  };

  const handlePreviewPointerEnter = () => {
    onPointerEnter?.();
  };

  const handlePreviewPointerLeave = () => {
    onPointerLeave?.();
  };

  const handlePreviewFocus = () => {
    onPointerEnter?.();
  };

  const handlePreviewBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onPointerLeave?.();
  };

  if (!displayedGame) return null;

  const positiveRatio = displayedGame.steamPositiveRatio;
  const reviewCount = displayedGame.steamReviewCount;
  const hasReviewScore =
    typeof positiveRatio === "number" &&
    Number.isFinite(positiveRatio) &&
    reviewCount != null &&
    reviewCount > 0;
  const ratingText = hasReviewScore
    ? (positiveRatio * 5).toFixed(1)
    : null;
  const developers = displayedGame.developers?.filter(Boolean) ?? [];
  const developerText = developers.join(", ");

  const isPanelVisible = isVisible && isMediaReady;

  return (
    <section
      ref={previewRef}
      className={`catalogue-hover-preview ${
        isPanelVisible
          ? "catalogue-hover-preview--visible"
          : "catalogue-hover-preview--hidden"
      }`}
      aria-label={
        isEnglish
          ? `Preview of ${displayedGame.title}`
          : `Preview de ${displayedGame.title}`
      }
      aria-hidden={!isPanelVisible}
      onPointerEnter={handlePreviewPointerEnter}
      onPointerLeave={handlePreviewPointerLeave}
      onFocusCapture={handlePreviewFocus}
      onBlurCapture={handlePreviewBlur}
    >
      <div className="catalogue-hover-preview__header">
        <div className="catalogue-hover-preview__title-block">
          <strong className="catalogue-hover-preview__title">
            {displayedGame.title}
          </strong>
          {developerText && (
            <span className="catalogue-hover-preview__developer">
              {developerText}
            </span>
          )}
        </div>
        {hasReviewScore && ratingText && (
          <span className="catalogue-hover-preview__rating" aria-label={ratingText}>
            <Star
              size={16}
              fill="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span>{ratingText}</span>
          </span>
        )}
      </div>

      <div className="catalogue-hover-preview__media-stack">
        {displayShots.length > 0 ? (
          displayShots.map((source, index) => (
            <div key={source} className="catalogue-hover-preview__shot">
              <img
                className="catalogue-hover-preview__shot-image"
                src={source}
                alt=""
                aria-hidden="true"
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
                onLoad={(event) => {
                  void markScreenshotReady(source, event.currentTarget);
                }}
                onError={() => markScreenshotFailed(source)}
              />
            </div>
          ))
        ) : (
          <div className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty" />
        )}
      </div>
    </section>
  );
}
