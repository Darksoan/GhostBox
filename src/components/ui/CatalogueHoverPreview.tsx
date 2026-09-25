import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { Flame } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { gameCataloguePreviewScreenshotSourceGroups } from "../../utils/image";
import {
  cacheImageSourceAfterLoad,
  forgetCachedImageSource,
  getCachedImageSource,
  loadedImageSources,
  markImageSourceLoaded,
} from "../../utils/imageCache";
import { getSteamReviewScore } from "../../utils/gameMetrics";

type PreviewShotStatus = "resolving" | "loading" | "ready" | "failed";

type PreviewShot = {
  candidates: string[];
  candidateIndex: number;
  source: string;
  status: PreviewShotStatus;
};

type PreviewBatch = {
  game: GhostBoxGame;
  key: string;
  generation: number;
  shots: PreviewShot[];
};

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  paused?: boolean;
  onOpenGame?: (game: GhostBoxGame) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

function isSettled(shot: PreviewShot) {
  return shot.status === "ready" || shot.status === "failed";
}

export function CatalogueHoverPreview({
  game,
  paused = false,
  onOpenGame,
  onPointerEnter,
  onPointerLeave,
}: CatalogueHoverPreviewProps) {
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";
  const previewRef = useRef<HTMLElement | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef<PreviewBatch | null>(null);
  const displayedRef = useRef<PreviewBatch | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PreviewBatch | null>(null);
  const [displayedPreview, setDisplayedPreview] = useState<PreviewBatch | null>(
    null
  );

  const screenshotGroups = useMemo(
    () => (game ? gameCataloguePreviewScreenshotSourceGroups(game) : []),
    [game?.id, game?.screenshots]
  );
  const previewKey = game
    ? `${game.id}\n${screenshotGroups.map((group) => group.join("\u0001")).join("\u0002")}`
    : "";

  const updatePending = (
    generation: number,
    update: (batch: PreviewBatch) => PreviewBatch
  ) => {
    setPendingPreview((current) => {
      if (!current || current.generation !== generation) return current;
      const next = update(current);
      pendingRef.current = next;
      return next;
    });
  };

  const resolvePendingShot = (
    generation: number,
    shotIndex: number,
    candidateIndex: number
  ) => {
    const candidate = pendingRef.current?.shots[shotIndex]?.candidates[candidateIndex];
    if (!candidate) {
      updatePending(generation, (batch) => ({
        ...batch,
        shots: batch.shots.map((shot, index) =>
          index === shotIndex ? { ...shot, status: "failed", source: "" } : shot
        ),
      }));
      return;
    }

    // A native cache miss starts a download before returning a source. On hover
    // that held back the preview behind IPC + network; use an existing cached
    // file or let the WebView load the thumbnail immediately.
    const source = getCachedImageSource(candidate) || candidate;
    updatePending(generation, (batch) => ({
      ...batch,
      shots: batch.shots.map((shot, index) =>
        index === shotIndex && shot.candidateIndex === candidateIndex
          ? {
              ...shot,
              source,
              status: loadedImageSources.has(source) ? "ready" : "loading",
            }
          : shot
      ),
    }));
  };

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (paused) {
      pendingRef.current = null;
      setPendingPreview(null);
      return;
    }

    if (!game) {
      pendingRef.current = null;
      displayedRef.current = null;
      setPendingPreview(null);
      setDisplayedPreview(null);
      return;
    }

    if (displayedRef.current?.key === previewKey && displayedRef.current.shots.every(isSettled)) {
      pendingRef.current = null;
      setPendingPreview(null);
      return;
    }

    const batch: PreviewBatch = {
      game,
      key: previewKey,
      generation,
      shots: screenshotGroups.map((candidates) => ({
        candidates,
        candidateIndex: 0,
        source: "",
        status: "resolving",
      })),
    };
    pendingRef.current = batch;
    setPendingPreview(batch);
    // The title and already-known metrics can paint right away; each image
    // fills its own slot when ready instead of gating the entire preview.
    displayedRef.current = batch;
    setDisplayedPreview(batch);

    batch.shots.forEach((_, shotIndex) => {
      resolvePendingShot(generation, shotIndex, 0);
    });

    return () => {
      if (generationRef.current === generation) pendingRef.current = null;
    };
  }, [game, paused, previewKey, screenshotGroups]);

  useEffect(() => {
    if (!pendingPreview) return;
    if (pendingRef.current?.generation !== pendingPreview.generation) return;

    displayedRef.current = pendingPreview;
    setDisplayedPreview(pendingPreview);
    if (!pendingPreview.shots.every(isSettled)) return;
    pendingRef.current = null;
    setPendingPreview(null);
  }, [pendingPreview]);

  const markPendingReady = async (
    shotIndex: number,
    source: string,
    image: HTMLImageElement,
    generation: number
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }

    updatePending(generation, (batch) => ({
      ...batch,
      shots: batch.shots.map((shot, index) => {
        if (index !== shotIndex || shot.source !== source) return shot;
        markImageSourceLoaded(source);
        cacheImageSourceAfterLoad(source);
        return { ...shot, status: "ready" };
      }),
    }));
  };

  const markPendingFailed = (
    shotIndex: number,
    source: string,
    generation: number
  ) => {
    const batch = pendingRef.current;
    const shot = batch?.shots[shotIndex];
    if (!batch || batch.generation !== generation || shot?.source !== source) return;

    forgetCachedImageSource(source);
    const nextIndex = shot.candidateIndex + 1;
    updatePending(generation, (current) => ({
      ...current,
      shots: current.shots.map((currentShot, index) =>
        index === shotIndex
          ? {
              ...currentShot,
              candidateIndex: nextIndex,
              source: "",
              status: "resolving",
            }
          : currentShot
      ),
    }));
    resolvePendingShot(generation, shotIndex, nextIndex);
  };

  const handlePreviewFocus = () => onPointerEnter?.();

  const handlePreviewBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onPointerLeave?.();
  };

  const screenshotLoaderStyle = {
    position: "absolute" as const,
    width: 0,
    height: 0,
    overflow: "hidden" as const,
    pointerEvents: "none" as const,
  };
  const pendingLoaders = pendingPreview && pendingPreview.shots.length > 0 && (
    <div aria-hidden="true" style={screenshotLoaderStyle}>
      {pendingPreview.shots.map((shot, index) =>
        shot.status === "loading" && shot.source ? (
          <img
            key={`${pendingPreview.generation}-${index}-${shot.source}`}
            src={shot.source}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            onLoad={(event) => {
              void markPendingReady(
                index,
                shot.source,
                event.currentTarget,
                pendingPreview.generation
              );
            }}
            onError={() =>
              markPendingFailed(index, shot.source, pendingPreview.generation)
            }
          />
        ) : null
      )}
    </div>
  );

  if (!displayedPreview) return pendingLoaders;

  const displayedGame = displayedPreview.game;
  const reviewScore = getSteamReviewScore(displayedGame);
  const ratingText = reviewScore
    ? ((reviewScore.percent / 100) * 5).toFixed(1)
    : null;
  const developers = displayedGame.developers?.filter(Boolean) ?? [];
  const developerText = developers.join(", ");

  return (
    <section
      ref={previewRef}
      className="catalogue-hover-preview"
      aria-label={
        isEnglish
          ? `Preview of ${displayedGame.title}`
          : `Preview de ${displayedGame.title}`
      }
      aria-busy={Boolean(pendingPreview)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
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
        {ratingText && (
          <span className="catalogue-hover-preview__rating" aria-label={ratingText}>
            <Flame
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
        {displayedPreview.shots.length > 0 ? (
          displayedPreview.shots.map((shot, index) =>
            shot.status === "ready" && shot.source ? (
              <button
                key={shot.candidates[0] ?? index}
                type="button"
                className="catalogue-hover-preview__shot catalogue-hover-preview__shot--link"
                aria-label={
                  isEnglish
                    ? `Open ${displayedGame.title}`
                    : `Abrir ${displayedGame.title}`
                }
                onClick={() => onOpenGame?.(displayedGame)}
              >
                <img
                  className="catalogue-hover-preview__shot-image"
                  src={shot.source}
                  alt=""
                  aria-hidden="true"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => markImageSourceLoaded(shot.source)}
                />
              </button>
            ) : (
              <div
                key={shot.candidates[0] ?? index}
                className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty"
                aria-hidden="true"
              />
            )
          )
        ) : (
          <div className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty" />
        )}
      </div>

      {pendingLoaders}
    </section>
  );
}
