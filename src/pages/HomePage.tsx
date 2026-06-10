import { Clock, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PirateGame } from "../data";
import { loadGameStoreDetails } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useSettings } from "../context/settings";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useHomeQuery } from "../queries/home";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import { readStoredRecentPlayedGames } from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroCapsuleSources,
  gamePortraitSources,
  layeredImageStyle,
} from "../utils/image";
import { formatCompactPlaytime } from "../utils/time";

type HomeGameSeed = {
  appId: string;
  title: string;
};

type HomeCategoryImageVariant = "header" | "heroCapsule";

const topReviewedSteamGames: HomeGameSeed[] = [
  { appId: "2050650", title: "Resident Evil 4" },
  { appId: "367520", title: "Hollow Knight" },
  { appId: "1449690", title: "The Walking Dead: The Telltale Definitive Series" },
  { appId: "1817070", title: "Marvel's Spider-Man Remastered" },
];

const homeFeaturedSteamGames: HomeGameSeed[] = [
  { appId: "1332010", title: "Stray" },
  { appId: "391220", title: "Rise of the Tomb Raider" },
  { appId: "1903340", title: "Clair Obscur: Expedition 33" },
  { appId: "1222140", title: "Detroit: Become Human" },
  { appId: "814380", title: "R.U.S.E." },
  { appId: "239140", title: "Dying Light" },
];

const homeCarouselGroupSize = 4;

function homeSteamCdnUrl(appId: string, asset: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`;
}

function homeGameAppId(game: PirateGame) {
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

function HomeCarouselCard({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: PirateGame;
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
}) {
  const coverSources = gamePortraitSources(game);
  const cachedSources = useCachedImageSources(coverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);

  const resolvedCoverSources = coverSource
    ? [coverSource]
    : cachedSources.slice(0, 1);

  return (
    <button
      type="button"
      className="home-carousel-card"
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-carousel-card__cover${
          loaded ? " home-carousel-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(resolvedCoverSources, "")}
        aria-hidden="true"
      />
      <span className="home-carousel-card__content">
        <strong>{game.title}</strong>
      </span>
    </button>
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

function HomeRecentBanner({
  title,
  game,
  subtitle,
  emptyText,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  game: PirateGame | undefined;
  subtitle: string;
  emptyText: string;
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
        <div className="home-recent-banner__empty">{emptyText}</div>
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
                    : subtitle}
                </span>
              </span>
            </small>
            {achievementTotal > 0 && (
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
                    {achievementUnlocked}/{achievementTotal}{" "}
                    {language === "en" ? "unlocked" : "alcançadas"} (
                    {achievementProgress}%)
                  </span>
                  <span
                    className="home-recent-banner__achievement-track"
                    aria-hidden="true"
                  >
                    <span style={{ width: `${achievementProgress}%` }} />
                  </span>
                </span>
              </small>
            )}
          </span>
        </span>
      </div>
    </section>
  );
}

export function HomePage({
  onOpenGame,
}: {
  onOpenGame: (game: PirateGame) => void;
}) {
  const { appearance, t } = useSettings();
  const homeQuery = useHomeQuery();
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
          if (/^Steam \d+$/.test(detailed.title) && game.title) {
            return { ...detailed, title: game.title };
          }
          return detailed;
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

  const remotePopularGames = homeQuery.data?.popular ?? [];
  const remoteRecentlyAddedGames = homeQuery.data?.recentlyAdded ?? [];
  const remoteHomeUnavailable = homeQuery.data?.source === "tauri-stub";
  const homeVisibleGames = useMemo(() => {
    const source = remotePopularGames.length
      ? remotePopularGames
      : homeTopReviewedGames;
    return source.slice(0, homeCarouselGroupSize);
  }, [homeTopReviewedGames, remotePopularGames]);
  const featuredGames = remoteRecentlyAddedGames.length
    ? remoteRecentlyAddedGames
    : homeFeaturedGames;
  const homeRecentPlayedGame = recentPlayedGames.find(hasCompletedPlaySession);

  const homeContextMenuItems = useCollectionContextMenu({
    game: homeContextMenu?.game ?? null,
    favoriteGameIds: new Set(),
    userCollections: [],
    onOpenGame,
  });

  return (
    <section className="home-page" aria-label={t("home.pageAria")}>
      <section
        className="home-recommended"
        aria-label={t("home.recommended")}
      >
        {homeQuery.isLoading && (
          <div className="home-recent-banner__empty" role="status">
            {appearance.language === "en"
              ? "Loading remote catalogue..."
              : "Carregando catálogo remoto..."}
          </div>
        )}
        {(homeQuery.isError || remoteHomeUnavailable) &&
          !remotePopularGames.length && (
            <div className="home-recent-banner__empty" role="status">
              {appearance.language === "en"
                ? "Remote Home unavailable. Showing fallback games."
                : "Home remoto indisponível. Mostrando jogos de fallback."}
            </div>
          )}
        <div className="home-carousel__header">
          <span className="home-carousel__header-icon" aria-hidden="true" />
          <h2 className="home-carousel__header-title">
            {t("home.recommended")}
          </h2>
        </div>
        <div className="home-carousel">
          <div className="home-carousel__track">
            {homeVisibleGames.map((game) => (
              <HomeCarouselCard
                key={game.appId}
                game={game}
                onOpenGame={onOpenGame}
                onGameContextMenu={(gameItem, x, y) =>
                  setHomeContextMenu({ game: gameItem, x, y })
                }
              />
            ))}
          </div>
        </div>
      </section>
      <div className="home-categories" aria-label={t("home.categoriesAria")}>
        <HomeCategorySection
          title={
            remoteRecentlyAddedGames.length
              ? appearance.language === "en"
                ? "Recently added"
                : "Recentemente adicionados"
              : t("home.featuredGames")
          }
          games={featuredGames}
          maxGames={6}
          onOpenGame={onOpenGame}
          onGameContextMenu={(gameItem, x, y) =>
            setHomeContextMenu({ game: gameItem, x, y })
          }
        />
      </div>
      <HomeRecentBanner
        title={t("home.recentSection")}
        game={homeRecentPlayedGame}
        subtitle={t("home.recentSubtitle")}
        emptyText={t("home.recentEmpty")}
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
