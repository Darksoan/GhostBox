import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GhostBoxGame } from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem } from "../types";
import { loadGames, loadGameReviews, loadGameStoreDetails, loadSteamRecommendedTagsForUser, loadSteamSimilarAppIds, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import {
  HomeWishlistCardSkeleton,
  HomeWishlistReviewSkeleton,
} from "../components/ui/LoadingStates";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Shelf } from "../components/ui/Shelf";
import { useSettings } from "../context/settings";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
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
  gameHeaderOnlySources,
  gameHeroSources,
  gameHeroCapsuleSources,
  layeredImageStyle,
} from "../utils/image";
import { loadedImageSources, runWhenIdle } from "../utils/imageCache";
import { createSeedGame, type GameSeed } from "../utils/gameSeed";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";
import { formatCompactPlaytime } from "../utils/time";
import {
  createPersonalCalendar,
  getPersonalCalendarCycleStart,
  getPersonalCalendarDates,
  getUniquePersonalCalendarPool,
  isStoredPersonalCalendarFresh,
  personalCalendarGameKey,
  pickPersonalCalendarGames,
} from "../utils/personalCalendar";
import {
  createWishlistCycle,
  getWishlistCycleIndex,
  getWishlistCycleStart,
  homeWishlistCycleHistoryLimit,
  isStoredWishlistCycleFresh,
  pickWishlistCycleGames,
} from "../utils/wishlistCycle";

type HomeGameSeed = GameSeed;

type HomeCategoryCardVariant = "tile" | "portrait";

type HomeExploreCategory = {
  label: string;
  filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
  filterValue: string;
  games: GhostBoxGame[];
  score: number;
};

const topReviewedSteamGames: HomeGameSeed[] = [
  {
    appId: "2050650",
    title: "Resident Evil 4",
    shortDescription:
      "Survival horror reimagined with modern combat, constant tension, and a rescue mission in a village controlled by a brutal threat.",
  },
  {
    appId: "1030300",
    title: "Hollow Knight: Silksong",
    shortDescription:
      "Explore a haunted kingdom in a handcrafted action adventure with precise combat, secrets, and acrobatic movement.",
  },
  {
    appId: "1449690",
    title: "The Walking Dead: The Telltale Definitive Series",
    shortDescription:
      "A complete narrative journey through The Walking Dead universe, with hard choices, memorable characters, and emotional consequences.",
  },
  {
    appId: "1817070",
    title: "Marvel's Spider-Man Remastered",
    shortDescription:
      "Experience the story of a seasoned Peter Parker as he faces major threats and swings through New York with fluid acrobatics.",
  },
  { appId: "1693980", title: "Dead Space" },
  { appId: "208650", title: "Batman: Arkham Knight" },
  { appId: "413150", title: "Stardew Valley" },
  { appId: "1714320", title: "Find Love or Die Trying" },
];

const homeFeaturedSteamGames: HomeGameSeed[] = [
  { appId: "1332010", title: "Stray" },
  { appId: "391220", title: "Rise of the Tomb Raider" },
  { appId: "1903340", title: "Clair Obscur: Expedition 33" },
  { appId: "1222140", title: "Detroit: Become Human" },
  { appId: "814380", title: "R.U.S.E." },
  { appId: "239140", title: "Dying Light" },
  { appId: "1145360", title: "Hades" },
  { appId: "413150", title: "Stardew Valley" },
  { appId: "1086940", title: "Baldur's Gate 3" },
  { appId: "1091500", title: "Cyberpunk 2077" },
  { appId: "292030", title: "The Witcher 3: Wild Hunt" },
  { appId: "620", title: "Portal 2" },
  { appId: "105600", title: "Terraria" },
  { appId: "294100", title: "RimWorld" },
  { appId: "588650", title: "Dead Cells" },
  { appId: "1794680", title: "Vampire Survivors" },
  { appId: "504230", title: "Celeste" },
  { appId: "646570", title: "Slay the Spire" },
  { appId: "427520", title: "Factorio" },
  { appId: "1868140", title: "DAVE THE DIVER" },
  { appId: "1245620", title: "ELDEN RING" },
  { appId: "1593500", title: "God of War" },
  { appId: "1174180", title: "Red Dead Redemption 2" },
  { appId: "1850570", title: "DEATH STRANDING DIRECTOR'S CUT" },
  { appId: "1551360", title: "Forza Horizon 5" },
  { appId: "1238840", title: "Battlefield 1" },
  { appId: "250900", title: "The Binding of Isaac: Rebirth" },
  { appId: "268910", title: "Cuphead" },
  { appId: "489830", title: "The Elder Scrolls V: Skyrim Special Edition" },
  { appId: "1151640", title: "Horizon Zero Dawn Complete Edition" },
  { appId: "220", title: "Half-Life 2" },
  { appId: "945360", title: "Among Us" },
];

const homeCarouselGroupSize = 4;
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
// aparecerem: com pool menor ou igual a isto não há o que rolar.
const homeRecommendedCardCount = 3;
// Teto do texto da descrição curta. O card fecha em duas linhas via
// `-webkit-line-clamp`; o corte aqui garante reticências mesmo quando o
// navegador não aplica as do clamp (texto de uma linha só, muito longo).
const homeShortDescriptionLimit = 150;
const homeRecommendedGroupPreloadTimeoutMs = 1800;
const homeRecommendedAppIdGroups = [
  ["1693980", "208650", "413150", "1714320"],
];
const homePersonalCalendarDays = 3;
const homePersonalCalendarGamesPerDay = 2;
const homePersonalCalendarGameCount =
  homePersonalCalendarDays * homePersonalCalendarGamesPerDay;
const homePersonalCalendarPageSize = 120;
const homePersonalCalendarPoolTarget = homePersonalCalendarGameCount * 15;
const homePersonalCalendarEnrichmentLimit = 6;
const homePersonalCalendarRefreshMs = 7 * 24 * 60 * 60 * 1000;
const homeCalendarCoverLoadMargin = "360px 720px";
const homeWishlistCycleSourceCount = 6;
const homeWishlistSimilarPoolLimit = 16;
const homeWishlistCycleGameCount = 4;
const homeWishlistCacheRefreshMs = 7 * 24 * 60 * 60 * 1000;
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
      if (source) loadedImageSources.add(source);
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

function getSteamRecommendedTagName(tag: unknown) {
  if (!tag || typeof tag !== "object" || Array.isArray(tag)) return "";
  const record = tag as Record<string, unknown>;
  const value = record.name ?? record.tag_name ?? record.tagName;
  return typeof value === "string" ? normalizeHomeCategory(value) : "";
}

function normalizeSteamRecommendedTags(tags: unknown[]) {
  return [
    ...new Set(
      tags
        .map(getSteamRecommendedTagName)
        .filter(Boolean)
    ),
  ];
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

function getHomeMetadataCategoryPool(game: GhostBoxGame) {
  return Array.from(
    new Set(
      [...game.genres, ...game.tags]
        .map(normalizeHomeCategory)
        .filter(Boolean)
    )
  );
}

function HomeCategoryCard({
  game,
  variant = "tile",
  showMetadata = false,
  showSummary = false,
  showTitle = false,
  showSecondaryPills = false,
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
  const layeredSources = variant === "portrait"
    ? loaded && coverSource
      ? [coverSource]
      : []
    : coverSource
      ? [coverSource, ...fallbackCoverSources.filter((source) => source !== coverSource)]
      : fallbackCoverSources;
  const metadataCategoryPool = getHomeMetadataCategoryPool(game);
  const metadataCategories = metadataCategoryPool.slice(
    0,
    showSecondaryPills ? homeTopRatedPrimaryPillCount : homeMetadataCategoryLimit
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
              {metadataCategories.map((category) => (
                <span className="home-category-card__genre" key={category}>
                  {category}
                </span>
              ))}
            </span>
            {showSecondaryPills && secondaryCategories.length > 0 ? (
              <span className="home-category-card__tags">
                {secondaryCategories.map((category) => (
                  <span className="home-category-card__genre" key={category}>
                    {category}
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

function HomeCategorySection({
  title,
  games,
  className = "",
  variant = "tile",
  maxGames = 3,
  showMetadata = false,
  showTitle = false,
  showSecondaryPills = false,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  className?: string;
  variant?: HomeCategoryCardVariant;
  maxGames?: number;
  showMetadata?: boolean;
  showTitle?: boolean;
  showSecondaryPills?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);

  return (
    <section
      className={`home-category${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <SectionHeader title={title} />
      <div className="home-category__games">
        {Array.from({ length: maxGames }, (_, index) => {
          const game = visibleGames[index];
          return game ? (
            <HomeCategoryCard
              key={game.appId || game.id}
              game={game}
              variant={variant}
              showMetadata={showMetadata}
              showTitle={showTitle}
              showSecondaryPills={showSecondaryPills}
              onOpenGame={onOpenGame}
              onGameContextMenu={onGameContextMenu}
            />
          ) : (
            <span
              key={`placeholder-${index}`}
              className={`home-category-card home-category-card--${variant} home-category-card--empty`}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </section>
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

function normalizeHomeCategory(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    acao: "Action",
    ação: "Action",
    action: "Action",
    aventura: "Adventure",
    adventure: "Adventure",
    historia: "Story Rich",
    história: "Story Rich",
    story: "Story Rich",
    "story rich": "Story Rich",
    terror: "Horror",
    horror: "Horror",
    corrida: "Racing",
    racing: "Racing",
    esportes: "Sports",
    sports: "Sports",
    estrategia: "Strategy",
    estratégia: "Strategy",
    strategy: "Strategy",
    exploracao: "Exploration",
    exploração: "Exploration",
    exploration: "Exploration",
  };

  return aliases[normalized.toLowerCase()] ?? normalized;
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

function gameCategoryScore(game: GhostBoxGame) {
  const reviewScore = game.steamPositiveRatio ?? game.rating ?? 0;
  const popularityScore = game.recommendations ?? game.steamReviewCount ?? 0;
  return reviewScore * 100 + Math.log10(popularityScore + 1);
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
        normalized: normalizeHomeCategory(value),
      })),
      ...game.tags.map((value) => ({
        key: "tags" as const,
        value,
        normalized: normalizeHomeCategory(value),
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
    .slice(0, 15);
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
  const { source: imageSource } = useLoadableImageCover(cachedSources);

  return (
    <span
      className="home-explore-card__image"
      style={layeredImageStyle(imageSource ? [imageSource] : [], "")}
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

function HomePersonalCalendar({
  title,
  subtitle,
  games,
  cycleStart,
  language,
  loading,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle: string;
  games: GhostBoxGame[];
  cycleStart: string;
  language: "pt" | "en";
  loading: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const weekdays = getPersonalCalendarDates(
    language,
    cycleStart,
    homePersonalCalendarDays
  );
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const gamesPerDay = homePersonalCalendarGamesPerDay;

  if (!games.length && !loading) return null;

  return (
    <section className="home-calendar" aria-label={title}>
      <SectionHeader title={title} subtitle={subtitle || undefined} />
      <div className="home-calendar__rail" ref={calendarRef}>
        <div className="home-calendar__carousel">
          <div className="home-calendar__track">
            {weekdays.map((date, dayIndex) => {
              const dayGames = games.slice(
                dayIndex * gamesPerDay,
                dayIndex * gamesPerDay + gamesPerDay
              );

              return (
                <section className="home-calendar-day" key={date} aria-label={date}>
                  <h4 className="home-calendar-day__title">{date}</h4>
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

function HomeRecommendedHero({
  title,
  gameGroups,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  gameGroups: GhostBoxGame[][];
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const availableGroups = useMemo(
    () => gameGroups.filter((group) => group.length > 0),
    [gameGroups]
  );
  const poolGames = useMemo(
    () => (availableGroups[0] ?? []).slice(0, homeCarouselGroupSize),
    [availableGroups]
  );
  // O card mostra a short description, que só chega em `loadGameStoreDetails`.
  // Sem enriquecer, os três cards cairiam no fallback de gêneros.
  const enrichedGames = useEnrichedGameCards(poolGames, homeCarouselGroupSize);

  useEffect(() => {
    const cancelPreload = runWhenIdle(() => {
      void preloadHomeRecommendedGroup(availableGroups[0] ?? []);
    }, 450);

    return cancelPreload;
  }, [availableGroups]);

  // Mesmo rail de "Explorar por categoria": as setas rolam o carrossel com
  // `scroll-behavior: smooth` em vez de trocar os cards de uma vez, e somem nas
  // pontas. `minItemsForControls` cai para o número de cards visíveis — o padrão
  // (5) esconderia as setas com o pool atual de 4 jogos.
  return (
    <Shelf
      blockName="home-recommended"
      title={title}
      items={enrichedGames}
      getKey={homeGameKey}
      minItemsForControls={homeRecommendedCardCount}
      prevLabel={language === "en" ? "Previous game" : "Jogo anterior"}
      nextLabel={language === "en" ? "Next game" : "Próximo jogo"}
      renderItem={(game) => (
        <HomeCategoryCard
          game={game}
          variant="tile"
          showMetadata
          showSummary
          language={language}
          onOpenGame={onOpenGame}
          onGameContextMenu={onGameContextMenu}
        />
      )}
    />
  );
}

function HomeWishlistPlayerReview({
  game,
  language,
}: {
  game: GhostBoxGame;
  language: "pt" | "en";
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
            expiresAt: new Date(Date.now() + homeWishlistCacheRefreshMs).toISOString(),
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
    return <HomeWishlistReviewSkeleton rootRef={reviewRef} ariaHidden />;
  }

  if (!review) return null;

  const avatarUrl = steamReviewAvatarUrl(review.author.avatar);
  const authorName = review.author.personaname || "Steam user";
  const playtimeAtReview = review.author.playtime_at_review ?? 0;
  const reviewText = normalizeSteamReviewText(review.review);
  if (!reviewText) return null;

  return (
    <span className="home-wishlist-card__player-review">
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
  const recommendedTitle = getDisplayGameTitle(
    game,
    language === "en" ? "Steam recommendation" : "Recomendação da Steam"
  );
  const tags = [...game.tags, ...game.genres]
    .filter(Boolean)
    .slice(0, 3);

  const handleClick = () => onOpenGame(game);
  const handleContextMenu = (event: React.MouseEvent) => {
    if (!onGameContextMenu) return;
    event.preventDefault();
    onGameContextMenu(game, event.clientX, event.clientY);
  };

  return (
    <div
      className="home-wishlist-card"
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
    >
      <span className="home-wishlist-card__content">
        <strong className="home-wishlist-card__title">
          {recommendedTitle}
        </strong>
      </span>
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
          <HomeWishlistPlayerReview game={game} language={language} />
          {tags.length > 0 && (
            <span className="home-wishlist-card__tags">
              {tags.map((tag) => (
                <span key={tag} className="home-wishlist-card__tag">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

const HomeWishlistCard = memo(HomeWishlistCardComponent);

function HomeWishlistRecommendations({
  title,
  subtitle,
  games,
  loading,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle?: string;
  games: GhostBoxGame[];
  loading: boolean;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  if (!games.length && !loading) return null;

  return (
    <section className="home-wishlist" aria-label={title}>
      <SectionHeader title={title} subtitle={subtitle} />
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
  onOpenCatalogueCategory,
  steamProfile,
}: {
  onOpenGame: (game: GhostBoxGame) => void;
  libraryGameAppIds: Set<string>;
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
  steamProfile: SteamProfile | null;
}) {
  const { appearance, t } = useSettings();
  const [homeTopReviewedGames, setHomeTopReviewedGames] = useState<GhostBoxGame[]>(
    () =>
      topReviewedSteamGames.map((game, index) =>
        createSeedGame(game, index)
      )
  );
  const [homeFeaturedGames, setHomeFeaturedGames] = useState<GhostBoxGame[]>(() =>
    homeFeaturedSteamGames.map((game, index) =>
      createSeedGame(game, index, "")
    )
  );
  const [storedPersonalCalendar, setStoredPersonalCalendar] = useState<StoredPersonalCalendar | null>(() =>
    readStoredPersonalCalendar()
  );
  const [personalCalendarCycleStart, setPersonalCalendarCycleStart] = useState(() =>
    storedPersonalCalendar?.cycleStart ?? getPersonalCalendarCycleStart().toISOString()
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

  // Stable identity so memoized cards (e.g. HomeCalendarGameCard) don't
  // re-render whenever HomePage re-renders.
  const handleGameContextMenu = useCallback(
    (gameItem: GhostBoxGame, x: number, y: number) =>
      setHomeContextMenu({ game: gameItem, x, y }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function loadGameRange(
      games: HomeGameSeed[],
      start: number,
      end: number,
      updateFn: (results: GhostBoxGame[], offset: number) => void
    ) {
      if (cancelled || start >= end) return;

      const batch = games.slice(start, end);

      const results = await Promise.all(
        batch.map(async (game, index) => {
          const detailed = await loadGameStoreDetails(game.appId).catch(
            () => null
          );
          if (!detailed) return createSeedGame(game, start + index);
          const enriched =
            game.shortDescription && !detailed.shortDescription
              ? { ...detailed, shortDescription: game.shortDescription }
              : detailed;
          if (/^Steam \d+$/.test(detailed.title) && game.title) {
            return { ...enriched, title: game.title };
          }
          return enriched;
        })
      );

      if (!cancelled) updateFn(results, start);
    }

    void loadGameRange(
      topReviewedSteamGames,
      0,
      topReviewedSteamGames.length,
      (results, offset) => {
        setHomeTopReviewedGames((current) => {
          const next = [...current];
          results.forEach((game, index) => {
            next[offset + index] = game;
          });
          return next;
        });
      }
    );

    void loadGameRange(
      homeFeaturedSteamGames,
      0,
      6,
      (results, offset) => {
        setHomeFeaturedGames((current) => {
          const next = [...current];
          results.forEach((game, index) => {
            next[offset + index] = game;
          });
          return next;
        });
      }
    );

    const cancelIdleFeaturedLoad = runWhenIdle(() => {
      void loadGameRange(
        homeFeaturedSteamGames,
        6,
        homeFeaturedSteamGames.length,
        (results, offset) => {
          setHomeFeaturedGames((current) => {
            const next = [...current];
            results.forEach((game, index) => {
              next[offset + index] = game;
            });
            return next;
          });
        }
      );
    }, 1800);

    return () => {
      cancelled = true;
      cancelIdleFeaturedLoad();
    };
  }, []);

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
        const excludedGameIds = new Set(libraryGameAppIds);

        if (steamProfile?.steamId) {
          const wishlistItems = await loadSteamWishlist(steamProfile.steamId).catch(
            () => []
          );
          wishlistItems.forEach((item) => {
            const appId = item.appId.trim();
            if (appId) excludedGameIds.add(appId);
          });
        }

        if (cancelled) return;
        setStoredPersonalCalendar(currentStoredCalendar);

        const pool = await loadHomePersonalCalendarPool(excludedGameIds);
        if (cancelled) return;

        const gameById = new Map<string, GhostBoxGame>();
        pool.forEach((game) => {
          gameById.set(personalCalendarGameKey(game), game);
          gameById.set(game.id, game);
        });

        if (isStoredPersonalCalendarFresh(currentStoredCalendar, homePersonalCalendarGameCount)) {
          const storedGames = currentStoredCalendar.gameIds.flatMap((gameId) => {
            if (excludedGameIds.has(gameId)) return [];
            const game = gameById.get(gameId);
            return game ? [game] : [];
          });

          if (storedGames.length === homePersonalCalendarGameCount) {
            setPersonalCalendarCycleStart(currentStoredCalendar.cycleStart);
            setPersonalCalendarGames(storedGames);
            schedulePersonalCalendarRefresh(currentStoredCalendar);
            return;
          }
        }

        const cycleStart = getPersonalCalendarCycleStart();
        const selectedGames = pickPersonalCalendarGames(pool, {
          gameCount: homePersonalCalendarGameCount,
          gamesPerDay: homePersonalCalendarGamesPerDay,
          cycleStart,
          monthGameIds: currentStoredCalendar?.monthGameIds,
          excludedGameIds,
        });

        if (!selectedGames.length) {
          setPersonalCalendarGames([]);
          schedulePersonalCalendarRefresh(null);
          return;
        }

        const nextCalendar = createPersonalCalendar({
          selectedGames,
          storedCalendar: currentStoredCalendar,
          cycleStart,
          refreshMs: homePersonalCalendarRefreshMs,
          gamesPerDay: homePersonalCalendarGamesPerDay,
        });
        writeStoredPersonalCalendar(nextCalendar);
        setStoredPersonalCalendar(nextCalendar);
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
        const sourceOffset = getWishlistCycleIndex(cycleStart) % newAppIds.length;
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

        const excludedAppIds = new Set([
          ...newAppIds,
          ...libraryGameAppIds,
          ...(storedCycle?.history ?? []).flat(),
          ...retainedGames.map(homeGameAppId),
        ]);
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
          replacementGames = pickWishlistCycleGames(
            [...similarGames, ...popularResult.games],
            {
              gameCount: missingGameCount,
              sourceTraits,
              userTraits: normalizeSteamRecommendedTags(recommendedTags),
              excludedAppIds,
            }
          );
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
          refreshMs: homeWishlistCacheRefreshMs,
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

  const homeVisibleGameGroups = useMemo(() => {
    return homeRecommendedAppIdGroups.map((appIds) =>
      appIds
        .map((appId) =>
          homeTopReviewedGames.find((game) => homeGameAppId(game) === appId)
        )
        .filter((game): game is GhostBoxGame => Boolean(game))
    );
  }, [homeTopReviewedGames]);
  const featuredGames = homeFeaturedGames;
  const enrichedPersonalCalendarGames = useEnrichedGameCards(
    personalCalendarGames,
    homePersonalCalendarEnrichmentLimit
  );
  const exploreCategories = useMemo(() => {
    return getHomeExploreCategories([...homeTopReviewedGames, ...homeFeaturedGames]);
  }, [homeTopReviewedGames, homeFeaturedGames]);
  const homeContextMenuItems = useGameContextMenu({
    game: homeContextMenu?.game ?? null,
    onOpenGame,
  });

  return (
    <section className="home-page" aria-label={t("home.pageAria")}>
      <HomeRecommendedHero
        title={t("home.recommended")}
        gameGroups={homeVisibleGameGroups}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeCategorySection
        title={t("home.featuredGames")}
        games={featuredGames}
        className="home-category--featured"
        variant="tile"
        maxGames={6}
        showMetadata
        showSecondaryPills
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeExploreCategories
        title={t("home.exploreByCategory")}
        categories={exploreCategories}
        allGames={[...homeTopReviewedGames, ...homeFeaturedGames]}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
      />
      <HomePersonalCalendar
        title={t("home.personalCalendar")}
        subtitle=""
        games={enrichedPersonalCalendarGames}
        cycleStart={personalCalendarCycleStart}
        language={appearance.language}
        loading={isLoadingPersonalCalendar}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeWishlistRecommendations
        title={t("home.steamWishlist")}
        subtitle={t("home.steamWishlistSubtitle")}
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
