import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { withoutHeaderImageSources } from "../../utils/image";
import {
  preloadBrowserImage,
  withCachedImageSources,
} from "../../utils/imageCache";
import {
  CATALOGUE_PREVIEW_EXIT_TRANSITION_MS,
  getAdjacentReadyScreenshotSource,
  getNextReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../../utils/cataloguePreview";
import {
  loadGameAchievementDetailsCached,
  normalizeGameCacheId,
} from "../../utils/gameCache";
import type { AchievementStats, SteamAchievement } from "../../data";
import { pendingScrollIdle } from "../../utils/scrollIdle";

const AUTOPLAY_INTERVAL_MS = 3200;

/**
 * Ícones de conquista mostrados na prévia. Seis é o que a linha comporta sem
 * apertar, e cada ícone a mais é uma requisição a mais por jogo sob o cursor.
 */
const ACHIEVEMENT_PREVIEW_COUNT = 6;

/**
 * Teto de espera pela primeira screenshot antes de mostrar o painel assim mesmo.
 * Sem esse teto, uma imagem quebrada ou uma conexão ruim seguraria a prévia
 * indefinidamente — melhor um painel com a caixa de mídia vazia do que nenhum.
 */
const MEDIA_REVEAL_TIMEOUT_MS = 600;

interface CatalogueHoverPreviewProps {
  game: GhostBoxGame | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/**
 * Preview do catálogo. Mora dentro de `.catalogue-preview-column`, a faixa fixa
 * à direita da listagem — não persegue cartão nem cursor, então não há cálculo
 * de posição nem portal: quem prende no lugar é o `position: sticky` da coluna.
 */
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
  const [isMediaReady, setIsMediaReady] = useState(false);
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

  // Mesma condição do `--visible` do painel: com a mídia ainda carregando ele
  // está oculto, e o foco não pode ficar parado num controle invisível.
  useEffect(() => {
    if ((isVisible && isMediaReady) || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement && previewRef.current?.contains(activeElement)) {
      (activeElement as HTMLElement).blur();
    }
  }, [isVisible, isMediaReady]);


  // Guarda o id junto do resultado: o hover troca de jogo bem mais rápido do
  // que a busca resolve, e sem essa marca o preview novo herda as conquistas do
  // jogo anterior.
  const [fetchedAchievements, setFetchedAchievements] = useState<{
    gameId: string;
    stats: AchievementStats;
    list: SteamAchievement[];
  } | null>(null);
  const achievementGameIdRef = useRef<string | null>(null);
  const [achievementIconsReady, setAchievementIconsReady] = useState(false);
  const [isFetchingAchievements, setIsFetchingAchievements] = useState(false);

  useEffect(() => {
    if (!displayedGame) return;

    // Só a lista dispensa a busca. Muitos jogos chegam com `achievements.total`
    // preenchido e `achievementList` vazio — contar o total como "já tenho"
    // fazia o container renderizar o texto sem nenhum ícone.
    if ((displayedGame.achievementList?.length ?? 0) > 0) {
      setIsFetchingAchievements(false);
      return;
    }

    const normalizedId = normalizeGameCacheId(displayedGame);
    if (!normalizedId || achievementGameIdRef.current === normalizedId) {
      setIsFetchingAchievements(false);
      return;
    }
    achievementGameIdRef.current = normalizedId;

    let cancelled = false;
    let stored = false;
    setIsFetchingAchievements(true);

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
      } finally {
        // Marca o fim da tentativa mesmo cancelada: é o que separa "ainda
        // buscando" de "buscou e não veio lista", e sem essa distinção o bloco
        // fica com uma faixa vazia reservada para ícones que nunca chegam.
        if (!cancelled) setIsFetchingAchievements(false);
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
    setIsMediaReady(false);
  }, [screenshotSourceKey]);

  /**
   * O painel só entra quando a primeira screenshot já está decodificada. Antes
   * disso ele aparecia com a caixa de mídia preta e a arte pintava depois, o que
   * dava a sensação de a prévia se montar em etapas na frente do usuário.
   *
   * Jogo sem screenshot nenhuma não espera nada, e o teto de tempo garante que
   * imagem quebrada ou rede lenta não segurem a prévia para sempre.
   */
  useEffect(() => {
    if (!displayedGame || isMediaReady) return;

    if (!cachedScreenshotSources.length || readyScreenshotCount > 0) {
      setIsMediaReady(true);
      return;
    }

    const timeoutId = window.setTimeout(
      () => setIsMediaReady(true),
      MEDIA_REVEAL_TIMEOUT_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [
    cachedScreenshotSources.length,
    displayedGame,
    isMediaReady,
    readyScreenshotCount,
  ]);

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

  // Ícones das conquistas. Calculado aqui em cima porque o efeito de preload
  // abaixo é hook e não pode ficar depois do `return null`.
  const achievementIconSources = useMemo(() => {
    const list = displayedGame?.achievementList?.length
      ? displayedGame.achievementList
      : fetchedAchievements?.gameId === normalizeGameCacheId(displayedGame ?? "")
        ? fetchedAchievements.list
        : [];

    return list
      .slice(0, ACHIEVEMENT_PREVIEW_COUNT)
      .map((achievement) => achievement.icon || achievement.iconGray || "");
  }, [displayedGame, fetchedAchievements]);

  const achievementIconKey = achievementIconSources.join("\n");

  /**
   * Os ícones entram como grupo, não um a um. Cada `<img loading="lazy">` fazia
   * a própria requisição e pintava quando chegava, então o bloco se montava
   * peça por peça na frente do usuário. Aqui todos são pré-carregados e
   * decodificados antes de qualquer coisa aparecer.
   *
   * `preloadBrowserImage` já traz dedup de requisição em voo, fila de
   * concorrência global e backoff de falha — passar por ele é o que impede o
   * hover/scroll de disparar a mesma imagem várias vezes.
   */
  useEffect(() => {
    // Depende só da chave, não do array: a identidade do `useMemo` muda sempre
    // que `displayedGame`/`fetchedAchievements` mudam, e usá-la como dependência
    // zerava o estado de pronto (e reanimava a linha) mesmo quando os ícones
    // eram exatamente os mesmos.
    const sources = achievementIconKey.split("\n").filter(Boolean);
    if (!sources.length) {
      setAchievementIconsReady(false);
      return;
    }

    let cancelled = false;
    setAchievementIconsReady(false);

    void (async () => {
      // Mesma regra da busca de conquistas: rolando, os cards passam sozinhos
      // sob o cursor e baixar ícone de cada um é requisição jogada fora.
      const idle = pendingScrollIdle();
      if (idle) await idle;
      if (cancelled) return;

      await Promise.all(
        sources.map((source) => preloadBrowserImage(source, { decode: true }))
      );

      if (!cancelled) setAchievementIconsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [achievementIconKey]);

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
  const achievementPreviewList = achievementList.slice(
    0,
    ACHIEVEMENT_PREVIEW_COUNT
  );
  const achievementTotal =
    displayedGame.achievements?.total ||
    fetchedForGame?.stats.total ||
    achievementList.length;
  const achievementIconSource = (achievement: (typeof achievementPreviewList)[number]) =>
    achievement.icon || achievement.iconGray || "";
  // Total sem lista é comum na Steam: sem isto o bloco reservava a faixa de
  // ícones e ficava com um vão vazio embaixo do rótulo.
  const hasAchievementIcons = achievementPreviewList.some((achievement) =>
    achievementIconSource(achievement)
  );

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

  // O painel só é dado como visível com a mídia pronta: as duas condições
  // juntas é que evitam a montagem em etapas.
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
              tabIndex={isPanelVisible ? 0 : -1}
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
              tabIndex={isPanelVisible ? 0 : -1}
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
            {/* Três estados distintos, e nenhum deles é uma faixa vazia. Muitos
                jogos da Steam trazem `achievements.total` mas nenhuma lista, e
                antes disso o bloco reservava a altura dos ícones e ficava com um
                vão morto embaixo do rótulo — que é o "não aparece nada".

                A linha real só entra com os seis ícones já decodificados; é o
                `--ready` que governa a animação, em vez de cada imagem aparecer
                por conta. */}
            {hasAchievementIcons ? (
              <div
                className={`catalogue-hover-preview__achievements-row${
                  achievementIconsReady
                    ? " catalogue-hover-preview__achievements-row--ready"
                    : ""
                }`}
              >
                {achievementPreviewList.map((achievement) => {
                  const iconSource = achievementIconSource(achievement);
                  return iconSource ? (
                    <img
                      key={achievement.name}
                      className="catalogue-hover-preview__achievements-icon"
                      src={iconSource}
                      alt=""
                      aria-hidden="true"
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
            ) : isFetchingAchievements ? (
              /* `--ready` também aqui: o estado oculto existe para segurar os
                 ícones reais até decodificarem, e sem ele o skeleton herdaria o
                 `opacity: 0` e não apareceria. */
              <div
                className="catalogue-hover-preview__achievements-row catalogue-hover-preview__achievements-row--ready"
                aria-hidden="true"
              >
                {Array.from({ length: ACHIEVEMENT_PREVIEW_COUNT }, (_, index) => (
                  <span
                    key={`achievement-skeleton-${index}`}
                    className="catalogue-hover-preview__achievements-icon catalogue-hover-preview__achievements-icon--skeleton skeleton"
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
