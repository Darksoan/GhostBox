import { ChevronLeft, ChevronRight, Clock, Trophy } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem, UserCollection } from "../types";
import { loadGames, loadGameStoreDetails, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useSettings } from "../context/settings";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import {
  readStoredPersonalCalendar,
  writeStoredPersonalCalendar,
  readStoredSteamWishlistRecommendations,
  writeStoredSteamWishlistRecommendations,
  type StoredPersonalCalendar,
} from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroSources,
  gameHeroCapsuleSources,
  gameMainCapsuleSources,
  gamePortraitSources,
  layeredImageStyle,
} from "../utils/image";
import { formatCompactPlaytime } from "../utils/time";

type HomeGameSeed = {
  appId: string;
  title: string;
  shortDescription?: string;
};

type HomeCategoryImageVariant = "header" | "heroCapsule";

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
    appId: "367520",
    title: "Hollow Knight",
    shortDescription:
      "Explore Hallownest in an atmospheric action adventure filled with challenging bosses, secrets, and precise combat.",
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
const homePersonalCalendarGameCount = 21;
const homePersonalCalendarPageSize = 500;
const homePersonalCalendarHistoryLimit = homePersonalCalendarGameCount * 8;
const homePersonalCalendarRefreshMs = 7 * 24 * 60 * 60 * 1000;
const homeWishlistDetailsBatchSize = 8;

function getHomeCalendarDates(): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    dates.push(`${day}/${month}`);
  }
  return dates;
}

function homeSteamCdnUrl(appId: string, asset: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`;
}

function homeGameAppId(game: GhostBoxGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

function formatLastSessionDate(
  value: string | null | undefined,
  language: "pt" | "en" = "pt"
) {
  if (!value)
    return language === "en" ? "Recently played" : "Jogado recentemente";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "Recently played" : "Jogado recentemente";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function createHomeSeedFallbackGame(
  game: HomeGameSeed,
  index: number,
  subtitle = "Mais avaliados na Steam"
): GhostBoxGame {
  const accent = ["#ff2d35", "#f59e0b", "#35d07f", "#60a5fa", "#c084fc"][
    index % 5
  ];
  const headerImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`;
  const heroImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_hero.jpg`;
  const headerCdn = homeSteamCdnUrl(game.appId, "header.jpg");
  const heroCdn = homeSteamCdnUrl(game.appId, "library_hero.jpg");
  const logoCdn = homeSteamCdnUrl(game.appId, "logo.png");

  return {
    appId: game.appId,
    id: `steam-${game.appId}`,
    title: game.title,
    subtitle,
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: "Steam",
    progress: 0,
    accent,
    cover: headerImage,
    hero: heroImage,
    coverUrl: headerImage,
    heroUrl: heroImage,
    coverFallbacks: [headerImage, headerCdn],
    heroFallbacks: [heroImage, heroCdn, headerImage, headerCdn],
    logo: logoCdn,
    tags: [],
    genres: [],
    screenshots: [],
    shortDescription: game.shortDescription,
    achievements: {
      unlocked: 0,
      total: 0,
      progress: 0,
    },
    achievementList: [],
  };
}

function hasCompletedPlaySession(
  game: GhostBoxGame | undefined
): game is GhostBoxGame {
  return Boolean(
    game &&
      Number.isFinite(Date.parse(game.lastTimePlayed ?? "")) &&
      !/^Steam App \d+$/i.test(game.title.trim())
  );
}

function getLastPlayedTime(game: GhostBoxGame) {
  const lastPlayedTime = Date.parse(game.lastTimePlayed ?? "");
  return Number.isFinite(lastPlayedTime) ? lastPlayedTime : 0;
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

function createWishlistFallbackGames(appIds: string[]) {
  return appIds.map((appId, index) =>
    createHomeSeedFallbackGame({ appId, title: `Steam App ${appId}` }, index)
  );
}

function isStoredHomePersonalCalendarFresh(
  calendar: StoredPersonalCalendar | null
): calendar is StoredPersonalCalendar {
  return Boolean(
    calendar &&
      calendar.gameIds.length === homePersonalCalendarGameCount &&
      Date.parse(calendar.expiresAt) > Date.now()
  );
}

function getUniqueCalendarPool(games: GhostBoxGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = homeGameKey(game);
    if (!key || seen.has(key) || /^Steam App \d+$/i.test(game.title.trim())) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function shuffleHomeCalendarGames(games: GhostBoxGame[]) {
  const shuffled = [...games];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}

function getHomeCalendarTraits(game: GhostBoxGame) {
  return new Set(
    [...game.genres, ...game.tags]
      .map((value) => normalizeHomeCategory(value).toLowerCase())
      .filter(Boolean)
  );
}

function getHomeCalendarOverlapScore(
  game: GhostBoxGame,
  selectedGames: GhostBoxGame[]
) {
  const traits = getHomeCalendarTraits(game);
  if (!traits.size) return 0;

  return selectedGames.slice(-6).reduce((score, selectedGame) => {
    const selectedTraits = getHomeCalendarTraits(selectedGame);
    let overlap = 0;
    traits.forEach((trait) => {
      if (selectedTraits.has(trait)) overlap += 1;
    });
    return score + overlap;
  }, 0);
}

function pickHomePersonalCalendarGames(
  games: GhostBoxGame[],
  recentGameIds: string[]
) {
  const recentIds = new Set(recentGameIds);
  const pool = getUniqueCalendarPool(games);
  const freshPool = pool.filter((game) => !recentIds.has(homeGameKey(game)));
  const availableGames = freshPool.length >= homePersonalCalendarGameCount
    ? freshPool
    : pool;
  const candidates = shuffleHomeCalendarGames(availableGames);
  const selectedGames: GhostBoxGame[] = [];

  while (
    selectedGames.length < homePersonalCalendarGameCount &&
    candidates.length > 0
  ) {
    const rankedCandidates = candidates
      .map((game, index) => ({
        game,
        index,
        score: getHomeCalendarOverlapScore(game, selectedGames),
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const nextCandidate = rankedCandidates[0];

    selectedGames.push(nextCandidate.game);
    candidates.splice(nextCandidate.index, 1);
  }

  return selectedGames;
}

function createHomePersonalCalendar(
  selectedGames: GhostBoxGame[],
  storedCalendar: StoredPersonalCalendar | null
): StoredPersonalCalendar {
  const now = Date.now();
  const selectedGameIds = selectedGames.map(homeGameKey);
  const recentGameIds = [
    ...selectedGameIds,
    ...(storedCalendar?.recentGameIds ?? []).filter(
      (gameId) => !selectedGameIds.includes(gameId)
    ),
  ].slice(0, homePersonalCalendarHistoryLimit);

  return {
    weekStart: new Date(now).toISOString(),
    expiresAt: new Date(now + homePersonalCalendarRefreshMs).toISOString(),
    gameIds: selectedGameIds,
    recentGameIds,
  };
}

async function loadHomePersonalCalendarPool() {
  const games: GhostBoxGame[] = [];
  let offset = 0;
  let expectedTotal: number | undefined;

  while (expectedTotal === undefined || offset < expectedTotal) {
    const result = await loadGames({
      query: "",
      limit: homePersonalCalendarPageSize,
      offset,
      sort: "popular",
    });
    games.push(...result.games);
    expectedTotal = result.matched || result.total || games.length;

    if (result.games.length < homePersonalCalendarPageSize) break;
    offset += homePersonalCalendarPageSize;
  }

  return getUniqueCalendarPool(games);
}

function HomeCategoryCard({
  game,
  imageVariant = "header",
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  imageVariant?: HomeCategoryImageVariant;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackCoverSources = useMemo(
    () =>
      imageVariant === "heroCapsule"
        ? gameHeroCapsuleSources(game)
        : gameHeaderOnlySources(game),
    [game, imageVariant]
  );
  const isHeroCapsule = imageVariant === "heroCapsule";
  const cachedSources = useCachedImageSources(fallbackCoverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);
  const layeredSources = coverSource
    ? [coverSource, ...fallbackCoverSources.filter((source) => source !== coverSource)]
    : fallbackCoverSources;

  return (
    <button
      type="button"
      className={`home-category-card ${
        isHeroCapsule ? "home-category-card--hero-capsule" : ""
      }`}
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
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
      <span className="home-category-card__content" aria-hidden="true">
        <strong>{game.title}</strong>
      </span>
    </button>
  );
}

function HomeCategorySection({
  title,
  games,
  className = "",
  imageVariant = "header",
  maxGames = 3,
  showCardContentAlways = false,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  className?: string;
  imageVariant?: HomeCategoryImageVariant;
  maxGames?: number;
  showCardContentAlways?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);
  const isHeroCapsule = imageVariant === "heroCapsule";

  return (
    <section
      className={`home-category${className ? ` ${className}` : ""}${
        showCardContentAlways ? " home-category--show-card-content" : ""
      }`}
      aria-label={title}
    >
      <h3 className="home-category__title">{title}</h3>
      <div
        className={`home-category__games ${
          isHeroCapsule ? "home-category__games--hero-capsule" : ""
        }`}
      >
        {Array.from({ length: maxGames }, (_, index) => {
          const game = visibleGames[index];
          return game ? (
            <HomeCategoryCard
              key={game.appId || game.id}
              game={game}
              imageVariant={imageVariant}
              onOpenGame={onOpenGame}
              onGameContextMenu={onGameContextMenu}
            />
          ) : (
            <span
              key={`placeholder-${index}`}
              className={`home-category-card home-category-card--empty ${
                isHeroCapsule ? "home-category-card--hero-capsule" : ""
              }`}
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

  return source.length > 150 ? `${source.slice(0, 147).trim()}...` : source;
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
  const previewGames = uniqueCategoryGames.slice(0, 18);
  const rows = [0, 1, 2].map((rowIndex) =>
    previewGames.filter((_, index) => index % 3 === rowIndex).slice(0, 6)
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
      style={layeredImageStyle([imageSource, ...sources], "")}
      aria-hidden="true"
    />
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
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const hasControls = categories.length > 5;
  const categoryOrderKey = categories.map((category) => category.label).join("|");

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollLeft = 0;
    setIsAtStart(true);
    setIsAtEnd(carousel.clientWidth >= carousel.scrollWidth - 2);
  }, [categoryOrderKey]);

  if (!categories.length) return null;

  const handleScroll = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >=
      carousel.scrollWidth - 2
    );
  };

  const scrollCategories = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className="home-explore" aria-label={title}>
      <div className="home-explore__header">
        <h3 className="home-explore__title">{title}</h3>
      </div>
      <div className="home-explore__rail">
        {hasControls && (
          <button
            type="button"
            className="home-explore__arrow home-explore__arrow--prev"
            aria-label={language === "en" ? "Previous categories" : "Categorias anteriores"}
            onClick={() => scrollCategories(-1)}
            style={{ visibility: isAtStart ? "hidden" : "visible" }}
          >
            <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
        <div className="home-explore__carousel" ref={carouselRef} onScroll={handleScroll}>
          <div className="home-explore__track">
            {categories.map((category) => {
              const previewRows = getHomeExplorePreviewRows(category.games, allGames);

              return (
                <button
                  key={category.label}
                  type="button"
                  className="home-explore-card"
                  onClick={() => onOpenCategory(category)}
                >
                  <span className="home-explore-card__images" aria-hidden="true">
                    {previewRows.map((rowGames, rowIndex) => (
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
            })}
          </div>
        </div>
        {hasControls && (
          <button
            type="button"
            className="home-explore__arrow home-explore__arrow--next"
            aria-label={language === "en" ? "Next categories" : "Próximas categorias"}
            onClick={() => scrollCategories(1)}
            style={{ visibility: isAtEnd ? "hidden" : "visible" }}
          >
            <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function HomeCalendarGameCard({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const coverSources = useCachedImageSources(gamePortraitSources(game));
  const { source: coverSource, loaded } = useLoadableImageCover(coverSources);
  const layeredSources = coverSource
    ? [coverSource, ...coverSources.filter((source) => source !== coverSource)]
    : coverSources;

  return (
    <button
      type="button"
      className="home-calendar-card"
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-calendar-card__cover${
          loaded ? " home-calendar-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
    </button>
  );
}

function HomePersonalCalendar({
  title,
  subtitle,
  games,
  language,
  loading,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle: string;
  games: GhostBoxGame[];
  language: "pt" | "en";
  loading: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const weekdays = getHomeCalendarDates();
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const gamesPerDay = 3;

  const updateCalendarScrollState = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2
    );
  };

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollLeft = 0;
    updateCalendarScrollState();
    const frame = requestAnimationFrame(updateCalendarScrollState);

    return () => cancelAnimationFrame(frame);
  }, [games.length]);

  if (!games.length && !loading) return null;

  const handleScroll = () => {
    updateCalendarScrollState();
  };

  const scrollCalendar = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className="home-calendar" aria-label={title}>
      <div className="home-calendar__header">
        <h3 className="home-calendar__title">{title}</h3>
        {subtitle && <span className="home-calendar__subtitle">{subtitle}</span>}
      </div>
      <div className="home-calendar__rail">
        <button
          type="button"
          className="home-calendar__arrow home-calendar__arrow--prev"
          aria-label={language === "en" ? "Previous calendar days" : "Dias anteriores"}
          onClick={() => scrollCalendar(-1)}
          style={{ visibility: isAtStart ? "hidden" : "visible" }}
        >
          <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <div className="home-calendar__carousel" ref={carouselRef} onScroll={handleScroll}>
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
                    {Array.from({ length: 3 }, (_, gameIndex) => {
                      const game = dayGames[gameIndex];
                      return game ? (
                        <HomeCalendarGameCard
                          key={homeGameKey(game)}
                          game={game}
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
        <button
          type="button"
          className="home-calendar__arrow home-calendar__arrow--next"
          aria-label={language === "en" ? "Next calendar days" : "Próximos dias"}
          onClick={() => scrollCalendar(1)}
          style={{ visibility: isAtEnd ? "hidden" : "visible" }}
        >
          <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function HomeRecommendedHero({
  title,
  games,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const game = games[activeIndex] ?? games[0];
  const heroSources = game ? gameHeroSources(game) : [];
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const canNavigate = games.length > 1;
  const publisher = game?.publishers?.filter(Boolean).slice(0, 2).join(", ") ?? "";
  const release = game?.release?.trim() ?? "";

  useEffect(() => {
    if (activeIndex <= games.length - 1) return;
    setActiveIndex(Math.max(games.length - 1, 0));
  }, [activeIndex, games.length]);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);
    };
  }, []);

  function selectRecommendedHero(nextIndex: number) {
    if (nextIndex === activeIndex || isTransitioning) return;

    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);

    setIsTransitioning(true);
    transitionTimeoutRef.current = setTimeout(() => {
      setActiveIndex(nextIndex);
      transitionFrameRef.current = requestAnimationFrame(() => {
        setIsTransitioning(false);
      });
    }, 100);
  }

  function moveRecommendedHero(direction: -1 | 1) {
    if (!canNavigate) return;
    selectRecommendedHero((activeIndex + direction + games.length) % games.length);
  }

  if (!game) return null;

  return (
    <section className="home-recommended" aria-label={title}>
      <div
        className={`home-recommended-hero${
          isTransitioning ? " home-recommended-hero--transitioning" : ""
        }`}
        role="button"
        tabIndex={0}
        onClick={() => onOpenGame(game)}
        onContextMenu={(event) => {
          if (!onGameContextMenu) return;
          event.preventDefault();
          onGameContextMenu(game, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveRecommendedHero(-1);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveRecommendedHero(1);
            return;
          }
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpenGame(game);
        }}
      >
        <span
          className={`home-recommended-hero__cover${
            loaded ? " home-recommended-hero__cover--loaded" : ""
          }`}
          style={layeredImageStyle(heroSource ? [heroSource] : [], "")}
          aria-hidden="true"
        />
        <span className="home-recommended-hero__shade" aria-hidden="true" />
        <span className="home-recommended-hero__content">
          <strong className="home-recommended-hero__title">{game.title}</strong>
          {(publisher || release) && (
            <span className="home-recommended-hero__meta">
              {publisher && <span>{publisher}</span>}
              {release && (
                <span className="home-recommended-hero__meta-release">
                  {publisher ? `(${release})` : release}
                </span>
              )}
            </span>
          )}
        </span>
        {canNavigate && (
          <>
            <button
              type="button"
              className="home-recommended-hero__arrow home-recommended-hero__arrow--prev"
              aria-label={language === "en" ? "Previous game" : "Jogo anterior"}
              onClick={(event) => {
                event.stopPropagation();
                moveRecommendedHero(-1);
              }}
            >
              <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="home-recommended-hero__arrow home-recommended-hero__arrow--next"
              aria-label={language === "en" ? "Next game" : "Próximo jogo"}
              onClick={(event) => {
                event.stopPropagation();
                moveRecommendedHero(1);
              }}
            >
              <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

    </section>
  );
}

function HomeWishlistCard({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const sources = useCachedImageSources(gameMainCapsuleSources(game));
  const { source: imageSource, loaded } = useLoadableImageCover(sources);

  return (
    <button
      type="button"
      className="home-wishlist-card"
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-wishlist-card__cover${loaded ? " home-wishlist-card__cover--loaded" : ""}`}
        style={layeredImageStyle(imageSource ? [imageSource, ...sources] : sources, "")}
        aria-hidden="true"
      />
    </button>
  );
}

function HomeWishlistRecommendations({
  title,
  games,
  loading,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  loading: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const visibleCards = loading && games.length === 0 ? 4 : games.length;

  const updateWishlistScrollState = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2
    );
  };

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollLeft = 0;
    updateWishlistScrollState();
    const frame = requestAnimationFrame(updateWishlistScrollState);

    return () => cancelAnimationFrame(frame);
  }, [visibleCards]);

  if (!games.length && !loading) return null;

  const hasControls = visibleCards > 4;

  const scrollWishlist = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className="home-wishlist" aria-label={title}>
      <div className="home-wishlist__header">
        <h3 className="home-wishlist__title">{title}</h3>
      </div>
      <div className="home-wishlist__rail">
        {hasControls && (
          <button
            type="button"
            className="home-wishlist__arrow home-wishlist__arrow--prev"
            aria-label="Jogos anteriores da wishlist"
            onClick={() => scrollWishlist(-1)}
            style={{ visibility: isAtStart ? "hidden" : "visible" }}
          >
            <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
        <div
          className="home-wishlist__carousel"
          ref={carouselRef}
          onScroll={updateWishlistScrollState}
        >
          <div className="home-wishlist__track">
            {loading && games.length === 0
              ? Array.from({ length: 4 }, (_, index) => (
                  <span
                    key={`wishlist-skeleton-${index}`}
                    className="home-wishlist-card home-wishlist-card--skeleton"
                    aria-hidden="true"
                  >
                    <span className="home-wishlist-card__cover home-wishlist-card__cover--skeleton" />
                  </span>
                ))
              : games.map((game) => (
                  <HomeWishlistCard
                    key={game.appId || game.id}
                    game={game}
                    onOpenGame={onOpenGame}
                    onGameContextMenu={onGameContextMenu}
                  />
                ))}
          </div>
        </div>
        {hasControls && (
          <button
            type="button"
            className="home-wishlist__arrow home-wishlist__arrow--next"
            aria-label="Próximos jogos da wishlist"
            onClick={() => scrollWishlist(1)}
            style={{ visibility: isAtEnd ? "hidden" : "visible" }}
          >
            <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function HomeRecentBanner({
  title,
  game,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  game: GhostBoxGame | undefined;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackHeroSource = game
    ? homeSteamCdnUrl(homeGameAppId(game), "library_hero.jpg")
    : "";
  const heroSources = fallbackHeroSource ? [fallbackHeroSource] : [];
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const achievementTotal = game?.achievements.total ?? 0;
  const achievementUnlocked = Math.min(
    game?.achievements.unlocked ?? 0,
    achievementTotal
  );
  const achievementProgress =
    achievementTotal > 0
      ? Math.round((achievementUnlocked / achievementTotal) * 100)
      : 0;

  if (!game) {
    return (
      <section className="home-recent-banner" aria-label={title}>
        <h3 className="home-recent-banner__heading">{title}</h3>
        <div className="home-recent-banner__card home-recent-banner__card--skeleton" aria-hidden="true">
          <span className="home-recent-banner__cover home-recent-banner__cover--skeleton" />
          <span className="home-recent-banner__content home-recent-banner__content--skeleton">
            <strong className="home-recent-banner__title home-recent-banner__title--skeleton">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--title" />
            </strong>
            <span className="home-recent-banner__description home-recent-banner__description--skeleton">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--desc" />
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--desc home-recent-banner__skeleton-line--desc-short" />
            </span>
            <span className="home-recent-banner__meta" aria-hidden="true">
              <small className="home-recent-banner__meta-item">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
              </small>
              <small className="home-recent-banner__meta-item home-recent-banner__meta-item--playtime">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
                <span className="home-recent-banner__meta-copy">
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
                </span>
              </small>
              <small className="home-recent-banner__meta-item home-recent-banner__meta-item--achievements">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
                <span className="home-recent-banner__meta-copy">
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
                </span>
              </small>
            </span>
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="home-recent-banner" aria-label={title}>
      <h3 className="home-recent-banner__heading">{title}</h3>
      <div
        className="home-recent-banner__card"
        role="button"
        tabIndex={0}
        onClick={() => onOpenGame(game)}
        onContextMenu={(event) => {
          if (!onGameContextMenu) return;
          event.preventDefault();
          onGameContextMenu(game, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpenGame(game);
        }}
      >
        <span
          className={`home-recent-banner__cover${
            loaded ? " home-recent-banner__cover--loaded" : ""
          }`}
          style={layeredImageStyle([heroSource, fallbackHeroSource], "")}
          aria-hidden="true"
        />
        <span className="home-recent-banner__gradient" aria-hidden="true" />
        <span className="home-recent-banner__content">
          <strong className="home-recent-banner__title">{game.title}</strong>
          <span className="home-recent-banner__description">
            {getHomeShortDescription(game, language)}
          </span>
          <span className="home-recent-banner__meta">
            <small className="home-recent-banner__meta-item">
              <span className="home-recent-banner__meta-label">
                {language === "en" ? "Last session" : "Última sessão"}
              </span>
              <span className="home-recent-banner__meta-value">
                {formatLastSessionDate(game.lastTimePlayed, language)}
              </span>
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--playtime">
              <Clock
                className="home-recent-banner__meta-icon"
                size={26}
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__meta-label">
                  {language === "en" ? "Playtime" : "Tempo de jogo"}
                </span>
                <span className="home-recent-banner__meta-value">
                  {game.playTimeInMilliseconds
                    ? formatCompactPlaytime(game.playTimeInMilliseconds)
                    : language === "en"
                      ? "Recently played"
                      : "Jogado recentemente"}
                </span>
              </span>
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--achievements">
              <Trophy
                className="home-recent-banner__meta-icon"
                size={28}
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__meta-label">
                  {language === "en" ? "Achievements" : "Conquistas"}
                </span>
                <span className="home-recent-banner__meta-value home-recent-banner__meta-value--achievements">
                  {achievementTotal > 0
                    ? `${achievementUnlocked}/${achievementTotal} ${
                        language === "en" ? "unlocked" : "alcançadas"
                      } (${achievementProgress}%)`
                    : language === "en"
                      ? "No achievements"
                      : "Sem conquistas"}
                </span>
                <span
                  className="home-recent-banner__achievement-track"
                  aria-hidden="true"
                >
                  <span style={{ width: `${achievementProgress}%` }} />
                </span>
              </span>
            </small>
          </span>
        </span>
      </div>
    </section>
  );
}

export function HomePage({
  onOpenGame,
  favoriteGameIds,
  libraryGameAppIds,
  removableGameAppIds,
  playableGameAppIds,
  addingGameId,
  launchingGameId,
  userCollections,
  onToggleFavorite,
  onAddGame,
  onPlayGame,
  onRemoveGame,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  onOpenCatalogueCategory,
  profileHistoryGames,
  steamProfile,
}: {
  onOpenGame: (game: GhostBoxGame) => void;
  favoriteGameIds: Set<string>;
  libraryGameAppIds: Set<string>;
  removableGameAppIds: Set<string>;
  playableGameAppIds: Set<string>;
  addingGameId: string | null;
  launchingGameId: string | null;
  userCollections: UserCollection[];
  onToggleFavorite: (game: GhostBoxGame) => void;
  onAddGame: (game: GhostBoxGame) => void;
  onPlayGame: (game: GhostBoxGame) => void;
  onRemoveGame: (game: GhostBoxGame) => void;
  onAddGameToCollection: (game: GhostBoxGame, collectionId: string) => void;
  onRemoveGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
  profileHistoryGames: GhostBoxGame[];
  steamProfile: SteamProfile | null;
}) {
  const { appearance, t } = useSettings();
  const [homeTopReviewedGames, setHomeTopReviewedGames] = useState<GhostBoxGame[]>(
    () =>
      topReviewedSteamGames.map((game, index) =>
        createHomeSeedFallbackGame(game, index)
      )
  );
  const [homeFeaturedGames, setHomeFeaturedGames] = useState<GhostBoxGame[]>(() =>
    homeFeaturedSteamGames.map((game, index) =>
      createHomeSeedFallbackGame(game, index, "")
    )
  );
  const [storedPersonalCalendar] = useState<StoredPersonalCalendar | null>(() =>
    readStoredPersonalCalendar()
  );
  const [personalCalendarGames, setPersonalCalendarGames] = useState<GhostBoxGame[]>([]);
  const [isLoadingPersonalCalendar, setIsLoadingPersonalCalendar] = useState(false);
  const [wishlistRecommendationGames, setWishlistRecommendationGames] = useState<GhostBoxGame[]>([]);
  const [isLoadingWishlistRecommendations, setIsLoadingWishlistRecommendations] = useState(false);
  const [homeContextMenu, setHomeContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

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
          if (!detailed) return createHomeSeedFallbackGame(game, start + index);
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
      homeCarouselGroupSize,
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

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPersonalCalendar() {
      setIsLoadingPersonalCalendar(true);

      try {
        const pool = await loadHomePersonalCalendarPool();
        if (cancelled) return;

        const gameById = new Map<string, GhostBoxGame>();
        pool.forEach((game) => {
          gameById.set(homeGameKey(game), game);
          gameById.set(game.id, game);
        });

        if (isStoredHomePersonalCalendarFresh(storedPersonalCalendar)) {
          const storedGames = storedPersonalCalendar.gameIds.flatMap((gameId) => {
            const game = gameById.get(gameId);
            return game ? [game] : [];
          });

          if (storedGames.length === homePersonalCalendarGameCount) {
            setPersonalCalendarGames(storedGames);
            return;
          }
        }

        const selectedGames = pickHomePersonalCalendarGames(
          pool,
          storedPersonalCalendar?.recentGameIds ?? []
        );

        if (!selectedGames.length) {
          setPersonalCalendarGames([]);
          return;
        }

        const nextCalendar = createHomePersonalCalendar(
          selectedGames,
          storedPersonalCalendar
        );
        writeStoredPersonalCalendar(nextCalendar);
        setPersonalCalendarGames(selectedGames);
      } finally {
        if (!cancelled) setIsLoadingPersonalCalendar(false);
      }
    }

    void loadPersonalCalendar();

    return () => {
      cancelled = true;
    };
  }, [storedPersonalCalendar]);

  useEffect(() => {
    let cancelled = false;

    async function loadWishlistRecommendations() {
      if (!steamProfile?.steamId) {
        setWishlistRecommendationGames([]);
        return;
      }
      setIsLoadingWishlistRecommendations(true);

      try {
        const storedWishlistRecommendations = readStoredSteamWishlistRecommendations();
        if (storedWishlistRecommendations?.steamId === steamProfile.steamId) {
          const cachedAppIds = storedWishlistRecommendations.gameIds.filter(
            (appId) => appId && !libraryGameAppIds.has(appId)
          );
          if (cachedAppIds.length > 0) {
            setWishlistRecommendationGames(createWishlistFallbackGames(cachedAppIds));
          }
        }

        const wishlistItems = await loadSteamWishlist(steamProfile.steamId);
        if (cancelled) return;

        const newAppIds = getUniqueWishlistAppIds(wishlistItems, libraryGameAppIds);

        if (newAppIds.length === 0) {
          setWishlistRecommendationGames([]);
          return;
        }

        let nextGames = createWishlistFallbackGames(newAppIds);
        setWishlistRecommendationGames(nextGames);

        writeStoredSteamWishlistRecommendations({
          steamId: steamProfile.steamId,
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          gameIds: newAppIds,
        });

        for (
          let offset = 0;
          offset < newAppIds.length;
          offset += homeWishlistDetailsBatchSize
        ) {
          const batchAppIds = newAppIds.slice(
            offset,
            offset + homeWishlistDetailsBatchSize
          );
          const detailedGames = await Promise.all(
            batchAppIds.map(async (appId, index) => {
              const game = await loadGameStoreDetails(appId).catch(() => null);
              return game ?? nextGames[offset + index];
            })
          );

          if (cancelled) return;
          nextGames = [...nextGames];
          detailedGames.forEach((game, index) => {
            nextGames[offset + index] = game;
          });
          setWishlistRecommendationGames(nextGames);
        }
      } finally {
        if (!cancelled) setIsLoadingWishlistRecommendations(false);
      }
    }

    void loadWishlistRecommendations();

    return () => {
      cancelled = true;
    };
  }, [steamProfile?.steamId, libraryGameAppIds]);

  const homeVisibleGames = useMemo(() => {
    return homeTopReviewedGames.slice(0, homeCarouselGroupSize);
  }, [homeTopReviewedGames]);
  const featuredGames = homeFeaturedGames;
  const enrichedPersonalCalendarGames = useEnrichedGameCards(
    personalCalendarGames,
    homePersonalCalendarGameCount
  );
  const exploreCategories = useMemo(() => {
    return getHomeExploreCategories([...homeTopReviewedGames, ...homeFeaturedGames]);
  }, [homeTopReviewedGames, homeFeaturedGames]);
  const homeRecentPlayedGame = useMemo(() => {
    return [...profileHistoryGames]
      .filter(hasCompletedPlaySession)
      .sort((left, right) => getLastPlayedTime(right) - getLastPlayedTime(left))[0];
  }, [profileHistoryGames]);

  const homeContextMenuItems = useCollectionContextMenu({
    game: homeContextMenu?.game ?? null,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onOpenGame,
    onToggleFavorite,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  });

  return (
    <section className="home-page" aria-label={t("home.pageAria")}>
      <HomeRecommendedHero
        title={t("home.recommended")}
        games={homeVisibleGames}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={(gameItem, x, y) =>
          setHomeContextMenu({ game: gameItem, x, y })
        }
      />
      <div className="home-categories" aria-label={t("home.categoriesAria")}>
        <HomeCategorySection
          title={t("home.featuredGames")}
          games={featuredGames}
          className="home-category--featured"
          maxGames={6}
          onOpenGame={onOpenGame}
          onGameContextMenu={(gameItem, x, y) =>
            setHomeContextMenu({ game: gameItem, x, y })
          }
        />
      </div>
      <HomeExploreCategories
        title={appearance.language === "en" ? "Explore by category" : "Explore por categoria"}
        categories={exploreCategories}
        allGames={[...homeTopReviewedGames, ...homeFeaturedGames]}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
      />
      <HomePersonalCalendar
        title={appearance.language === "en" ? "Personal calendar" : "Calendário pessoal"}
        subtitle=""
        games={enrichedPersonalCalendarGames}
        language={appearance.language}
        loading={isLoadingPersonalCalendar}
        onOpenGame={onOpenGame}
        onGameContextMenu={(gameItem, x, y) =>
          setHomeContextMenu({ game: gameItem, x, y })
        }
      />
      <HomeWishlistRecommendations
        title={appearance.language === "en" ? "From your Steam wishlist" : "Da sua wishlist da Steam"}
        games={wishlistRecommendationGames}
        loading={isLoadingWishlistRecommendations}
        onOpenGame={onOpenGame}
        onGameContextMenu={(gameItem, x, y) =>
          setHomeContextMenu({ game: gameItem, x, y })
        }
      />
      <HomeRecentBanner
        title={t("home.recentSection")}
        game={homeRecentPlayedGame}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={(gameItem, x, y) =>
          setHomeContextMenu({ game: gameItem, x, y })
        }
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
