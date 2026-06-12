import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PirateGame } from "../data";
import type { CatalogueFilterKey, UserCollection } from "../types";
import { loadGameStoreDetails } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useSettings } from "../context/settings";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import { readStoredRecentPlayedGames } from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroCapsuleSources,
  layeredImageStyle,
} from "../utils/image";

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
  games: PirateGame[];
  score: number;
};

const topReviewedSteamGames: HomeGameSeed[] = [
  {
    appId: "2050650",
    title: "Resident Evil 4",
    shortDescription:
      "Survival horror reimaginado com combate moderno, tensão constante e uma missão de resgate em um vilarejo dominado por uma ameaça brutal.",
  },
  {
    appId: "367520",
    title: "Hollow Knight",
    shortDescription:
      "Explore Hallownest em uma aventura de ação atmosférica, cheia de chefes desafiadores, segredos e combates precisos.",
  },
  {
    appId: "1449690",
    title: "The Walking Dead: The Telltale Definitive Series",
    shortDescription:
      "Uma jornada narrativa completa no universo de The Walking Dead, com escolhas difíceis, personagens marcantes e consequências emocionais.",
  },
  {
    appId: "1817070",
    title: "Marvel's Spider-Man Remastered",
    shortDescription:
      "Viva a história de um Peter Parker experiente enquanto enfrenta grandes ameaças e cruza Nova York com acrobacias fluidas.",
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

function homeSteamCdnUrl(appId: string, asset: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`;
}

function homeGameAppId(game: PirateGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

function createHomeSeedFallbackGame(
  game: HomeGameSeed,
  index: number,
  subtitle = "Mais avaliados na Steam"
): PirateGame {
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
  game: PirateGame | undefined
): game is PirateGame {
  return Boolean(
    game &&
      Number.isFinite(Date.parse(game.lastTimePlayed ?? "")) &&
      !/^Steam App \d+$/i.test(game.title.trim())
  );
}

function HomeCategoryCard({
  game,
  imageVariant = "header",
  onOpenGame,
  onGameContextMenu,
}: {
  game: PirateGame;
  imageVariant?: HomeCategoryImageVariant;
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
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
  imageVariant = "header",
  maxGames = 3,
  showCardContentAlways = false,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: PirateGame[];
  imageVariant?: HomeCategoryImageVariant;
  maxGames?: number;
  showCardContentAlways?: boolean;
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);
  const isHeroCapsule = imageVariant === "heroCapsule";

  return (
    <section
      className={`home-category${showCardContentAlways ? " home-category--show-card-content" : ""}`}
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

function getHomeShortDescription(game: PirateGame, language: "pt" | "en") {
  const source =
    getPlainSteamText(game.shortDescription) ||
    game.subtitle ||
    game.genres.slice(0, 3).join(" • ");

  if (!source) {
    return language === "en"
      ? "Featured pick from the PirateBox catalogue."
      : "Destaque selecionado do catálogo PirateBox.";
  }

  return source.length > 150 ? `${source.slice(0, 147).trim()}...` : source;
}

function uniqueImageSources(sources: string[]) {
  return sources.filter((source, index) => source && sources.indexOf(source) === index);
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

function gameCategoryScore(game: PirateGame) {
  const reviewScore = game.steamPositiveRatio ?? game.rating ?? 0;
  const popularityScore = game.recommendations ?? game.steamReviewCount ?? 0;
  return reviewScore * 100 + Math.log10(popularityScore + 1);
}

function getHomeExploreCategories(games: PirateGame[]) {
  const categoryMap = new Map<
    string,
    {
      filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
      filterValue: string;
      games: PirateGame[];
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
        filterValue: category.value,
        games: [],
        score: 0,
      };
      if (entry.filterKey === "tags" && category.key === "genres") {
        entry.filterKey = category.key;
        entry.filterValue = category.value;
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

function getUniqueHomeGames(games: PirateGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = game.appId || game.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHomeExplorePreviewRows(
  categoryGames: PirateGame[],
  _allGames: PirateGame[]
) {
  const uniqueCategoryGames = getUniqueHomeGames(categoryGames);
  const previewGames = uniqueCategoryGames.slice(0, 18);
  const rows = [0, 1, 2].map((rowIndex) =>
    previewGames.filter((_, index) => index % 3 === rowIndex).slice(0, 6)
  );

  return rows.filter((row) => row.length > 0);
}

function HomeExploreCategoryImage({ game }: { game: PirateGame }) {
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
  allGames: PirateGame[];
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

function HomeRecommendedHero({
  title,
  games,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: PirateGame[];
  language: "pt" | "en";
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const game = games[activeIndex] ?? games[0];
  const fallbackHeroSource = game
    ? homeSteamCdnUrl(homeGameAppId(game), "library_hero.jpg")
    : "";
  const heroSources = game
    ? uniqueImageSources([
        fallbackHeroSource,
        game.heroUrl,
        game.hero,
        ...(game.heroFallbacks ?? []),
      ])
    : [];
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const canNavigate = games.length > 1;

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
    }, 160);
  }

  function moveRecommendedHero(direction: -1 | 1) {
    if (!canNavigate) return;
    selectRecommendedHero((activeIndex + direction + games.length) % games.length);
  }

  if (!game) return null;

  return (
    <section className="home-recommended" aria-label={title}>
      <div className="home-carousel__header">
        <h2 className="home-carousel__header-title">{title}</h2>
      </div>
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
          style={layeredImageStyle([heroSource, ...heroSources], "")}
          aria-hidden="true"
        />
        <span className="home-recommended-hero__shade" aria-hidden="true" />
        <span className="home-recommended-hero__content">
          <strong className="home-recommended-hero__title">{game.title}</strong>
          <span className="home-recommended-hero__description">
            {getHomeShortDescription(game, language)}
          </span>
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

function HomeRecentBanner({
  title,
  game,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  game: PirateGame | undefined;
  language: "pt" | "en";
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
}) {
  const fallbackHeroSource = game
    ? homeSteamCdnUrl(homeGameAppId(game), "library_hero.jpg")
    : "";
  const heroSources = fallbackHeroSource ? [fallbackHeroSource] : [];
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);

  if (!game) {
    return (
      <section className="home-recent-banner" aria-label={title}>
        <h3 className="home-recent-banner__heading">{title}</h3>
        <div className="home-recent-banner__card home-recent-banner__card--skeleton" aria-hidden="true">
          <span className="home-recent-banner__cover home-recent-banner__cover--skeleton" />
          <span className="home-recent-banner__gradient" aria-hidden="true" />
          <span className="home-recent-banner__content home-recent-banner__content--skeleton">
            <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--title" />
            <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--desc" />
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
}: {
  onOpenGame: (game: PirateGame) => void;
  favoriteGameIds: Set<string>;
  libraryGameAppIds: Set<string>;
  removableGameAppIds: Set<string>;
  playableGameAppIds: Set<string>;
  addingGameId: string | null;
  launchingGameId: string | null;
  userCollections: UserCollection[];
  onToggleFavorite: (game: PirateGame) => void;
  onAddGame: (game: PirateGame) => void;
  onPlayGame: (game: PirateGame) => void;
  onRemoveGame: (game: PirateGame) => void;
  onAddGameToCollection: (game: PirateGame, collectionId: string) => void;
  onRemoveGameFromCollection: (game: PirateGame, collectionId: string) => void;
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
}) {
  const { appearance, t } = useSettings();
  const [homeTopReviewedGames, setHomeTopReviewedGames] = useState<PirateGame[]>(
    () =>
      topReviewedSteamGames.map((game, index) =>
        createHomeSeedFallbackGame(game, index)
      )
  );
  const [homeFeaturedGames, setHomeFeaturedGames] = useState<PirateGame[]>(() =>
    homeFeaturedSteamGames.map((game, index) =>
      createHomeSeedFallbackGame(game, index, "")
    )
  );
  const [recentPlayedGames] = useState<PirateGame[]>(() =>
    readStoredRecentPlayedGames()
  );
  const [homeContextMenu, setHomeContextMenu] = useState<{
    game: PirateGame;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadGameRange(
      games: HomeGameSeed[],
      start: number,
      end: number,
      updateFn: (results: PirateGame[], offset: number) => void
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

  const homeVisibleGames = useMemo(() => {
    return homeTopReviewedGames.slice(0, homeCarouselGroupSize);
  }, [homeTopReviewedGames]);
  const featuredGames = homeFeaturedGames;
  const exploreCategories = useMemo(() => {
    return getHomeExploreCategories([...homeTopReviewedGames, ...homeFeaturedGames]);
  }, [homeTopReviewedGames, homeFeaturedGames]);
  const homeRecentPlayedGame = recentPlayedGames.find(hasCompletedPlaySession);

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
