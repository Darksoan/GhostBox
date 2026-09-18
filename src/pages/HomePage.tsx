import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { GhostBoxGame } from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem } from "../types";
import { loadGames, loadGameReviews, loadGameStoreDetails, loadSteamRecommendedTagsForUser, loadSteamSimilarAppIds, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import {
  HomeCategoryCardSkeleton,
  HomeTopRatedCardBodySkeleton,
  HomeWishlistCardSkeleton,
  HomeWishlistReviewSkeleton,
} from "../components/ui/LoadingStates";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Shelf } from "../components/ui/Shelf";
import { useSettings } from "../context/settings";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useHomeShelves, type HomeShelf } from "../hooks/useHomeShelves";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import {
  readStoredPersonalCalendar,
  writeStoredPersonalCalendar,
  readStoredSteamWishlistCycle,
  writeStoredSteamWishlistCycle,
  readStoredSteamWishlistReview,
  writeStoredSteamWishlistReview,
  type StoredPersonalCalendar,
} from "../utils/storage";
import {
  createPersonalCalendar,
  getPersonalCalendarCycleStart,
  getPersonalCalendarDates,
  getUniquePersonalCalendarPool,
  isStoredPersonalCalendarFresh,
  personalCalendarGameKey,
  planPersonalCalendar,
} from "../utils/personalCalendar";
import {
  gameHeaderOnlySources,
  gameHeroCapsuleSources,
  gameHeroSources,
  layeredImageStyle,
} from "../utils/image";
import {
  loadedImageSources,
  markImageSourceLoaded,
  runWhenIdle,
} from "../utils/imageCache";
import { createSeedGame } from "../utils/gameSeed";
import { gameCategoryScore, getGameTraits, normalizeGameTrait } from "../utils/gameTraits";
import { formatCompactCount, getSteamReviewScore } from "../utils/gameMetrics";
import { steamRecommendedTagNames } from "../utils/tasteProfile";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";
import { formatCompactPlaytime } from "../utils/time";
import {
  createWishlistCycle,
  getWishlistCycleIndex,
  getWishlistCycleStart,
  homeWishlistCycleHistoryLimit,
  isStoredWishlistCycleFresh,
  pickWishlistCycleGames,
} from "../utils/wishlistCycle";

type HomeCategoryCardVariant = "tile" | "portrait";

type HomeExploreCategory = {
  label: string;
  filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
  filterValue: string;
  games: GhostBoxGame[];
  score: number;
};

const homeCarouselGroupSize = 8;
// Pills por card, dimensionado para a única linha que o card reserva (ver
// `.home-category-card__genres` em app.scss). Sem teto, um jogo da Steam traz
// 20+ tags e o card renderiza todas para o CSS recortar quase todas — quais
// sobravam dependia do comprimento das strings, então dois cards vizinhos
// nunca batiam.
const homeMetadataCategoryLimit = 3;
// Cards de "Top rated" (`showSecondaryPills`) reservam duas linhas de pills.
// Contagem fixa (não "manda candidatas demais e deixa o CSS recortar"): com o
// recorte por overflow, quantas pills sobravam dependia do comprimento dos
// rótulos, e jogos de tag curta paravam em 4 no total. Aqui cada linha renderiza
// exatamente o que cabe na conta abaixo e o CSS estica/encolhe as pills para
// fechar a largura (ver `.home-category-card--pill-rows` em app.scss), então o
// card mostra sempre 3 + 2 = 5 pills quando o jogo tem categorias suficientes.
const homeTopRatedPrimaryPillCount = 3;
const homeTopRatedSecondaryPillCount = 2;
const homeRecommendedHeroPreloadLimit = 8;
// Cards de recomendados visíveis por vez. Também é o piso para as setas
// aparecerem: com pool menor ou igual a isto não há o que rolar. Vale a janela
// larga (4 colunas, ver `@media (min-width: 1400px)` em app.scss): é a contagem
// de skeletons, e com 3 a quarta coluna ficava vazia durante o carregamento.
// Na janela estreita o quarto skeleton só fica fora da área visível do rail.
const homeRecommendedCardCount = 4;
// Cards de "Bem avaliados" visíveis por página do carrossel.
const homeTopRatedCardCount = 3;
// Teto do texto da descrição curta. O card fecha em duas linhas via
// `-webkit-line-clamp`; o corte aqui garante reticências mesmo quando o
// navegador não aplica as do clamp (texto de uma linha só, muito longo).
const homeShortDescriptionLimit = 150;
const homeRecommendedGroupPreloadTimeoutMs = 1800;
const homeExploreCategoryLimit = 12;
const homePersonalCalendarDays = 4;
const homePersonalCalendarGamesPerDay = 2;
const homePersonalCalendarGameCount =
  homePersonalCalendarDays * homePersonalCalendarGamesPerDay;
const homePersonalCalendarPageSize = 120;
const homePersonalCalendarPoolTarget = homePersonalCalendarGameCount * 15;
const homePersonalCalendarEnrichmentLimit = 6;
const homeCalendarCoverLoadMargin = "360px 720px";
const homePersonalCalendarNarrowDays = 3;
const homeWideLayoutMediaQuery = "(min-width: 1600px)";
const homeWishlistCycleSourceCount = 6;
const homeWishlistSimilarPoolLimit = 64;
const homeWishlistCycleGameCount = 4;
const homeWishlistReviewCacheMs = 7 * 24 * 60 * 60 * 1000;
const homeWishlistRetryMs = 30 * 60 * 1000;

function homeGameAppId(game: GhostBoxGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

function homeGameKey(game: GhostBoxGame) {
  return game.appId || game.id;
}

function getUniqueWishlistAppIds(
  wishlistItems: SteamWishlistItem[],
  libraryGameAppIds: Set<string>
) {
  const seen = new Set<string>();

  return wishlistItems.flatMap((item) => {
    const appId = item.appId.trim();
    if (!appId || seen.has(appId) || libraryGameAppIds.has(appId)) return [];
    seen.add(appId);
    return [appId];
  });
}

function isSteamFallbackTitle(title: string) {
  return isSteamTitlePlaceholder(title);
}

function getDisplayGameTitle(game: GhostBoxGame, fallback: string) {
  const title = game.title.trim();
  return title && !isSteamFallbackTitle(title) ? title : fallback;
}

function steamReviewAvatarUrl(hash: string) {
  if (!hash) return "";
  if (/^https?:\/\//i.test(hash)) return hash;
  return `https://avatars.akamai.steamstatic.com/${hash}_medium.jpg`;
}

function normalizeSteamReviewText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function createWishlistFallbackGame(appId: string, index = 0, title?: string) {
  return createSeedGame({ appId, title: title || `Steam App ${appId}` }, index);
}

function preloadHomeRecommendedCover(game: GhostBoxGame) {
  // O banner pinta `library_hero`: pré-carregar `hero_capsule` aqui aquecia a
  // família errada e cada navegação do carrossel buscava o hero a frio.
  const sources = gameHeroSources(game).slice(
    0,
    homeRecommendedHeroPreloadLimit
  );

  if (!sources.length || sources.some((source) => loadedImageSources.has(source))) {
    return Promise.resolve();
  }

  if (typeof Image === "undefined") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    let pending = sources.length;
    const timeout = window.setTimeout(
      finish,
      homeRecommendedGroupPreloadTimeoutMs
    );

    function finish(source?: string) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (source) markImageSourceLoaded(source);
      resolve();
    }

    sources.forEach((source) => {
      const image = new Image();
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.onload = async () => {
        if (typeof image.decode === "function") {
          await image.decode().catch(() => undefined);
        }
        finish(source);
      };
      image.onerror = () => {
        pending -= 1;
        if (pending === 0) finish();
      };
      image.src = source;
    });
  });
}

function preloadHomeRecommendedGroup(games: GhostBoxGame[]) {
  return Promise.all(
    games.slice(0, homeCarouselGroupSize).map(preloadHomeRecommendedCover)
  ).then(() => undefined);
}

async function loadWishlistDisplayGame(appId: string, index = 0, title?: string) {
  const game = await loadGameStoreDetails(appId).catch(() => null);
  if (!game) return createWishlistFallbackGame(appId, index, title);
  return title && isSteamFallbackTitle(game.title) ? { ...game, title } : game;
}

function homeWishlistCoverSources(game: GhostBoxGame) {
  return gameHeaderOnlySources(game);
}

async function loadHomePersonalCalendarPool(excludedGameIds = new Set<string>()) {
  const games: GhostBoxGame[] = [];
  const sorts: Array<NonNullable<Parameters<typeof loadGames>[0]>["sort"]> = [
    "popular",
    "recentlyAdded",
  ];
  const offsets = new Map<typeof sorts[number], number>(
    sorts.map((sort) => [sort, 0])
  );
  const totals = new Map<typeof sorts[number], number | undefined>();

  while (
    getUniquePersonalCalendarPool(games).filter(
      (game) => !excludedGameIds.has(personalCalendarGameKey(game))
    ).length < homePersonalCalendarPoolTarget
  ) {
    let loadedAnyPage = false;

    for (const sort of sorts) {
      const offset = offsets.get(sort) ?? 0;
      const expectedTotal = totals.get(sort);
      if (expectedTotal !== undefined && offset >= expectedTotal) continue;

      const result = await loadGames({
        query: "",
        limit: homePersonalCalendarPageSize,
        offset,
        sort,
      });
      games.push(...result.games);
      totals.set(sort, result.matched || result.total || games.length);
      offsets.set(sort, offset + homePersonalCalendarPageSize);
      loadedAnyPage = true;

      if (result.games.length < homePersonalCalendarPageSize) {
        totals.set(sort, offset + result.games.length);
      }
    }

    if (!loadedAnyPage) break;
  }

  return getUniquePersonalCalendarPool(games);
}

function HomeCategoryCard({
  game,
  variant = "tile",
  showMetadata = false,
  showSummary = false,
  showTitle = false,
  showSecondaryPills = false,
  badgeLabel = "",
  language = "pt",
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  variant?: HomeCategoryCardVariant;
  showMetadata?: boolean;
  showSummary?: boolean;
  showTitle?: boolean;
  showSecondaryPills?: boolean;
  /** Pill de estado que entra antes das categorias, ex. "Em breve". */
  badgeLabel?: string;
  language?: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackCoverSources = useMemo(
    () =>
      variant === "portrait"
          ? gameHeroCapsuleSources(game).slice(
              0,
              homeRecommendedHeroPreloadLimit
            )
        : gameHeaderOnlySources(game),
    [game, variant]
  );
  const cachedSources = useCachedImageSources(fallbackCoverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);
  // A fonte provisória do hook ainda pode falhar ou ser trocada por um fallback.
  // Só a fonte decodificada entra no background para não repintar a capa visível.
  const layeredSources = loaded && coverSource ? [coverSource] : [];
  const metadataCategoryPool = getGameTraits(game);
  // O badge ocupa uma vaga da primeira linha para a contagem de pills não mudar
  // — a linha tem altura fechada e não pode transbordar.
  const primaryCategoryLimit =
    (showSecondaryPills ? homeTopRatedPrimaryPillCount : homeMetadataCategoryLimit) -
    (badgeLabel ? 1 : 0);
  const metadataCategories = metadataCategoryPool.slice(
    0,
    Math.max(0, primaryCategoryLimit)
  );
  const secondaryCategories = showSecondaryPills
    ? metadataCategoryPool.slice(
        homeTopRatedPrimaryPillCount,
        homeTopRatedPrimaryPillCount + homeTopRatedSecondaryPillCount
      )
    : [];
  const coverImageSize = variant === "portrait" ? "auto 100%" : "100% 100%";
  const hoverCoverImageSize = showMetadata
    ? coverImageSize
    : variant === "portrait"
      ? "auto 106%"
      : "104.5% 104.5%";
  // Nome e descrição curta são independentes: Recomendados mostra os dois
  // juntos (`showSummary`), Top rated mostra só o nome (`showTitle`). Qualquer
  // um dos dois liga o mesmo bloco de texto — e o mesmo respiro extra do card,
  // já que um card com só o nome precisa da mesma folga que um com nome +
  // descrição (é o mesmo empilhamento capa → texto → tags).
  const showTitleBlock = showSummary || showTitle;

  return (
    <button
      type="button"
      className={`home-category-card home-category-card--${variant}${
        showMetadata ? " home-category-card--with-metadata" : ""
      }${showTitleBlock ? " home-category-card--with-title" : ""}${
        showSummary ? " home-category-card--with-summary" : ""
      }${showSecondaryPills ? " home-category-card--pill-rows" : ""}`}
      aria-label={game.title}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-category-card__cover${
          loaded ? " home-category-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(
          layeredSources,
          "",
          coverImageSize,
          hoverCoverImageSize
        )}
        aria-hidden="true"
      />
      {/* Card só de arte: o nome não cabe em lugar nenhum em repouso, então
          entra no hover sobre um gradiente que segura a legibilidade em capas
          claras. Cards com metadata já mostram o nome embaixo. */}
      {showMetadata ? null : (
        <span className="home-category-card__hover-title" aria-hidden="true">
          <span className="home-category-card__hover-title-text">
            {getDisplayGameTitle(
              game,
              language === "en" ? "Untitled game" : "Jogo sem título"
            )}
          </span>
        </span>
      )}
      {showMetadata ? (
        <span className="home-category-card__metadata" aria-hidden="true">
          {showTitleBlock ? (
            <span className="home-category-card__summary">
              <span className="home-category-card__title">
                {getDisplayGameTitle(
                  game,
                  language === "en" ? "Untitled game" : "Jogo sem título"
                )}
              </span>
              {showSummary ? (
                <span className="home-category-card__description">
                  {getHomeShortDescription(game, language)}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="home-category-card__metadata-summary">
            <span className="home-category-card__genres">
              {badgeLabel ? (
                <span className="home-category-card__genre home-category-card__genre--badge">
                  {badgeLabel}
                </span>
              ) : null}
              {metadataCategories.map((category) => (
                <span className="home-category-card__genre" key={category}>
                  {getHomeCategoryLabel(category, language)}
                </span>
              ))}
            </span>
            {/* Renderiza a segunda linha sempre que a variante a declara, mesmo
                vazia: as pills vêm do enrichment assíncrono e chegam card a card.
                Condicionar ao conteúdo fazia cada card crescer uma linha de pill
                no instante em que a resposta dele voltava, remexendo a altura da
                linha do grid e empurrando o que estava abaixo. A altura fixa de
                `--pill-height` já deixa a linha vazia ocupar o mesmo espaço. */}
            {showSecondaryPills ? (
              <span className="home-category-card__tags">
                {secondaryCategories.map((category) => (
                  <span className="home-category-card__genre" key={category}>
                    {getHomeCategoryLabel(category, language)}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * Card de "Bem avaliados": arte larga em header capsule da Steam (460×215,
 * mesmo aspecto do card em grade do catálogo) e embaixo o nome do jogo com a
 * nota média (fire + nota) à direita, e a desenvolvedora numa segunda linha —
 * sem linha de pills. Superfície própria com alvo de clique inteiro.
 */
function HomeTopRatedCard({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackCoverSources = useMemo(
    () => gameHeaderOnlySources(game),
    [game]
  );
  const cachedSources = useCachedImageSources(fallbackCoverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);
  // Não pinte os fallbacks antes de a fonte escolhida terminar: quando o hook
  // confirma a capa, o fade-in reiniciaria sobre a arte já visível.
  const layeredSources = loaded && coverSource ? [coverSource] : [];
  const { appearance, t } = useSettings();
  // Mesma guarda do preview do catálogo (`getSteamReviewScore`): sem amostra de
  // review, a razão volta 0 e viraria uma nota 0,0 falsa.
  const reviewScore = getSteamReviewScore(game);
  const ratingText = reviewScore
    ? ((reviewScore.percent / 100) * 5).toFixed(1)
    : null;

  const reviewCount = Math.max(game.recommendations ?? 0, game.steamReviewCount ?? 0);
  const reviewsText = reviewCount > 0
    ? t("home.reviews", { count: formatCompactCount(reviewCount, appearance.language) })
    : "";

  // O shelf nasce com o título provisório "Steam App <appid>" e o nome real só
  // chega no enriquecimento assíncrono. Enquanto isso, o card vira skeleton em
  // vez de exibir o placeholder — a resolução chega card a card, então cada um
  // sai do skeleton no momento em que os dados dele chegam.
  if (isSteamTitlePlaceholder(game.title, game.appId)) {
    return (
      <div className="home-top-rated-card">
        <span className="home-top-rated-card__art skeleton" />
        <HomeTopRatedCardBodySkeleton />
      </div>
    );
  }

  const handleClick = () => onOpenGame(game);

  return (
    <div className="home-top-rated-card">
      {/* Alvo de clique cobre o card inteiro (arte + texto), mas fica fora da
          árvore de conteúdo: nome e nota são texto irmão, não descendente,
          então continuam legíveis por leitor de tela em vez de virar parte do
          nome acessível do botão (ou de serem engolidos pelo `aria-label`). */}
      <button
        type="button"
        className="home-top-rated-card__hit"
        aria-label={game.title}
        onClick={handleClick}
        onContextMenu={(event) => {
          if (!onGameContextMenu) return;
          event.preventDefault();
          onGameContextMenu(game, event.clientX, event.clientY);
        }}
      />
      <span
        className={`home-top-rated-card__art${
          loaded ? " home-top-rated-card__art--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
      <span className="home-top-rated-card__body">
        <span className="home-top-rated-card__title-row">
          <span className="home-top-rated-card__title">{game.title}</span>
          {ratingText ? (
            <span
              className="home-top-rated-card__rating"
              aria-label={ratingText}
            >
              <Flame
                size={16}
                fill="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span>{ratingText}</span>
            </span>
          ) : null}
        </span>
        {/* Altura reservada mesmo sem desenvolvedora: o dado chega no
            enriquecimento e um card que cresce depois remexeria a linha
            inteira do carrossel. */}
        <span className="home-top-rated-card__developer">{reviewsText}</span>
      </span>
    </div>
  );
}

function HomeTopRatedShelf({
  title,
  shelf,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  shelf: HomeShelf;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  // A lista fixa nasce inteira com nomes provisórios e é enriquecida card a
  // card. Revelar o rail parcialmente pronto deixava os próximos grupos ainda
  // em skeleton; ao clicar no chevron, o usuário via esses placeholders
  // virarem texto durante a rolagem. O shelf entra de uma vez só quando todos
  // os títulos estão prontos, mantendo a navegação visualmente estável.
  const hasPendingTitles = shelf.games.some((game) =>
    isSteamTitlePlaceholder(game.title, game.appId)
  );

  if (!shelf.games.length || hasPendingTitles) {
    if (!shelf.games.length && !shelf.loading) return null;

    return (
      <section className="home-top-rated" aria-label={title}>
        <SectionHeader title={title} />
        <div className="home-top-rated__rail">
          <div className="home-top-rated__carousel">
            <div className="home-top-rated__track">
              {Array.from({ length: homeTopRatedCardCount }, (_, index) => (
                <div className="home-top-rated-card" key={`top-rated-${index}`}>
                  <span className="home-top-rated-card__art skeleton" />
                  <HomeTopRatedCardBodySkeleton />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <Shelf
      blockName="home-top-rated"
      title={title}
      items={shelf.games}
      getKey={homeGameKey}
      minItemsForControls={homeTopRatedCardCount}
      prevLabel={language === "en" ? "Previous game" : "Jogo anterior"}
      nextLabel={language === "en" ? "Next game" : "Próximo jogo"}
      renderItem={(game) => (
        <HomeTopRatedCard
          game={game}
          onOpenGame={onOpenGame}
          onGameContextMenu={onGameContextMenu}
        />
      )}
    />
  );
}

function getPlainSteamText(value?: string) {
  if (!value) return "";

  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getHomeShortDescription(game: GhostBoxGame, language: "pt" | "en") {
  const source =
    getPlainSteamText(game.shortDescription) ||
    game.subtitle ||
    game.genres.slice(0, 3).join(" • ");

  if (!source) {
    return language === "en"
      ? "Featured pick from the GhostBox catalogue."
      : "Destaque selecionado do catálogo GhostBox.";
  }

  return source.length > homeShortDescriptionLimit
    ? `${source.slice(0, homeShortDescriptionLimit - 3).trim()}...`
    : source;
}

function getHomeBannerDescription(game: GhostBoxGame, language: "pt" | "en") {
  const source =
    getPlainSteamText(game.shortDescription) ||
    game.subtitle ||
    game.genres.slice(0, 3).join(" • ");

  if (!source) {
    return language === "en"
      ? "Featured pick from the GhostBox catalogue."
      : "Destaque selecionado do catálogo GhostBox.";
  }

  return source;
}

function getHomeCategoryLabel(value: string, language: "pt" | "en") {
  if (language === "en") return value;

  const labels: Record<string, string> = {
    Action: "Ação",
    Adventure: "Aventura",
    Anime: "Anime",
    Atmospheric: "Atmosférico",
    Casual: "Casual",
    "Co-op": "Co-op",
    Crime: "Crime",
    Exploration: "Exploração",
    Fantasy: "Fantasia",
    Horror: "Terror",
    Indie: "Indie",
    Multiplayer: "Multiplayer",
    Puzzle: "Puzzle",
    RPG: "RPG",
    Racing: "Corrida",
    "Sci-fi": "Sci-fi",
    Shooter: "Shooter",
    Simulation: "Simulação",
    Singleplayer: "Singleplayer",
    Sports: "Esportes",
    Strategy: "Estratégia",
    Story: "História",
    "Story Rich": "Boa trama",
    Survival: "Sobrevivência",
  };

  return labels[value] ?? value;
}

function getHomeExploreCategories(games: GhostBoxGame[]) {
  const categoryMap = new Map<
    string,
    {
      filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
      filterValue: string;
      games: GhostBoxGame[];
      score: number;
    }
  >();

  games.forEach((game) => {
    const categories = [
      ...game.genres.map((value) => ({
        key: "genres" as const,
        value,
        normalized: normalizeGameTrait(value),
      })),
      ...game.tags.map((value) => ({
        key: "tags" as const,
        value,
        normalized: normalizeGameTrait(value),
      })),
    ].filter((category) => category.normalized);

    Array.from(
      new Map(categories.map((category) => [category.normalized, category])).values()
    ).forEach((category) => {
      const entry = categoryMap.get(category.normalized) ?? {
        filterKey: category.key,
        filterValue: category.normalized,
        games: [],
        score: 0,
      };
      if (entry.filterKey === "tags" && category.key === "genres") {
        entry.filterKey = category.key;
        entry.filterValue = category.normalized;
      }
      entry.games.push(game);
      entry.score += gameCategoryScore(game);
      categoryMap.set(category.normalized, entry);
    });
  });

  return Array.from(categoryMap, ([label, entry]) => ({
    label,
    filterKey: entry.filterKey,
    filterValue: entry.filterValue,
    games: getUniqueHomeGames(entry.games).sort(
      (a, b) => gameCategoryScore(b) - gameCategoryScore(a)
    ),
    score: entry.games.length * 1000 + entry.score / Math.max(entry.games.length, 1),
  }))
    .filter((category) => category.games.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, homeExploreCategoryLimit);
}

function getUniqueHomeGames(games: GhostBoxGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = game.appId || game.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHomeExplorePreviewRows(
  categoryGames: GhostBoxGame[],
  _allGames: GhostBoxGame[]
) {
  const uniqueCategoryGames = getUniqueHomeGames(categoryGames);
  const previewGames = uniqueCategoryGames.slice(0, 9);
  const rows = [0, 1, 2].map((rowIndex) =>
    previewGames.filter((_, index) => index % 3 === rowIndex).slice(0, 3)
  );

  return rows.filter((row) => row.length > 0);
}

function HomeExploreCategoryImage({ game }: { game: GhostBoxGame }) {
  const sources = gameHeaderOnlySources(game);
  const cachedSources = useCachedImageSources(sources);
  const { source: imageSource, loaded } = useLoadableImageCover(cachedSources);

  return (
    <span
      className="home-explore-card__image"
      style={layeredImageStyle(loaded && imageSource ? [imageSource] : [], "")}
      aria-hidden="true"
    />
  );
}

function HomeExploreCard({
  category,
  allGames,
  language,
  rootRef,
  onOpenCategory,
}: {
  category: HomeExploreCategory;
  allGames: GhostBoxGame[];
  language: "pt" | "en";
  rootRef: RefObject<HTMLDivElement | null>;
  onOpenCategory: (category: HomeExploreCategory) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  // Once a card scrolls into view we keep its images mounted so re-entering
  // the viewport never re-triggers the image-loading hooks.
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  const previewRows = useMemo(
    () => getHomeExplorePreviewRows(category.games, allGames),
    [category.games, allGames]
  );

  useEffect(() => {
    if (hasBeenVisible) return;
    const node = cardRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      {
        root: rootRef.current ?? null,
        // Preload one card-width ahead so images are ready before the card
        // fully enters the viewport.
        rootMargin: "0px 300px 0px 300px",
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible, rootRef]);

  return (
    <button
      ref={cardRef}
      type="button"
      className="home-explore-card"
      onClick={() => onOpenCategory(category)}
    >
      <span className="home-explore-card__images" aria-hidden="true">
        {hasBeenVisible &&
          previewRows.map((rowGames, rowIndex) => (
            <span
              key={`${category.label}-${rowIndex}`}
              className={`home-explore-card__image-row home-explore-card__image-row--${rowIndex + 1}`}
            >
              {[0, 1].map((setIndex) => (
                <span
                  key={`${category.label}-${rowIndex}-${setIndex}`}
                  className="home-explore-card__image-set"
                >
                  {rowGames.map((game) => (
                    <HomeExploreCategoryImage
                      key={`${game.appId || game.id}-${rowIndex}-${setIndex}`}
                      game={game}
                    />
                  ))}
                </span>
              ))}
            </span>
          ))}
      </span>
      <span className="home-explore-card__scrim" aria-hidden="true" />
      <span className="home-explore-card__label">
        {getHomeCategoryLabel(category.label, language)}
      </span>
    </button>
  );
}

function HomeExploreCategories({
  title,
  categories,
  allGames,
  language,
  onOpenCategory,
}: {
  title: string;
  categories: HomeExploreCategory[];
  allGames: GhostBoxGame[];
  language: "pt" | "en";
  onOpenCategory: (category: HomeExploreCategory) => void;
}) {
  return (
    <Shelf
      blockName="home-explore"
      title={title}
      items={categories}
      getKey={(category) => category.label}
      prevLabel={language === "en" ? "Previous categories" : "Categorias anteriores"}
      nextLabel={language === "en" ? "Next categories" : "Próximas categorias"}
      renderItem={(category, rootRef) => (
        <HomeExploreCard
          category={category}
          allGames={allGames}
          language={language}
          rootRef={rootRef}
          onOpenCategory={onOpenCategory}
        />
      )}
    />
  );
}

function HomeCalendarGameCardComponent({
  game,
  rootRef,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  rootRef: RefObject<HTMLDivElement | null>;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  // Header-only: never include coverUrl/portrait fallbacks. Enrichment and the
  // global library-capsule cache otherwise swap the landscape header for a
  // vertical cover after the correct image already painted.
  const headerSources = useMemo(
    () =>
      shouldLoadCover
        ? [
            ...gameHeaderOnlySources(game).slice(0, 1),
            ...gameHeroSources(game),
            ...gameHeaderOnlySources(game).slice(1),
          ]
        : [],
    [game, shouldLoadCover]
  );

  useEffect(
    () => {
      if (shouldLoadCover) return;
      const node = cardRef.current;
      if (!node) return;

      if (typeof IntersectionObserver === "undefined") {
        setShouldLoadCover(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShouldLoadCover(true);
            observer.disconnect();
          }
        },
        {
          root: rootRef.current ?? null,
          rootMargin: homeCalendarCoverLoadMargin,
          threshold: 0.01,
        }
      );

      observer.observe(node);
      return () => observer.disconnect();
    },
    [rootRef, shouldLoadCover]
  );

  const coverSources = useCachedImageSources(headerSources);
  const {
    source: coverSource,
    loaded,
    failed,
  } = useLoadableImageCover(coverSources);
  const hasLoadedHeader =
    shouldLoadCover && loaded && coverSources.includes(coverSource);
  const layeredSources = hasLoadedHeader ? [coverSource] : [];

  return (
    <button
      ref={cardRef}
      type="button"
      aria-label={game.title}
      className={`home-calendar-card${
        hasLoadedHeader ? "" : " home-calendar-card--skeleton"
      }${failed ? " home-calendar-card--fallback" : ""}`}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-calendar-card__cover${
          hasLoadedHeader ? " home-calendar-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
    </button>
  );
}

const HomeCalendarGameCard = memo(HomeCalendarGameCardComponent);

// Tracks the rail's own width rather than the viewport so the column count
function useCalendarVisibleDays(isMaximized: boolean) {
  return isMaximized
    ? homePersonalCalendarDays
    : homePersonalCalendarNarrowDays;
}

function useWideHomeLayout(isMaximized: boolean) {
  const [hasWideViewport, setHasWideViewport] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia(homeWideLayoutMediaQuery).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(homeWideLayoutMediaQuery);
    const update = () => setHasWideViewport(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMaximized || hasWideViewport;
}

function HomePersonalCalendar({
  title,
  games,
  cycleStart,
  language,
  loading,
  isMaximized,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  cycleStart: string;
  language: "pt" | "en";
  loading: boolean;
  isMaximized: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const gamesPerDay = homePersonalCalendarGamesPerDay;
  const isVisible = games.length > 0 || loading;
  const visibleDays = useCalendarVisibleDays(isMaximized);
  const weekdays = getPersonalCalendarDates(
    language,
    cycleStart,
    homePersonalCalendarDays
  ).slice(0, visibleDays);

  if (!isVisible) return null;

  return (
    <section className="home-calendar" aria-label={title}>
      <SectionHeader title={title} />
      <div className="home-calendar__rail" ref={calendarRef}>
        <div className="home-calendar__carousel">
          <div
            className="home-calendar__track"
            style={{ "--home-calendar-columns": visibleDays } as CSSProperties}
          >
            {weekdays.map((date, dayIndex) => {
              const dayGames = games.slice(
                dayIndex * gamesPerDay,
                dayIndex * gamesPerDay + gamesPerDay
              );

              return (
                <section className="home-calendar-day" key={date} aria-label={date}>
                  <h3 className="home-calendar-day__title">{date}</h3>
                  <div className="home-calendar-day__games">
                    {Array.from({ length: gamesPerDay }, (_, gameIndex) => {
                      const game = dayGames[gameIndex];
                      return game ? (
                        <HomeCalendarGameCard
                          key={homeGameKey(game)}
                          game={game}
                          rootRef={calendarRef}
                          onOpenGame={onOpenGame}
                          onGameContextMenu={onGameContextMenu}
                        />
                      ) : (
                        <span
                          key={`placeholder-${gameIndex}`}
                          className="home-calendar-card home-calendar-card--empty"
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Rail genérico de descoberta: mesma estrutura visual do rail de recomendados
 * (por isso o `blockName`), com card de capa + nome + pills. Enquanto a fonte
 * não responde, mantém a altura da seção com skeletons em vez de sumir e
 * empurrar tudo que está abaixo quando os dados chegam.
 */
function HomeGameShelf({
  title,
  titleContent,
  shelf,
  language,
  showMetadata = true,
  variant = "tile",
  upcomingLabel = "",
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  /** Heading rico; `title` continua sendo o texto acessível da seção. */
  titleContent?: ReactNode;
  shelf: HomeShelf;
  language: "pt" | "en";
  /** Desliga a superfície de baixo (nome + pills): card só de arte com zoom. */
  showMetadata?: boolean;
  /** `portrait` troca o `header.jpg` pela `hero_capsule` (374x448) da loja. */
  variant?: HomeCategoryCardVariant;
  /** Rótulo da pill dos jogos ainda não lançados. */
  upcomingLabel?: string;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  if (!shelf.games.length) {
    if (!shelf.loading) return null;

    return (
      <section className="home-recommended" aria-label={title}>
        <SectionHeader title={title} titleContent={titleContent} />
        <div className="home-recommended__rail">
          <div className="home-recommended__carousel">
            <div className="home-recommended__track">
              {Array.from({ length: homeRecommendedCardCount }, (_, index) => (
                <HomeCategoryCardSkeleton
                  key={`shelf-skeleton-${index}`}
                  variant={variant}
                  showTitle={showMetadata}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <Shelf
      blockName="home-recommended"
      title={title}
      titleContent={titleContent}
      items={shelf.games}
      getKey={homeGameKey}
      minItemsForControls={homeRecommendedCardCount}
      prevLabel={language === "en" ? "Previous game" : "Jogo anterior"}
      nextLabel={language === "en" ? "Next game" : "Próximo jogo"}
      renderItem={(game) => (
        <HomeCategoryCard
          game={game}
          variant={variant}
          showMetadata={showMetadata}
          showTitle={showMetadata}
          language={language}
          badgeLabel={
            upcomingLabel && shelf.upcomingAppIds.has(homeGameAppId(game))
              ? upcomingLabel
              : ""
          }
          onOpenGame={onOpenGame}
          onGameContextMenu={onGameContextMenu}
        />
      )}
    />
  );
}

/**
 * Arte larga do banner: só `library_hero`/`library_hero_2x` (mesmo aspecto do
 * frame, 1920×620). Screenshot (16:9) e header (460×215) têm outro aspecto e,
 * com `background-size: cover`, cortam na vertical e entram em baixa
 * resolução — melhor segurar o fundo chapado do que pintar a rede errada.
 */
function homeBannerArtSources(game: GhostBoxGame) {
  return gameHeroSources(game);
}

/**
 * Camada de arte do banner. Todas as fatias da janela ficam montadas ao mesmo
 * tempo e só trocam de opacidade — é o que permite o cross-fade; desmontar a
 * anterior cortaria a saída no primeiro frame.
 */
function HomeBannerArt({
  game,
  active,
}: {
  game: GhostBoxGame;
  active: boolean;
}) {
  // Chave estável por jogo: o enriquecimento recria o objeto (título,
  // screenshots) e refazer a cadeia a cada merge reiniciava o `Image()` em
  // voo, piscando a arte de volta para a primeira URL de baixa resolução. As
  // URLs líderes derivam só do appId, então a lista segue válida após o merge.
  const fallbackSources = useMemo(
    () => homeBannerArtSources(game),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.appId, game.id, game.heroUrl, game.hero]
  );
  const cachedSources = useCachedImageSources(fallbackSources);
  // `preferOrder` faz o walk respeitar o ranking da lista (library_hero
  // primeiro). Sem ele, o atalho de sessão pinta qualquer source já decodificada
  // — um screenshot carregado por outro card vencia o hero e a capa do banner
  // trocava de arte depois que a fonte de maior prioridade terminava.
  const { source, loaded } = useLoadableImageCover(cachedSources, {
    preferOrder: true,
  });

  return (
    <span
      className={`home-banner__art${active ? " home-banner__art--active" : ""}${
        loaded ? " home-banner__art--loaded" : ""
      }`}
      // Nada pintado até carregar: exibir a primeira URL crua enquanto o
      // `Image()` resolve mostrava a arte parcial/cortada e depois trocava de
      // resolução de repente quando a fonte preferida terminava.
      style={layeredImageStyle(loaded && source ? [source] : [], "")}
      aria-hidden="true"
    />
  );
}

function HomeRecommendedHero({
  title,
  shelf,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  shelf: HomeShelf;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const { t } = useSettings();
  const games = shelf.games;
  const [index, setIndex] = useState(0);
  // Direção da última navegação: as animações de entrada/saída viajam no mesmo
  // sentido do clique, senão o banner "volta" enquanto o usuário avança.
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const cancelPreload = runWhenIdle(() => {
      void preloadHomeRecommendedGroup(games);
    }, 450);

    return cancelPreload;
  }, [games]);

  // Pool trocou (rotação semanal, enriquecimento): volta ao primeiro jogo em
  // vez de manter um índice que agora aponta para outro título.
  const gamesKey = games.map(homeGameKey).join("|");
  useEffect(() => {
    setIndex(0);
    setDirection(1);
  }, [gamesKey]);

  if (!games.length) {
    if (!shelf.loading) return null;

    return (
      <section className="home-banner" aria-label={title}>
        <div className="home-banner__frame home-banner__frame--skeleton" />
      </section>
    );
  }

  const safeIndex = Math.min(index, games.length - 1);
  const game = games[safeIndex];
  const hasControls = games.length > 1;
  const shortDescription = getHomeBannerDescription(game, language);

  const go = (step: 1 | -1) => {
    setDirection(step);
    setIndex((current) => {
      const next = (current + step + games.length) % games.length;
      return next;
    });
  };

  // Só as fatias vizinhas ficam montadas: o cross-fade precisa da anterior e a
  // próxima entra já carregada, sem puxar `library_hero` do pool inteiro.
  const mountedIndexes = Array.from(
    new Set([
      (safeIndex - 1 + games.length) % games.length,
      safeIndex,
      (safeIndex + 1) % games.length,
    ])
  );

  return (
    <section
      className="home-banner"
      aria-label={title}
      aria-roledescription="carousel"
    >
      {/* Sem heading visível: o banner é full-bleed e abre a aba colado no topo.
          `title` segue como `aria-label` da seção. */}
      <div className="home-banner__frame" data-direction={direction}>
        <button
          type="button"
          className="home-banner__surface"
          aria-label={t("home.bannerGoToGame", { title: game.title })}
          onClick={() => onOpenGame(game)}
          onContextMenu={(event) => {
            if (!onGameContextMenu) return;
            event.preventDefault();
            onGameContextMenu(game, event.clientX, event.clientY);
          }}
        >
          {mountedIndexes.map((mountedIndex) => (
            <HomeBannerArt
              key={homeGameKey(games[mountedIndex])}
              game={games[mountedIndex]}
              active={mountedIndex === safeIndex}
            />
          ))}
          <span className="home-banner__scrim" aria-hidden="true" />
          <span
            className="home-banner__info"
            key={homeGameKey(game)}
            aria-live="polite"
          >
            <strong className="home-banner__title">
              {getDisplayGameTitle(
                game,
                language === "en" ? "Untitled game" : "Jogo sem título"
              )}
            </strong>
            <span className="home-banner__description">{shortDescription}</span>
          </span>
        </button>
        {hasControls ? (
          <>
            <button
              type="button"
              className="home-banner__arrow home-banner__arrow--prev"
              aria-label={t("home.recommendedPreviousGame")}
              onClick={() => go(-1)}
            >
              <ChevronLeft size={30} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="home-banner__arrow home-banner__arrow--next"
              aria-label={t("home.recommendedNextGame")}
              onClick={() => go(1)}
            >
              <ChevronRight size={30} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="home-banner__dots" aria-hidden="true">
              {games.map((dotGame, dotIndex) => (
                <span
                  key={homeGameKey(dotGame)}
                  className={`home-banner__dot${
                    dotIndex === safeIndex ? " home-banner__dot--active" : ""
                  }`}
                />
              ))}
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}


/**
 * Review positiva de um jogador (citação + autor + horas no momento da review).
 * As classes seguem sendo as de `home-wishlist-card` porque a folha de estilo
 * inteira do bloco de review vive lá; `className` entra por cima para o
 * contexto que reaproveita o componente (ver `HomeTopRatedCard`).
 */
function HomePlayerReview({
  game,
  language,
  className = "",
}: {
  game: GhostBoxGame;
  language: "pt" | "en";
  className?: string;
}) {
  const appId = homeGameAppId(game);
  const reviewLanguage = language === "en" ? "english" : "brazilian";
  const cachedReview = appId
    ? readStoredSteamWishlistReview(appId, reviewLanguage)
    : null;
  const reviewRef = useRef<HTMLSpanElement | null>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [review, setReview] = useState<SteamGameReview | null>(
    () => cachedReview?.review ?? null
  );
  const [isLoading, setIsLoading] = useState(() => !cachedReview);

  useEffect(() => {
    if (!appId) {
      setReview(null);
      setIsLoading(false);
      return;
    }

    const nextCachedReview = readStoredSteamWishlistReview(appId, reviewLanguage);
    setReview(nextCachedReview?.review ?? null);
    setIsLoading(!nextCachedReview);
    setHasBeenVisible(Boolean(nextCachedReview));
  }, [appId, reviewLanguage]);

  useEffect(() => {
    if (hasBeenVisible) return;
    const node = reviewRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px 200px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  useEffect(() => {
    if (!hasBeenVisible) return;
    let cancelled = false;
    if (!appId) {
      setIsLoading(false);
      return;
    }

    const cachedReview = readStoredSteamWishlistReview(appId, reviewLanguage);
    if (cachedReview) {
      setReview(cachedReview.review);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setReview(null);

    void loadGameReviews(appId, reviewLanguage, "positive")
      .then((result) => {
        if (cancelled) return;
        const nextReview = result.reviews?.find((item) => item.review.trim()) ?? null;
        setReview(nextReview);
        if (nextReview) {
          writeStoredSteamWishlistReview({
            appId,
            language: reviewLanguage,
            expiresAt: new Date(Date.now() + homeWishlistReviewCacheMs).toISOString(),
            review: nextReview,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setReview(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, reviewLanguage, hasBeenVisible]);

  if (isLoading) {
    return (
      <HomeWishlistReviewSkeleton
        rootRef={reviewRef}
        className={className}
        ariaHidden
      />
    );
  }

  if (!review) return null;

  const avatarUrl = steamReviewAvatarUrl(review.author.avatar);
  const authorName = review.author.personaname || "Steam user";
  const playtimeAtReview = review.author.playtime_at_review ?? 0;
  const reviewText = normalizeSteamReviewText(review.review);
  if (!reviewText) return null;

  return (
    <span
      className={`home-wishlist-card__player-review home-wishlist-card__player-review--loaded${
        className ? ` ${className}` : ""
      }`}
    >
      <span className="home-wishlist-card__player-review-quote">
        "{reviewText}"
      </span>
      <span className="home-wishlist-card__player-review-author">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="home-wishlist-card__player-review-avatar" />
        )}
        <span>
          <strong>{authorName}</strong>
          <small>
            {formatCompactPlaytime(playtimeAtReview * 60_000)} {language === "en" ? "at review" : "no momento da review"}
          </small>
        </span>
      </span>
    </span>
  );
}

function HomeWishlistCardComponent({
  game,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const coverSources = homeWishlistCoverSources(game);
  const sources = useCachedImageSources(coverSources);
  const { source: imageSource, loaded } = useLoadableImageCover(sources);

  const handleClick = () => onOpenGame(game);
  const handleContextMenu = (event: React.MouseEvent) => {
    if (!onGameContextMenu) return;
    event.preventDefault();
    onGameContextMenu(game, event.clientX, event.clientY);
  };

  return (
    <div className="home-wishlist-card">
      {/* Mesmo padrão do card de "Bem avaliados": botão cobre o card inteiro,
          review fica fora dele como texto irmão em vez de definir o nome
          acessível do controle. */}
      <button
        type="button"
        className="home-wishlist-card__hit"
        aria-label={game.title}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      <span className="home-wishlist-card__media home-wishlist-card__media--single">
        <span
          className={`home-wishlist-card__cover${loaded ? " home-wishlist-card__cover--loaded" : ""}`}
        >
          {imageSource && (
            <img
              src={imageSource}
              alt=""
              draggable={false}
              decoding="async"
            />
          )}
        </span>
        <span className="home-wishlist-card__details">
          <HomePlayerReview game={game} language={language} />
        </span>
      </span>
    </div>
  );
}

const HomeWishlistCard = memo(HomeWishlistCardComponent);

function HomeWishlistRecommendations({
  title,
  games,
  loading,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  loading: boolean;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  if (!games.length && !loading) return null;

  return (
    <section className="home-wishlist" aria-label={title}>
      <SectionHeader title={title} />
      <div className="home-wishlist__list">
        {loading && games.length === 0
          ? Array.from({ length: homeWishlistCycleGameCount }, (_, index) => (
              <HomeWishlistCardSkeleton key={`wishlist-skeleton-${index}`} />
            ))
          : games.map((game) => (
              <HomeWishlistCard
                key={homeGameAppId(game)}
                game={game}
                language={language}
                onOpenGame={onOpenGame}
                onGameContextMenu={onGameContextMenu}
              />
            ))}
      </div>
    </section>
  );
}

export function HomePage({
  onOpenGame,
  libraryGameAppIds,
  libraryGames,
  favoriteGames,
  historyGames,
  onOpenCatalogueCategory,
  steamProfile,
}: {
  onOpenGame: (game: GhostBoxGame) => void;
  libraryGameAppIds: Set<string>;
  libraryGames: GhostBoxGame[];
  favoriteGames: GhostBoxGame[];
  historyGames: GhostBoxGame[];
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
  steamProfile: SteamProfile | null;
}) {
  const { appearance, t } = useSettings();
  const isMaximized = useWindowMaximized();
  const isWideLayout = useWideHomeLayout(isMaximized);
  // Always anchored to "today": a stored start from a previous day would label
  // the columns with dates that already passed.
  const [personalCalendarCycleStart, setPersonalCalendarCycleStart] = useState(() =>
    getPersonalCalendarCycleStart().toISOString()
  );
  const [personalCalendarGames, setPersonalCalendarGames] = useState<GhostBoxGame[]>([]);
  const [isLoadingPersonalCalendar, setIsLoadingPersonalCalendar] = useState(false);
  const [wishlistRecommendations, setWishlistRecommendations] = useState<GhostBoxGame[]>([]);
  const [isLoadingWishlistRecommendations, setIsLoadingWishlistRecommendations] = useState(false);
  const [homeContextMenu, setHomeContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

  const { shelves, explorePool } = useHomeShelves({
    language: appearance.language,
    libraryGameAppIds,
    libraryGames,
    favoriteGames,
    historyGames,
    steamId: steamProfile?.steamId,
  });

  // Stable identity so memoized cards don't re-render whenever HomePage does.
  const handleGameContextMenu = useCallback(
    (gameItem: GhostBoxGame, x: number, y: number) =>
      setHomeContextMenu({ game: gameItem, x, y }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    let refreshTimeout: number | undefined;

    function schedulePersonalCalendarRefresh(calendar: StoredPersonalCalendar | null) {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      if (!calendar) return;

      const delay = Date.parse(calendar.expiresAt) - Date.now() + 500;
      refreshTimeout = window.setTimeout(
        () => void loadPersonalCalendar(),
        Math.max(1000, delay)
      );
    }

    async function loadPersonalCalendar() {
      setIsLoadingPersonalCalendar(true);

      try {
        const currentStoredCalendar = readStoredPersonalCalendar();

        // Pool e wishlist em paralelo: a wishlist só alimenta as exclusões do
        // planejamento, e o pool tem folga grande (120 candidatos para escolher
        // 8) para absorver os jogos que acabarem excluídos. Serializar as duas
        // viagens de rede atrasava a seção inteira sem ganho de precisão.
        const wishlistPromise = steamProfile?.steamId
          ? loadSteamWishlist(steamProfile.steamId).catch(() => [])
          : null;

        const pool = await loadHomePersonalCalendarPool(
          new Set(libraryGameAppIds)
        );
        if (cancelled) return;

        const excludedGameIds = new Set(libraryGameAppIds);
        const wishlistItems = wishlistPromise ? await wishlistPromise : [];
        if (cancelled) return;
        wishlistItems.forEach((item) => {
          const appId = item.appId.trim();
          if (appId) excludedGameIds.add(appId);
        });
        const recentWishlist = readStoredSteamWishlistCycle();
        if (recentWishlist && recentWishlist.steamId === steamProfile?.steamId) {
          recentWishlist.history.flat().forEach((appId) => excludedGameIds.add(appId));
        }

        // Each date keeps the games it was already assigned; only empty or
        // no-longer-available slots are re-picked, so a day is never swapped
        // before it is reached.
        const cycleStart = getPersonalCalendarCycleStart();
        const { games: selectedGames, dayGameIds } = planPersonalCalendar(pool, {
          days: homePersonalCalendarDays,
          gamesPerDay: homePersonalCalendarGamesPerDay,
          cycleStart,
          storedCalendar: currentStoredCalendar,
          excludedGameIds,
        });

        if (!selectedGames.length) {
          setPersonalCalendarGames([]);
          schedulePersonalCalendarRefresh(null);
          return;
        }

        const nextCalendar = createPersonalCalendar({
          dayGameIds,
          storedCalendar: currentStoredCalendar,
          cycleStart,
          days: homePersonalCalendarDays,
        });
        writeStoredPersonalCalendar(nextCalendar);
        setPersonalCalendarCycleStart(nextCalendar.cycleStart);
        setPersonalCalendarGames(selectedGames);
        schedulePersonalCalendarRefresh(nextCalendar);
      } finally {
        if (!cancelled) setIsLoadingPersonalCalendar(false);
      }
    }

    void loadPersonalCalendar();

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const calendar = readStoredPersonalCalendar();
      if (!isStoredPersonalCalendarFresh(calendar, homePersonalCalendarGameCount)) {
        void loadPersonalCalendar();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [libraryGameAppIds, steamProfile?.steamId]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimeout: number | undefined;
    let retryAt = 0;
    let inFlight: Promise<void> | null = null;

    function scheduleWishlistCycleRefresh(cycle: { expiresAt: string } | null) {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      if (!cycle) return;

      retryAt = 0;
      const delay = Date.parse(cycle.expiresAt) - Date.now() + 500;
      refreshTimeout = window.setTimeout(
        () => void runWishlistCycle(),
        Math.max(1000, delay)
      );
    }

    function scheduleWishlistCycleRetry() {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      retryAt = Date.now() + homeWishlistRetryMs;
      refreshTimeout = window.setTimeout(
        () => void runWishlistCycle(),
        homeWishlistRetryMs
      );
    }

    async function loadWishlistCycle() {
      if (!steamProfile?.steamId) {
        setWishlistRecommendations([]);
        return;
      }
      setIsLoadingWishlistRecommendations(true);

      try {
        const storedCycle = readStoredSteamWishlistCycle();
        const hasFreshStoredCycle = isStoredWishlistCycleFresh(
          storedCycle,
          steamProfile.steamId,
          homeWishlistCycleGameCount
        );
        let retainedGames: GhostBoxGame[] = [];

        if (hasFreshStoredCycle) {
          const cachedAppIds = storedCycle.gameIds.filter(
            (appId) => appId && !libraryGameAppIds.has(appId)
          );
          retainedGames = await Promise.all(
            cachedAppIds.map((appId, index) => loadWishlistDisplayGame(appId, index))
          );
          if (cancelled) return;
          setWishlistRecommendations(retainedGames);

          if (retainedGames.length === homeWishlistCycleGameCount) {
            scheduleWishlistCycleRefresh(storedCycle);
            return;
          }
        }

        const wishlistItems = await loadSteamWishlist(steamProfile.steamId);
        if (cancelled) return;

        const newAppIds = getUniqueWishlistAppIds(wishlistItems, libraryGameAppIds);
        const wishlistTitleByAppId = new Map(
          wishlistItems.flatMap((item) => {
            const title = item.title?.trim();
            return title ? [[item.appId, title] as const] : [];
          })
        );

        if (newAppIds.length === 0) {
          setWishlistRecommendations(retainedGames);
          scheduleWishlistCycleRetry();
          return;
        }

        const cycleStart = hasFreshStoredCycle
          ? new Date(storedCycle.cycleStart)
          : getWishlistCycleStart();
        const sourceOffset =
          (getWishlistCycleIndex(cycleStart) * homeWishlistCycleSourceCount) %
          newAppIds.length;
        const sourceAppIds = Array.from(
          { length: Math.min(homeWishlistCycleSourceCount, newAppIds.length) },
          (_, index) => newAppIds[(sourceOffset + index) % newAppIds.length]
        );
        const sourceGames = await Promise.all(
          sourceAppIds.map(async (appId, index) => {
            const fallback = createWishlistFallbackGame(
              appId,
              index,
              wishlistTitleByAppId.get(appId)
            );
            return (await loadGameStoreDetails(appId).catch(() => null)) ?? fallback;
          })
        );
        if (cancelled) return;

        const similarBySource = await Promise.all(
          sourceGames.map((game) =>
            loadSteamSimilarAppIds(homeGameAppId(game)).catch(() => [])
          )
        );
        const similarAppIds: string[] = [];
        const seenSimilarAppIds = new Set<string>();
        for (let round = 0; similarAppIds.length < homeWishlistSimilarPoolLimit; round += 1) {
          let foundInRound = false;
          for (const appIds of similarBySource) {
            const appId = appIds[round];
            if (!appId) continue;
            foundInRound = true;
            if (seenSimilarAppIds.has(appId)) continue;
            seenSimilarAppIds.add(appId);
            similarAppIds.push(appId);
            if (similarAppIds.length === homeWishlistSimilarPoolLimit) break;
          }
          if (!foundInRound) break;
        }
        const similarGames = (
          await Promise.all(
            similarAppIds.map((appId) =>
              loadGameStoreDetails(appId).catch(() => null)
            )
          )
        ).filter((game): game is GhostBoxGame => Boolean(game));
        if (cancelled) return;

        const recentCalendar = readStoredPersonalCalendar();
        const fixedExcludedAppIds = [
          ...newAppIds,
          ...libraryGameAppIds,
          ...(recentCalendar?.gameIds ?? []),
          ...retainedGames.map(homeGameAppId),
        ];
        const wishlistHistory = storedCycle?.history ?? [];
        const calendarHistory = Object.values(recentCalendar?.monthGameIds ?? {}).flat();
        const exclusionsFor = (historyDays: number, includeCalendarHistory: boolean) =>
          new Set([
            ...fixedExcludedAppIds,
            ...wishlistHistory.slice(0, historyDays).flat(),
            ...(includeCalendarHistory ? calendarHistory : []),
          ]);
        let excludedAppIds = exclusionsFor(homeWishlistCycleHistoryLimit, true);
        const sourceTraits = sourceGames.flatMap((game) => [...game.tags, ...game.genres]);
        const missingGameCount = homeWishlistCycleGameCount - retainedGames.length;
        let replacementGames = pickWishlistCycleGames(similarGames, {
          gameCount: missingGameCount,
          sourceTraits,
          excludedAppIds,
        });

        if (replacementGames.length < missingGameCount) {
          const [popularResult, recommendedTags] = await Promise.all([
            loadGames({ query: "", limit: 30, sort: "popular" }).catch(() => ({ games: [] })),
            loadSteamRecommendedTagsForUser(steamProfile.steamId).catch(() => []),
          ]);
          if (cancelled) return;
          const fallbackCandidates = [...similarGames, ...popularResult.games];
          for (const [historyDays, includeCalendarHistory] of [
            [homeWishlistCycleHistoryLimit, true],
            [30, true],
            [14, true],
            [7, false],
            [0, false],
          ] as const) {
            excludedAppIds = exclusionsFor(historyDays, includeCalendarHistory);
            replacementGames = pickWishlistCycleGames(fallbackCandidates, {
              gameCount: missingGameCount,
              sourceTraits,
              userTraits: steamRecommendedTagNames(recommendedTags),
              excludedAppIds,
            });
            if (replacementGames.length === missingGameCount) break;
          }
        }

        const selectedGames = [...retainedGames, ...replacementGames];
        if (selectedGames.length < homeWishlistCycleGameCount) {
          setWishlistRecommendations(selectedGames);
          scheduleWishlistCycleRetry();
          return;
        }

        const nextCycle = createWishlistCycle({
          steamId: steamProfile.steamId,
          selectedGames,
          storedCycle,
          cycleStart,
          historyLimit: homeWishlistCycleHistoryLimit,
        });
        if (cancelled) return;
        setWishlistRecommendations(selectedGames);
        writeStoredSteamWishlistCycle(nextCycle);
        scheduleWishlistCycleRefresh(nextCycle);
      } catch {
        if (!cancelled) scheduleWishlistCycleRetry();
      } finally {
        if (!cancelled) setIsLoadingWishlistRecommendations(false);
      }
    }

    function runWishlistCycle() {
      if (!inFlight) {
        inFlight = loadWishlistCycle().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    }

    const cancelIdleWishlistLoad = runWhenIdle(() => {
      void runWishlistCycle();
    }, 2200);

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const cycle = readStoredSteamWishlistCycle();
      const hasUsableCycle = isStoredWishlistCycleFresh(
        cycle,
        steamProfile?.steamId,
        homeWishlistCycleGameCount
      ) && cycle.gameIds.every((appId) => !libraryGameAppIds.has(appId));
      if (!hasUsableCycle && Date.now() >= retryAt) {
        void runWishlistCycle();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      cancelIdleWishlistLoad();
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [steamProfile?.steamId, libraryGameAppIds]);

  const exploreCategories = useMemo(
    () => getHomeExploreCategories(explorePool),
    [explorePool]
  );
  const enrichedPersonalCalendarGames = useEnrichedGameCards(
    personalCalendarGames,
    homePersonalCalendarEnrichmentLimit,
    true,
    false
  );
  const homeContextMenuItems = useGameContextMenu({
    game: homeContextMenu?.game ?? null,
    onOpenGame,
  });
  return (
    <section className={`home-page${isWideLayout ? " home-page--maximized" : ""}`} aria-label={t("home.pageAria")}>
      <HomeRecommendedHero
        title={t("home.recommended")}
        shelf={shelves.recommended}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeGameShelf
        title={t("home.newReleases")}
        shelf={shelves.newReleases}
        language={appearance.language}
        upcomingLabel={t("home.comingSoon")}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeGameShelf
        title={t("home.topSellers")}
        shelf={shelves.topSellers}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeTopRatedShelf
        title={t("home.mostPlayed")}
        shelf={shelves.topRated}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeExploreCategories
        title={t("home.exploreByCategory")}
        categories={exploreCategories}
        allGames={explorePool}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
      />
      <HomePersonalCalendar
        title={t("home.personalCalendar")}
        games={enrichedPersonalCalendarGames}
        cycleStart={personalCalendarCycleStart}
        language={appearance.language}
        loading={isLoadingPersonalCalendar}
        isMaximized={isWideLayout}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeWishlistRecommendations
        title={t("home.steamWishlist")}
        games={wishlistRecommendations}
        loading={isLoadingWishlistRecommendations}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      {homeContextMenu && homeContextMenuItems.length > 0 && (
        <ContextMenu
          x={homeContextMenu.x}
          y={homeContextMenu.y}
          items={homeContextMenuItems}
          onClose={() => setHomeContextMenu(null)}
        />
      )}
    </section>
  );
}
