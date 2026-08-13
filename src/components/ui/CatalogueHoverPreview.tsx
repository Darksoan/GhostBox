import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import { withCachedImageSources } from "../../utils/imageCache";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  CATALOGUE_PREVIEW_VIEWPORT_MARGIN,
  computeCataloguePreviewPosition,
  getAdjacentReadyScreenshotSource,
  getNextReadyScreenshotSource,
  pickDistinctScreenshotSources,
  type CataloguePreviewPointer,
  type CataloguePreviewPosition,
} from "../../utils/cataloguePreview";
import {
  loadGameAchievementDetailsCached,
  normalizeGameCacheId,
} from "../../utils/gameCache";
import type { AchievementStats, SteamAchievement } from "../../data";
import { pendingScrollIdle } from "../../utils/scrollIdle";

const AUTOPLAY_INTERVAL_MS = 3200;

const DEFAULT_APP_HEADER_HEIGHT = 52;

function readAppHeaderHeight() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return DEFAULT_APP_HEADER_HEIGHT;
  }

  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--app-header-height");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_APP_HEADER_HEIGHT;
}

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  /** Cartão sob o ponteiro — define a altura em que o painel aparece. */
  anchor?: HTMLElement | null;
  /** Coluna de filtros — define a faixa horizontal fixa do painel. */
  columnRef?: RefObject<HTMLElement | null>;
  /** Cursor no momento do hover: só serve de reserva se o cartão não for medido. */
  pointer?: CataloguePreviewPointer | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function CatalogueHoverPreview({
  game,
  anchor = null,
  columnRef,
  pointer = null,
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
  const [displayedAnchor, setDisplayedAnchor] = useState<HTMLElement | null>(
    null
  );
  const [position, setPosition] = useState<CataloguePreviewPosition | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasVisibleRef = useRef(false);
  const previewRef = useRef<HTMLElement | null>(null);
  // Ponteiro do hover atual, congelado até o cursor entrar em outro cartão.
  const pointerRef = useRef<CataloguePreviewPointer | null>(null);

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
      setDisplayedAnchor(null);
      setPosition(null);
      pointerRef.current = null;
    }, CATALOGUE_PREVIEW_EXIT_TRANSITION_MS);

    return () => {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
    };
  }, [game]);

  useEffect(() => {
    if (!game) return;
    setDisplayedAnchor(anchor);
    if (pointer) pointerRef.current = pointer;
  }, [game, anchor, pointer]);

  const updatePosition = useCallback(() => {
    const node = previewRef.current;
    if (!node || typeof window === "undefined") return;

    const anchorRect = displayedAnchor?.getBoundingClientRect();
    const columnRect = columnRef?.current?.getBoundingClientRect();
    if (!anchorRect && !pointerRef.current) return;

    const previewRect = node.getBoundingClientRect();
    const next = computeCataloguePreviewPosition({
      card: anchorRect
        ? {
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null,
      pointer: pointerRef.current,
      column: columnRect
        ? { left: columnRect.left, width: columnRect.width }
        : null,
      preview: { width: previewRect.width, height: previewRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      topBoundary: readAppHeaderHeight() + CATALOGUE_PREVIEW_VIEWPORT_MARGIN,
    });

    setPosition((current) =>
      current && current.top === next.top && current.left === next.left
        ? current
        : next
    );
  }, [columnRef, displayedAnchor]);

  // Layout effect: reposiciona antes da pintura, senão o painel aparece um
  // frame no lugar antigo antes de saltar para o cartão novo.
  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, displayedGame]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node || !displayedGame || typeof window === "undefined") return;

    let frameId: number | null = null;
    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        updatePosition();
      });
    };

    // O painel não persegue o cursor: fica onde nasceu até o hover trocar de
    // cartão. Só remede o que muda sozinho — a altura depois da montagem
    // (conquistas chegam por fetch) e as bordas de encaixe no resize.
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(node);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [displayedGame, updatePosition]);

  useEffect(() => {
    if (isVisible || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && previewRef.current?.contains(activeElement)) {
      (activeElement as HTMLElement).blur();
    }
  }, [isVisible]);


  // Guarda o id junto do resultado: o hover troca de jogo bem mais rápido do
  // que a busca resolve, e sem essa marca o preview novo herda as conquistas do
  // jogo anterior.
  const [fetchedAchievements, setFetchedAchievements] = useState<{
    gameId: string;
    stats: AchievementStats;
    list: SteamAchievement[];
  } | null>(null);
  const achievementGameIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!displayedGame) return;

    // Só a lista dispensa a busca. Muitos jogos chegam com `achievements.total`
    // preenchido e `achievementList` vazio — contar o total como "já tenho"
    // fazia o container renderizar o texto sem nenhum ícone.
    if ((displayedGame.achievementList?.length ?? 0) > 0) return;

    const normalizedId = normalizeGameCacheId(displayedGame);
    if (!normalizedId || achievementGameIdRef.current === normalizedId) return;
    achievementGameIdRef.current = normalizedId;

    let cancelled = false;
    let stored = false;

    void (async () => {
      try {
        // Rolando: os cards passam sob o ponteiro sozinhos e buscar conquistas
        // de cada um que encosta no cursor é requisição jogada fora.
        const idle = pendingScrollIdle();
        if (idle) await idle;
        if (cancelled) return;

        const details = await loadGameAchievementDetailsCached(normalizedId);
        if (cancelled || !details) return;

        stored = true;
        setFetchedAchievements({
          gameId: normalizedId,
          stats: details.achievements,
          list: details.achievementList ?? [],
        });
      } catch {
        // Silencioso de propósito: o cache negativo já segura novas tentativas.
      }
    })();

    return () => {
      cancelled = true;
      // Sem resultado guardado o id precisa voltar, senão uma busca cancelada
      // no meio deixaria esse jogo sem conquistas para sempre.
      if (!stored && achievementGameIdRef.current === normalizedId) {
        achievementGameIdRef.current = null;
      }
    };
  }, [displayedGame]);

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

  const positiveRatio = displayedGame.steamPositiveRatio;
  const reviewCount = displayedGame.steamReviewCount;
  const hasReviewScore = positiveRatio != null && reviewCount != null && reviewCount > 0;
  const reviewScoreText = hasReviewScore
    ? `${Math.round(positiveRatio * 100)}%`
    : null;
  const reviewCountText = hasReviewScore
    ? reviewCount >= 1000
      ? `${(reviewCount / 1000).toFixed(reviewCount < 10000 ? 1 : 0)}k`
      : String(reviewCount)
    : null;

  // Só aproveita o que foi buscado se for deste jogo — o resultado em voo do
  // jogo anterior não pode vazar pro preview atual.
  const fetchedForGame =
    fetchedAchievements?.gameId === normalizeGameCacheId(displayedGame)
      ? fetchedAchievements
      : null;
  const achievementList =
    displayedGame.achievementList?.length
      ? displayedGame.achievementList
      : fetchedForGame?.list ?? [];
  const achievementPreviewList = achievementList.slice(0, 7);
  const achievementTotal =
    displayedGame.achievements?.total ||
    fetchedForGame?.stats.total ||
    achievementList.length;
  const achievementIconSource = (achievement: (typeof achievementPreviewList)[number]) =>
    achievement.icon || achievement.iconGray || "";

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

  const previewPanel = (
    <section
      ref={previewRef}
      className={`catalogue-hover-preview ${
        isVisible ? "catalogue-hover-preview--visible" : "catalogue-hover-preview--hidden"
      }`}
      style={{
        top: `${position?.top ?? 0}px`,
        left: `${position?.left ?? 0}px`,
        // Antes de medir não há lugar certo para pintar: o painel nasce
        // invisível e só ganha posição no layout effect.
        visibility: position ? "visible" : "hidden",
      }}
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
        {hasReviewScore && (
          <span className="catalogue-hover-preview__score">
            <span className="catalogue-hover-preview__score-ratio">
              {reviewScoreText}
            </span>
            <span className="catalogue-hover-preview__score-count">
              {isEnglish ? "positive" : "positivo"} ({reviewCountText})
            </span>
          </span>
        )}

        {achievementTotal > 0 && (
          <div className="catalogue-hover-preview__achievements">
            <span className="catalogue-hover-preview__achievements-label">
              {isEnglish
                ? `Includes ${achievementTotal} Steam achievements`
                : `Inclui ${achievementTotal} conquistas Steam`}
            </span>
            <div className="catalogue-hover-preview__achievements-row">
              {achievementPreviewList.map((achievement) => {
                const iconSource = achievementIconSource(achievement);
                return iconSource ? (
                  <img
                    key={achievement.name}
                    className="catalogue-hover-preview__achievements-icon"
                    src={iconSource}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span
                    key={achievement.name}
                    className="catalogue-hover-preview__achievements-icon catalogue-hover-preview__achievements-icon--fallback"
                    aria-hidden="true"
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );

  // Portal: preso ao `body` o painel escapa do `overflow` do scroller e de
  // qualquer bloco de contenção da página, então `position: fixed` mede contra
  // a janela de verdade.
  return typeof document === "undefined"
    ? previewPanel
    : createPortal(previewPanel, document.body);
}
