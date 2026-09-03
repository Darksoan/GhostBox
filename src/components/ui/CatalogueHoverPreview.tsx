import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
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
  paused?: boolean;
  /** Clique em uma shot pronta abre o modal do jogo em preview. */
  onOpenGame?: (game: GhostBoxGame) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
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

  const screenshotSources = useMemo(
    () =>
      displayedGame
        ? withoutHeaderImageSources(displayedGame.screenshots ?? []).slice(0, 1)
        : [],
    [displayedGame?.screenshots]
  );

  // O <img> baixa a shot; evita repetir o mesmo download pelo cache nativo.
  const resolvedScreenshotSources = useCachedImageSources(screenshotSources, {
    resolveUncached: false,
  });
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const cachedScreenshotSources = useMemo(
    () =>
      pickDistinctScreenshotSources(
        screenshotSources.map((source) => withCachedImageSources([source])),
        failedScreenshotSources,
        loadedImageSources
      ),
    [screenshotSources, resolvedScreenshotSources, failedScreenshotSources]
  );

  const displayShots = cachedScreenshotSources;

  // Pending game sources (mesmo pipeline, mas separado para não contaminar displayed)
  const pendingScreenshotSources = useMemo(
    () =>
      pendingGame
        ? withoutHeaderImageSources(pendingGame.screenshots ?? []).slice(0, 1)
        : [],
    [pendingGame]
  );

  const pendingResolvedSources = useCachedImageSources(pendingScreenshotSources, {
    resolveUncached: false,
  });

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
      pendingFailedSources,
      loadedImageSources
    );
  }, [pendingScreenshotSources, pendingGame, pendingResolvedSources, pendingFailedSources]);

  const pendingDisplayShots = pendingCachedSources;

  const [readyScreenshotCount, setReadyScreenshotCount] = useState(0);
  const readyScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const screenshotSourceKey = screenshotSources.join("\n");
  const screenshotGenerationRef = useRef(0);
  const previousScreenshotSourceKeyRef = useRef(screenshotSourceKey);
  if (previousScreenshotSourceKeyRef.current !== screenshotSourceKey) {
    previousScreenshotSourceKeyRef.current = screenshotSourceKey;
    screenshotGenerationRef.current += 1;
  }
  const screenshotGeneration = screenshotGenerationRef.current;
  const pendingGenerationRef = useRef(0);
  const previousPendingSourceKeyRef = useRef(pendingSourceKey);
  if (previousPendingSourceKeyRef.current !== pendingSourceKey) {
    previousPendingSourceKeyRef.current = pendingSourceKey;
    pendingGenerationRef.current += 1;
  }
  const pendingGeneration = pendingGenerationRef.current;

  useEffect(() => {
    readyScreenshotSourcesRef.current = new Set();
    setReadyScreenshotCount(0);
    setIsMediaReady(screenshotSourceKey.length === 0);
    setFailedScreenshotSources((current) =>
      current.size === 0 ? current : new Set()
    );
  }, [screenshotSourceKey]);

  useEffect(() => {
    const readySources = new Set(
      displayShots.filter((source) => loadedImageSources.has(source))
    );
    readyScreenshotSourcesRef.current = readySources;
    setReadyScreenshotCount((current) =>
      current === readySources.size ? current : readySources.size
    );
    const firstReady =
      displayShots.length === 0 || readySources.has(displayShots[0]);
    setIsMediaReady((current) =>
      current === firstReady ? current : firstReady
    );
  }, [screenshotSourceKey, displayShots, readyScreenshotCount]);

  useEffect(() => {
    pendingReadySourcesRef.current = new Set();
    setPendingReadyCount(0);
    setPendingFailedSources((current) =>
      current.size === 0 ? current : new Set()
    );
  }, [pendingSourceKey]);

  // Commit do pending quando pronto (fast-path cache incluso)
  useEffect(() => {
    if (!pendingGame || paused) return;

    if (pendingDisplayShots.length === 0) {
      setDisplayedGame(pendingGame);
      setPendingGame(null);
      return;
    }

    // Fast-path: a primeira shot já está em cache -> commit síncrono.
    const firstPending = pendingDisplayShots[0];
    const firstReady =
      Boolean(firstPending) &&
      (loadedImageSources.has(firstPending) ||
        pendingReadySourcesRef.current.has(firstPending));
    if (firstReady) {
      setDisplayedGame(pendingGame);
      setPendingGame(null);
      return;
    }

  }, [paused, pendingGame, pendingDisplayShots, pendingReadyCount]);

  // Timeout fallback: se pending não resolveu em 250ms, comita mesmo assim.
  useEffect(() => {
    if (!pendingGame || paused) {
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
  }, [paused, pendingGame]);

  const markScreenshotFailed = (source: string, generation: number) => {
    if (
      generation !== screenshotGenerationRef.current ||
      !cachedScreenshotSources.includes(source)
    )
      return;
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
    image: HTMLImageElement,
    generation: number
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (
      generation !== screenshotGenerationRef.current ||
      !cachedScreenshotSources.includes(source)
    )
      return;
    if (readyScreenshotSourcesRef.current.has(source)) return;
    loadedImageSources.add(source);
    readyScreenshotSourcesRef.current.add(source);
    setReadyScreenshotCount(readyScreenshotSourcesRef.current.size);
  };

  const markPendingFailed = (source: string, generation: number) => {
    if (
      generation !== pendingGenerationRef.current ||
      !pendingDisplayShots.includes(source)
    )
      return;
    pendingReadySourcesRef.current.delete(source);
    setPendingReadyCount(pendingReadySourcesRef.current.size);
    setPendingFailedSources((currentFailed) => {
      if (currentFailed.has(source)) return currentFailed;
      const next = new Set(currentFailed);
      next.add(source);
      return next;
    });
  };

  const markPendingReady = async (
    source: string,
    image: HTMLImageElement,
    generation: number
  ) => {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    if (
      generation !== pendingGenerationRef.current ||
      !pendingDisplayShots.includes(source)
    )
      return;
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
  const screenshotLoaderStyle = {
    position: "absolute" as const,
    width: 0,
    height: 0,
    overflow: "hidden" as const,
    pointerEvents: "none" as const,
  };

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
      aria-busy={!isShotsReady || !!pendingGame}
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
        {displayShots.length > 0
          ? displayShots.map((source, index) => {
              const isReady =
                readyScreenshotSourcesRef.current.has(source) ||
                loadedImageSources.has(source);
              const showImage = isReady && (!paused || index === 0);
              const loadSource = !isReady && !paused;

              return (
                <Fragment key={source}>
                  {showImage ? (
                    <button
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
                          void markScreenshotReady(
                            source,
                            event.currentTarget,
                            screenshotGeneration
                          );
                        }}
                        onError={() =>
                          markScreenshotFailed(source, screenshotGeneration)
                        }
                      />
                    </button>
                  ) : (
                    <div
                      className="catalogue-hover-preview__shot catalogue-hover-preview__shot--skeleton skeleton"
                      aria-hidden="true"
                    />
                  )}
                  {loadSource && (
                    <img
                      src={source}
                      alt=""
                      aria-hidden="true"
                      loading="eager"
                      decoding="async"
                      fetchPriority={index === 0 ? "high" : "low"}
                      style={screenshotLoaderStyle}
                      onLoad={(event) => {
                        void markScreenshotReady(
                          source,
                          event.currentTarget,
                          screenshotGeneration
                        );
                      }}
                      onError={() =>
                        markScreenshotFailed(source, screenshotGeneration)
                      }
                    />
                  )}
                </Fragment>
              );
            })
          : (
              <div className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty" />
            )}
      </div>

      {/* Preload oculto do pendingGame: decodifica em background para hold */}
      {!paused && pendingGame && pendingDisplayShots.length > 0 && (
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
          {pendingDisplayShots.slice(0, 1).map((source) => (
            <img
              key={`pending-${source}`}
              src={source}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              fetchPriority="high"
              style={screenshotLoaderStyle}
              onLoad={(event) => {
                void markPendingReady(
                  source,
                  event.currentTarget,
                  pendingGeneration
                );
              }}
              onError={() => markPendingFailed(source, pendingGeneration)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
