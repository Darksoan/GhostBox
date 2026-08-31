import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Flame } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { withCachedImageSources } from "../../utils/imageCache";
import { loadedImageSources } from "../../utils/imageCache";
import { getSteamReviewScore } from "../../utils/gameMetrics";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  CATALOGUE_PREVIEW_PENDING_HOLD_MS,
  pickDistinctScreenshotSources,
} from "../../utils/cataloguePreview";

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  /** Clique em uma shot pronta abre o modal do jogo em preview. */
  onOpenGame?: (game: GhostBoxGame) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function CatalogueHoverPreview({
  game,
  onOpenGame,
  onPointerEnter,
  onPointerLeave,
}: CatalogueHoverPreviewProps) {
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";

  const [displayedGame, setDisplayedGame] = useState<GhostBoxGame | null>(null);
  const [pendingGame, setPendingGame] = useState<GhostBoxGame | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  const displayedGameRef = useRef<GhostBoxGame | null>(null);
  const pendingGameRef = useRef<GhostBoxGame | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    displayedGameRef.current = displayedGame;
  }, [displayedGame]);

  useEffect(() => {
    pendingGameRef.current = pendingGame;
  }, [pendingGame]);

  // Guarda último preview pronto para servir como stale enquanto o próximo decodifica.
  // Evita piscar skeleton a cada troca rápida.
  const prevDisplayShotsRef = useRef<string[]>([]);
  const prevGameRef = useRef<GhostBoxGame | null>(null);

  const screenshotSources = useMemo(
    () =>
      displayedGame
        ? withoutHeaderImageSources(displayedGame.screenshots ?? []).slice(0, 3)
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

  // Pending game sources (mesmo pipeline, mas separado para não contaminar displayed)
  const pendingScreenshotSources = useMemo(
    () =>
      pendingGame
        ? withoutHeaderImageSources(pendingGame.screenshots ?? []).slice(0, 3)
        : [],
    [pendingGame]
  );

  const pendingResolvedSources = useCachedImageSources(pendingScreenshotSources);

  const [pendingReadyCount, setPendingReadyCount] = useState(0);
  const pendingReadySourcesRef = useRef<Set<string>>(new Set());
  const [pendingFailedSources, setPendingFailedSources] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const pendingSourceKey = pendingScreenshotSources.join("\n");

  const pendingCachedSources = useMemo(() => {
    if (!pendingGame) return [];
    return pickDistinctScreenshotSources(
      pendingScreenshotSources.map((source) => withCachedImageSources([source])),
      pendingFailedSources
    );
  }, [pendingScreenshotSources, pendingGame, pendingResolvedSources, pendingFailedSources]);

  const pendingDisplayShots = pendingCachedSources;

  const [readyScreenshotCount, setReadyScreenshotCount] = useState(0);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");

  useEffect(() => {
    if (displayShots.length === 0) {
      readyScreenshotSourcesRef.current = new Set();
      setReadyScreenshotCount(0);
      setFailedScreenshotSources(new Set());
      setIsMediaReady(true);
      return;
    }
    const allLoaded = displayShots.every((src) => loadedImageSources.has(src));
    if (allLoaded) {
      readyScreenshotSourcesRef.current = new Set(displayShots);
      setReadyScreenshotCount(displayShots.length);
      setFailedScreenshotSources(new Set());
      setIsMediaReady(true);
      return;
    }
    readyScreenshotSourcesRef.current = new Set();
    setReadyScreenshotCount(0);
    setFailedScreenshotSources(new Set());
    setIsMediaReady(false);
  }, [screenshotSourceKey, displayShots]);

  useEffect(() => {
    pendingReadySourcesRef.current = new Set();
    setPendingReadyCount(0);
    setPendingFailedSources(new Set());
  }, [pendingSourceKey]);

  // Atualiza stale refs quando o displayed fica pronto
  useEffect(() => {
    if (isMediaReady && displayShots.length > 0) {
      prevDisplayShotsRef.current = displayShots;
      prevGameRef.current = displayedGame;
    }
    // Quando displayed tem 0 shots (vazio) também guarda para não piscar skeleton
    if (isMediaReady && displayShots.length === 0 && displayedGame) {
      prevDisplayShotsRef.current = [];
      prevGameRef.current = displayedGame;
    }
  }, [isMediaReady, displayShots, displayedGame]);

  useEffect(() => {
    if (!displayedGame || isMediaReady) return;

    if (displayShots.length === 0) {
      setIsMediaReady(true);
      return;
    }

    // Sem progressivo: só libera quando 100% das shots decodificaram
    if (readyScreenshotCount >= displayShots.length) {
      setIsMediaReady(true);
    }
  }, [displayShots.length, displayedGame, isMediaReady, readyScreenshotCount]);

  // Commit do pending quando pronto (fast-path cache incluso)
  useEffect(() => {
    if (!pendingGame) return;

    if (pendingDisplayShots.length === 0) {
      setDisplayedGame(pendingGame);
      setPendingGame(null);
      return;
    }

    // Fast-path: todas as shots já estão em loadedImageSources -> commit síncrono
    const allCached = pendingDisplayShots.every((src) => loadedImageSources.has(src));
    if (allCached) {
      setDisplayedGame(pendingGame);
      setPendingGame(null);
      return;
    }

    if (pendingReadyCount >= pendingDisplayShots.length) {
      setDisplayedGame(pendingGame);
      setPendingGame(null);
    }
  }, [pendingGame, pendingDisplayShots, pendingReadyCount]);

  // Timeout fallback: se pending não resolveu em 250ms, comita mesmo assim e deixa stale
  useEffect(() => {
    if (!pendingGame) {
      if (pendingHoldTimeoutRef.current !== null) {
        clearTimeout(pendingHoldTimeoutRef.current);
        pendingHoldTimeoutRef.current = null;
      }
      return;
    }

    pendingHoldTimeoutRef.current = setTimeout(() => {
      pendingHoldTimeoutRef.current = null;
      if (pendingGameRef.current) {
        setDisplayedGame(pendingGameRef.current);
        setPendingGame(null);
      }
    }, CATALOGUE_PREVIEW_PENDING_HOLD_MS);

    return () => {
      if (pendingHoldTimeoutRef.current !== null) {
        clearTimeout(pendingHoldTimeoutRef.current);
        pendingHoldTimeoutRef.current = null;
      }
    };
  }, [pendingGame]);

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
    loadedImageSources.add(source);
    readyScreenshotSourcesRef.current.add(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
  };

  const markPendingFailed = (source: string) => {
    pendingReadySourcesRef.current.delete(source);
    setPendingReadyCount(pendingReadySourcesRef.current.size);
    setPendingFailedSources((currentFailed) => {
      if (currentFailed.has(source)) return currentFailed;
      const next = new Set(currentFailed);
      next.add(source);
      return next;
    });
  };

  const markPendingReady = async (source: string, image: HTMLImageElement) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (!pendingDisplayShots.includes(source)) return;
    if (pendingReadySourcesRef.current.has(source)) return;
    loadedImageSources.add(source);
    pendingReadySourcesRef.current.add(source);
    setPendingReadyCount(pendingReadySourcesRef.current.size);
  };

  // Lógica principal de troca com hold
  useEffect(() => {
    if (game) {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }

      if (!wasVisibleRef.current) {
        setDisplayedGame(game);
        setPendingGame(null);
        if (pendingHoldTimeoutRef.current !== null) {
          clearTimeout(pendingHoldTimeoutRef.current);
          pendingHoldTimeoutRef.current = null;
        }

        setIsVisible(false);
        const frameId = requestAnimationFrame(() => {
          wasVisibleRef.current = true;
          setIsVisible(true);
        });
        return () => cancelAnimationFrame(frameId);
      }

      if (displayedGameRef.current?.id === game.id) {
        // Voltou ao exibido: cancela pending
        if (pendingGameRef.current) {
          setPendingGame(null);
        }
        return;
      }

      if (pendingGameRef.current?.id === game.id) {
        return;
      }

      // Troca com painel visível: hold até pending pronto (sem fade, sem skeleton)
      setPendingGame(game);

      return;
    }

    wasVisibleRef.current = false;
    setPendingGame(null);
    if (pendingHoldTimeoutRef.current !== null) {
      clearTimeout(pendingHoldTimeoutRef.current);
      pendingHoldTimeoutRef.current = null;
    }
    setIsVisible(false);
    exitTimeoutRef.current = setTimeout(() => {
      exitTimeoutRef.current = null;
      setDisplayedGame(null);
      prevDisplayShotsRef.current = [];
      prevGameRef.current = null;
    }, CATALOGUE_PREVIEW_EXIT_TRANSITION_MS);

    return () => {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
    };
  }, [game]);

  useEffect(() => {
    return () => {
      if (pendingHoldTimeoutRef.current !== null) {
        clearTimeout(pendingHoldTimeoutRef.current);
        pendingHoldTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isVisible || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && previewRef.current?.contains(activeElement)) {
      (activeElement as HTMLElement).blur();
    }
  }, [isVisible]);

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

  // Mesma guarda do card de "Bem avaliados" (ver `getSteamReviewScore`): sem
  // amostra de review, a razão volta 0 e viraria uma nota 0,0 falsa.
  const reviewScore = getSteamReviewScore(displayedGame);
  const ratingText = reviewScore
    ? ((reviewScore.percent / 100) * 5).toFixed(1)
    : null;
  const developers = displayedGame.developers?.filter(Boolean) ?? [];
  const developerText = developers.join(", ");

  const isPanelVisible = isVisible;
  const isShotsReady = isMediaReady;
  const hasStaleShots = prevDisplayShotsRef.current.length > 0;
  const showStale = !isShotsReady && hasStaleShots && displayShots.length > 0;
  const shotsToRender = isShotsReady ? displayShots : showStale ? prevDisplayShotsRef.current : displayShots;

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
      aria-busy={showStale || !!pendingGame}
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
        {isShotsReady ? (
          displayShots.length > 0 ? (
            displayShots.map((source, index) => (
              <button
                key={source}
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
              </button>
            ))
          ) : (
            <div className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty" />
          )
        ) : showStale ? (
          <>
            {shotsToRender.map((source) => (
              <button
                key={`stale-${source}`}
                type="button"
                className="catalogue-hover-preview__shot catalogue-hover-preview__shot--link catalogue-hover-preview__shot--stale"
                aria-label={
                  isEnglish
                    ? `Open ${displayedGame.title}`
                    : `Abrir ${displayedGame.title}`
                }
                onClick={() => onOpenGame?.(displayedGame)}
                aria-busy="true"
              >
                <img
                  className="catalogue-hover-preview__shot-image"
                  src={source}
                  alt=""
                  aria-hidden="true"
                  loading="eager"
                  decoding="async"
                />
              </button>
            ))}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              {displayShots.map((source, index) => (
                <img
                  key={`stale-preload-${source}`}
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
              ))}
            </div>
          </>
        ) : displayShots.length > 0 ? (
          <>
            {Array.from({ length: 3 } as unknown as string[])
              .slice(0, Math.min(3, displayShots.length || 3))
              .map((_, index) => (
                <div
                  key={`skeleton-${index}`}
                  className="catalogue-hover-preview__shot catalogue-hover-preview__shot--skeleton skeleton"
                  aria-hidden="true"
                />
              ))}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              {displayShots.map((source, index) => (
                <img
                  key={source}
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
              ))}
            </div>
          </>
        ) : (
          <>
            {Array.from({ length: 3 } as unknown as string[]).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="catalogue-hover-preview__shot catalogue-hover-preview__shot--skeleton skeleton"
                aria-hidden="true"
              />
            ))}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              {displayShots.map((source, index) => (
                <img
                  key={source}
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
              ))}
            </div>
          </>
        )}
      </div>

      {/* Preload oculto do pendingGame: decodifica em background para hold */}
      {pendingGame && pendingDisplayShots.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          {pendingDisplayShots.map((source, index) => (
            <img
              key={`pending-${source}`}
              src={source}
              alt=""
              aria-hidden="true"
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={index === 0 ? "high" : "low"}
              onLoad={(event) => {
                void markPendingReady(source, event.currentTarget);
              }}
              onError={() => markPendingFailed(source)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
