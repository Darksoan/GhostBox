import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { getNextReadyScreenshotSource } from "../../utils/cataloguePreview";

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
}

export function CatalogueHoverPreview({ game }: CatalogueHoverPreviewProps) {
  const { appearance, t } = useSettings();
  const isEnglish = appearance.language === "en";
  const screenshotSources = useMemo(
    () =>
      game
        ? withoutHeaderImageSources(game.screenshots ?? []).slice(0, 3)
        : [],
    [game]
  );
  const cachedScreenshotSources = useCachedImageSources(screenshotSources);
  const [activeScreenshotSource, setActiveScreenshotSource] = useState<
    string | null
  >(null);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");
  const screenshotKey = cachedScreenshotSources.join("\n");

  useEffect(() => {
    readyScreenshotSourcesRef.current = new Set();
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
    if (cachedScreenshotSources.length <= 1) return;

    const intervalId = window.setInterval(() => {
      setActiveScreenshotSource((currentSource) =>
        getNextReadyScreenshotSource(
          cachedScreenshotSources,
          readyScreenshotSourcesRef.current,
          currentSource
        )
      );
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [cachedScreenshotSources, screenshotKey]);

  if (!game) return null;

  const developers = game.developers?.filter(Boolean) ?? [];
  const screenshotAlt = (index: number) =>
    isEnglish
      ? `Screenshot ${index + 1} of ${game.title}`
      : `Screenshot ${index + 1} de ${game.title}`;
  const markScreenshotReady = async (
    source: string,
    image: HTMLImageElement
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (!cachedScreenshotSources.includes(source)) return;

    readyScreenshotSourcesRef.current.add(source);
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
      className="catalogue-hover-preview"
      aria-label={isEnglish ? `Preview of ${game.title}` : `Preview de ${game.title}`}
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
                loading="eager"
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
                onLoad={(event) => {
                  void markScreenshotReady(source, event.currentTarget);
                }}
              />
            );
          })
        ) : (
          <div className="catalogue-hover-preview__empty-media" />
        )}
      </div>

      <div className="catalogue-hover-preview__details" aria-live="polite">
        <strong className="catalogue-hover-preview__title">{game.title}</strong>
        {developers.length > 0 && (
          <span className="catalogue-hover-preview__credit">
            <span>{t("catalogue.preview.developer")}:</span> {developers.join(", ")}
          </span>
        )}
      </div>
    </section>
  );
}
