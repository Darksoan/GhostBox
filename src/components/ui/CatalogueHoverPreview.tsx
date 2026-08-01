import { useMemo } from "react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";

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

  if (!game) return null;

  const developers = game.developers?.filter(Boolean) ?? [];
  const publishers = game.publishers?.filter(Boolean) ?? [];
  const screenshotAlt = (index: number) =>
    isEnglish
      ? `Screenshot ${index + 1} of ${game.title}`
      : `Screenshot ${index + 1} de ${game.title}`;

  return (
    <section
      className="catalogue-hover-preview"
      aria-label={isEnglish ? `Preview of ${game.title}` : `Preview de ${game.title}`}
    >
      <div className="catalogue-hover-preview__screenshots">
        {cachedScreenshotSources.length > 0 ? (
          cachedScreenshotSources.map((source, index) => (
            <img
              className="catalogue-hover-preview__screenshot"
              key={`${source}-${index}`}
              src={source}
              alt={screenshotAlt(index)}
              loading="lazy"
              decoding="async"
            />
          ))
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
        {publishers.length > 0 && (
          <span className="catalogue-hover-preview__credit">
            <span>{t("catalogue.preview.publisher")}:</span> {publishers.join(", ")}
          </span>
        )}
      </div>
    </section>
  );
}
