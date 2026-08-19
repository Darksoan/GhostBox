import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GhostBoxGame } from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem } from "../types";
import { loadGames, loadGameReviews, loadGameStoreDetails, loadSteamRecommendedTagsForUser, loadSteamSimilarAppIds, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import {
  HomeCategoryCardSkeleton,
  HomeWishlistCardSkeleton,
  HomeWishlistReviewSkeleton,
} from "../components/ui/LoadingStates";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Shelf } from "../components/ui/Shelf";
import { useSettings } from "../context/settings";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useHomeShelves, type HomeShelf } from "../hooks/useHomeShelves";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import {
  readStoredSteamWishlistCycle,
  writeStoredSteamWishlistCycle,
  readStoredSteamWishlistReview,
  writeStoredSteamWishlistReview,
} from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroSources,
  gameHeroCapsuleSources,
  layeredImageStyle,
  withoutHeaderImageSources,
} from "../utils/image";
import { loadedImageSources, runWhenIdle } from "../utils/imageCache";
import { createSeedGame } from "../utils/gameSeed";
import {
  gameCategoryScore,
  getGameTraits,
  normalizeGameTrait,
  reviewSummaryBand,
} from "../utils/gameTraits";
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
// aparecerem: com pool menor ou igual a isto não há o que rolar.
const homeRecommendedCardCount = 3;
// Teto do texto da descrição curta. O card fecha em duas linhas via
// `-webkit-line-clamp`; o corte aqui garante reticências mesmo quando o
// navegador não aplica as do clamp (texto de uma linha só, muito longo).
const homeShortDescriptionLimit = 150;
const homeRecommendedGroupPreloadTimeoutMs = 1800;
// Faixa larga com dots logo abaixo da vitrine.
const homeSpotlightSlideCount = 6;
const homeSpotlightIntervalMs = 7000;
const homeExploreCategoryLimit = 15;
// 2 destaques + coluna de 2 menores na grade de "Coleções e destaques".
const homeCollectionsCategoryCount = 4;
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
  const layeredSources = variant === "portrait"
    ? loaded && coverSource
      ? [coverSource]
      : []
    : coverSource
      ? [coverSource, ...fallbackCoverSources.filter((source) => source !== coverSource)]
      : fallbackCoverSources;
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

function HomeCategorySection({
  title,
  subtitle,
  games,
  loading = false,
  className = "",
  variant = "tile",
  maxGames = 3,
  showMetadata = false,
  showTitle = false,
  showSecondaryPills = false,
  language = "pt",
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle?: string;
  games: GhostBoxGame[];
  loading?: boolean;
  className?: string;
  variant?: HomeCategoryCardVariant;
  maxGames?: number;
  showMetadata?: boolean;
  showTitle?: boolean;
  showSecondaryPills?: boolean;
  language?: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);

  return (
    <section
      className={`home-category${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="home-category__games">
        {Array.from({ length: maxGames }, (_, index) => {
          const game = visibleGames[index];
          if (game) {
            return (
              <HomeCategoryCard
                key={game.appId || game.id}
                game={game}
                variant={variant}
                showMetadata={showMetadata}
                showTitle={showTitle}
                showSecondaryPills={showSecondaryPills}
                language={language}
                onOpenGame={onOpenGame}
                onGameContextMenu={onGameContextMenu}
              />
            );
          }

          return loading ? (
            <HomeCategoryCardSkeleton
              key={`skeleton-${index}`}
              variant={variant}
              showTitle={showTitle}
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

/**
 * Grade assimétrica "Coleções e destaques": 2 categorias em destaque + uma
 * coluna estreita com 2 menores. Reaproveita `HomeExploreCard`, só troca o
 * container de rail horizontal (`Shelf`) por uma grade estática — a lista de
 * categorias já vem pronta de `getHomeExploreCategories`.
 */
function HomeCollectionsSection({
  title,
  subtitle,
  categories,
  allGames,
  language,
  onOpenCategory,
}: {
  title: string;
  subtitle?: string;
  categories: HomeExploreCategory[];
  allGames: GhostBoxGame[];
  language: "pt" | "en";
  onOpenCategory: (category: HomeExploreCategory) => void;
}) {
  // `HomeExploreCard` lazy-carrega a própria imagem via IntersectionObserver;
  // fora de um rail que rola por conta própria, `root: null` (viewport) já
  // resolve o lazy-load certo.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const featuredCategories = categories.slice(0, 2);
  const asideCategories = categories.slice(2, 4);

  if (!featuredCategories.length) return null;

  return (
    <section className="home-collections" aria-label={title}>
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="home-collections__grid">
        {featuredCategories.map((category) => (
          <HomeExploreCard
            key={category.label}
            category={category}
            allGames={allGames}
            language={language}
            rootRef={rootRef}
            onOpenCategory={onOpenCategory}
          />
        ))}
        {asideCategories.length ? (
          <div className="home-collections__aside-cards">
            {asideCategories.map((category) => (
              <HomeExploreCard
                key={category.label}
                category={category}
                allGames={allGames}
                language={language}
                rootRef={rootRef}
                onOpenCategory={onOpenCategory}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
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

/**
 * Rail genérico de descoberta: mesma estrutura visual do rail de recomendados
 * (por isso o `blockName`), com card de capa + nome + pills. Enquanto a fonte
 * não responde, mantém a altura da seção com skeletons em vez de sumir e
 * empurrar tudo que está abaixo quando os dados chegam.
 */
function HomeGameShelf({
  title,
  subtitle,
  shelf,
  language,
  upcomingLabel = "",
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle?: string;
  shelf: HomeShelf;
  language: "pt" | "en";
  /** Rótulo da pill dos jogos ainda não lançados. */
  upcomingLabel?: string;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  if (!shelf.games.length) {
    if (!shelf.loading) return null;

    return (
      <section className="home-recommended" aria-label={title}>
        <SectionHeader title={title} subtitle={subtitle} />
        <div className="home-recommended__rail">
          <div className="home-recommended__carousel">
            <div className="home-recommended__track">
              {Array.from({ length: homeRecommendedCardCount }, (_, index) => (
                <HomeCategoryCardSkeleton key={`shelf-skeleton-${index}`} showTitle />
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
      subtitle={subtitle}
      items={shelf.games}
      getKey={homeGameKey}
      minItemsForControls={homeRecommendedCardCount}
      prevLabel={language === "en" ? "Previous game" : "Jogo anterior"}
      nextLabel={language === "en" ? "Next game" : "Próximo jogo"}
      renderItem={(game) => (
        <HomeCategoryCard
          game={game}
          showMetadata
          showTitle
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
 * Vitrine no topo da Home: arte grande do jogo ativo + grade de capturas +
 * painel com avaliações, no lugar do antigo rail de cards de recomendados.
 * As setas trocam o jogo ativo entre `shelf.games`; a grade de capturas troca
 * qual imagem aparece grande à esquerda.
 */
function HomeShowcase({
  title,
  subtitle,
  shelf,
  trendingRankByAppId,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle?: string;
  shelf: HomeShelf;
  trendingRankByAppId: Map<string, number>;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const { t } = useSettings();
  const games = shelf.games;
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeThumbIndex, setActiveThumbIndex] = useState(0);

  useEffect(() => {
    const cancelPreload = runWhenIdle(() => {
      void preloadHomeRecommendedGroup(games);
    }, 450);

    return cancelPreload;
  }, [games]);

  const activeGame = games.length ? games[activeIndex % games.length] : undefined;
  const activeGameKey = activeGame ? homeGameKey(activeGame) : "";

  useEffect(() => {
    setActiveThumbIndex(0);
  }, [activeGameKey]);

  // Primeiro slot é sempre a arte principal do jogo; os demais são capturas de
  // tela reais, então clicar num slot troca a imagem grande à esquerda.
  const thumbs = useMemo(() => {
    if (!activeGame) return [];
    const screenshots = withoutHeaderImageSources(activeGame.screenshots ?? []).slice(0, 5);
    return [gameHeroCapsuleSources(activeGame), ...screenshots.map((source) => [source])];
  }, [activeGame]);

  if (!games.length) {
    if (!shelf.loading) return null;

    return (
      <section className="home-showcase" aria-label={title}>
        <SectionHeader title={title} subtitle={subtitle} />
        <div className="home-showcase__frame home-showcase__frame--skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (!activeGame) return null;

  const goTo = (direction: -1 | 1) => {
    setActiveIndex((current) => (current + direction + games.length) % games.length);
  };

  const mainArtSources = thumbs[activeThumbIndex] ?? gameHeroCapsuleSources(activeGame);

  return (
    <section className="home-showcase" aria-label={title || t("home.showcaseAria")}>
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="home-showcase__frame">
        {games.length > 1 ? (
          <button
            type="button"
            className="home-showcase__arrow home-showcase__arrow--prev"
            aria-label={t("home.showcasePreviousGame")}
            onClick={() => goTo(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        <HomeShowcaseArt
          game={activeGame}
          sources={mainArtSources}
          onOpenGame={onOpenGame}
          onGameContextMenu={onGameContextMenu}
        />
        <div className="home-showcase__thumbs" role="group" aria-label={t("home.showcaseAria")}>
          {Array.from({ length: 6 }, (_, index) => {
            const thumbSources = thumbs[index];
            if (!thumbSources) {
              return (
                <span
                  key={`thumb-empty-${index}`}
                  className="home-showcase__thumb home-showcase__thumb--empty"
                  aria-hidden="true"
                />
              );
            }

            return (
              <HomeShowcaseThumb
                key={`${activeGameKey}-thumb-${index}`}
                sources={thumbSources}
                active={index === activeThumbIndex}
                label={t("home.showcaseScreenshotLabel", { index: index + 1 })}
                onSelect={() => setActiveThumbIndex(index)}
              />
            );
          })}
        </div>
        <HomeShowcasePanel
          game={activeGame}
          rank={trendingRankByAppId.get(homeGameAppId(activeGame))}
          language={language}
          t={t}
        />
        {games.length > 1 ? (
          <button
            type="button"
            className="home-showcase__arrow home-showcase__arrow--next"
            aria-label={t("home.showcaseNextGame")}
            onClick={() => goTo(1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function HomeShowcaseArt({
  game,
  sources,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  sources: string[];
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const cachedSources = useCachedImageSources(sources);
  const { source, loaded } = useLoadableImageCover(cachedSources);

  return (
    <button
      type="button"
      className={`home-showcase__art${loaded ? " home-showcase__art--loaded" : ""}`}
      aria-label={game.title}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
      style={layeredImageStyle(source ? [source] : sources, "", "100% 100%", "100% 100%")}
    />
  );
}

function HomeShowcaseThumb({
  sources,
  active,
  label,
  onSelect,
}: {
  sources: string[];
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  const cachedSources = useCachedImageSources(sources);
  const { source } = useLoadableImageCover(cachedSources);

  return (
    <button
      type="button"
      className={`home-showcase__thumb${active ? " home-showcase__thumb--active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      onClick={onSelect}
      style={layeredImageStyle(source ? [source] : sources, "", "100% 100%", "100% 100%")}
    />
  );
}

function HomeShowcasePanel({
  game,
  rank,
  language,
  t,
}: {
  game: GhostBoxGame;
  rank?: number;
  language: "pt" | "en";
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const band = reviewSummaryBand(game.steamPositiveRatio, game.steamReviewCount);
  const reviewCountFormatter = useMemo(
    () => new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR"),
    [language]
  );
  const traits = useMemo(() => getGameTraits(game).slice(0, 4), [game]);

  return (
    <div className="home-showcase__panel">
      <span className="home-showcase__title">
        {getDisplayGameTitle(game, language === "en" ? "Untitled game" : "Jogo sem título")}
      </span>
      {band ? (
        <div className="home-showcase__reviews">
          <span className={`home-showcase__review-label home-showcase__review-label--${band}`}>
            {t(`home.review.${band}`)}
          </span>
          <span className="home-showcase__review-count">
            {t("home.reviewCount", {
              count: reviewCountFormatter.format(game.steamReviewCount ?? 0),
            })}
          </span>
        </div>
      ) : null}
      {rank ? <p className="home-showcase__rank">{t("home.popularRank", { rank })}</p> : null}
      {traits.length ? (
        <div className="home-showcase__genres">
          {traits.map((trait) => (
            <span className="home-showcase__genre" key={trait}>
              {getHomeCategoryLabel(trait, language)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Faixa larga com paginação por dots, entre a vitrine e as demais seções.
 * Alimentada por `shelves.topSellers`, que já sai deduplicado contra a
 * vitrine e os outros rails pelo ledger compartilhado de `useHomeShelves`.
 */
function HomeSpotlightBanner({
  games,
  loading,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  games: GhostBoxGame[];
  loading: boolean;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const { t } = useSettings();
  const slides = useMemo(() => games.slice(0, homeSpotlightSlideCount), [games]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, homeSpotlightIntervalMs);

    return () => window.clearInterval(interval);
  }, [slides.length]);

  if (!slides.length) {
    if (!loading) return null;
    return <div className="home-spotlight home-spotlight--skeleton" aria-hidden="true" />;
  }

  const activeGame = slides[activeIndex % slides.length];

  return (
    <section className="home-spotlight" aria-label={t("home.spotlightAria")}>
      <HomeSpotlightSlide
        game={activeGame}
        language={language}
        onOpenGame={onOpenGame}
        onGameContextMenu={onGameContextMenu}
      />
      {slides.length > 1 ? (
        <div className="home-spotlight__dots">
          {slides.map((game, index) => (
            <button
              key={homeGameKey(game)}
              type="button"
              className={`home-spotlight__dot${
                index === activeIndex ? " home-spotlight__dot--active" : ""
              }`}
              aria-pressed={index === activeIndex}
              aria-label={t("home.spotlightSlideLabel", { index: index + 1 })}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function HomeSpotlightSlide({
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
  const fallbackSources = useMemo(() => gameHeroSources(game), [game]);
  const cachedSources = useCachedImageSources(fallbackSources);
  const { source, loaded } = useLoadableImageCover(cachedSources);
  const displayTitle = getDisplayGameTitle(
    game,
    language === "en" ? "Untitled game" : "Jogo sem título"
  );

  return (
    <button
      type="button"
      className={`home-spotlight__slide${loaded ? " home-spotlight__slide--loaded" : ""}`}
      aria-label={displayTitle}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className="home-spotlight__art"
        style={layeredImageStyle(source ? [source] : fallbackSources, "", "cover", "cover")}
        aria-hidden="true"
      />
      <span className="home-spotlight__scrim" aria-hidden="true" />
      <span className="home-spotlight__label">{displayTitle}</span>
    </button>
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

function useWidescreen() {
  const [isWidescreen, setIsWidescreen] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia?.("(min-width: 1400px)")?.matches ?? false
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1400px)");
    const update = () => setIsWidescreen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isWidescreen;
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
  const isWidescreen = useWidescreen();
  const isMaximized = useWindowMaximized();
  const homeFeaturedMaxGames = isWidescreen ? 8 : 6;
  const [wishlistRecommendations, setWishlistRecommendations] = useState<GhostBoxGame[]>([]);
  const [isLoadingWishlistRecommendations, setIsLoadingWishlistRecommendations] = useState(false);
  const [homeContextMenu, setHomeContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

  const { shelves, explorePool, tasteProfile } = useHomeShelves({
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
              userTraits: steamRecommendedTagNames(recommendedTags),
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

  const exploreCategories = useMemo(
    () => getHomeExploreCategories(explorePool),
    [explorePool]
  );
  // As primeiras categorias viram os destaques de "Coleções"; o rail de
  // "Explorar por categoria" mostra o restante, sem repetir o que já apareceu
  // ali em cima.
  const collectionCategories = useMemo(
    () => exploreCategories.slice(0, homeCollectionsCategoryCount),
    [exploreCategories]
  );
  const exploreRailCategories = useMemo(
    () => exploreCategories.slice(homeCollectionsCategoryCount),
    [exploreCategories]
  );
  const homeContextMenuItems = useGameContextMenu({
    game: homeContextMenu?.game ?? null,
    onOpenGame,
  });
  const becauseYouPlayedTitle = tasteProfile.seedGame
    ? t("home.becauseYouPlayed", { title: tasteProfile.seedGame.title })
    : "";
  // Sinal de popularidade do painel da vitrine: posição (1-based) do jogo
  // ativo no rail de "Em alta", quando ele estiver lá.
  const trendingRankByAppId = useMemo(() => {
    const ranks = new Map<string, number>();
    shelves.trending.games.forEach((game, index) => {
      ranks.set(homeGameAppId(game), index + 1);
    });
    return ranks;
  }, [shelves.trending.games]);

  return (
    <section className={`home-page${isMaximized ? " home-page--maximized" : ""}`} aria-label={t("home.pageAria")}>
      <HomeShowcase
        title={t("home.recommended")}
        subtitle={t("home.recommendedSubtitle")}
        shelf={shelves.recommended}
        trendingRankByAppId={trendingRankByAppId}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeSpotlightBanner
        games={shelves.topSellers.games}
        loading={shelves.topSellers.loading}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      {collectionCategories.length || becauseYouPlayedTitle ? (
        <div className="home-collections-row">
          {collectionCategories.length ? (
            <HomeCollectionsSection
              title={t("home.collections")}
              subtitle={t("home.collectionsSubtitle")}
              categories={collectionCategories}
              allGames={explorePool}
              language={appearance.language}
              onOpenCategory={(category) =>
                onOpenCatalogueCategory(category.filterKey, category.filterValue)
              }
            />
          ) : null}
          {becauseYouPlayedTitle ? (
            <HomeGameShelf
              title={becauseYouPlayedTitle}
              shelf={shelves.becauseYouPlayed}
              language={appearance.language}
              onOpenGame={onOpenGame}
              onGameContextMenu={handleGameContextMenu}
            />
          ) : null}
        </div>
      ) : null}
      <HomeGameShelf
        title={t("home.trending")}
        subtitle={t("home.trendingSubtitle")}
        shelf={shelves.trending}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeGameShelf
        title={t("home.newReleases")}
        subtitle={t("home.newReleasesSubtitle")}
        shelf={shelves.newReleases}
        language={appearance.language}
        upcomingLabel={t("home.comingSoon")}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeGameShelf
        title={t("home.topSellers")}
        subtitle={t("home.topSellersSubtitle")}
        shelf={shelves.topSellers}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeCategorySection
        title={t("home.featuredGames")}
        games={shelves.topRated.games}
        loading={shelves.topRated.loading}
        className="home-category--featured"
        variant="tile"
        maxGames={homeFeaturedMaxGames}
        showMetadata
        showTitle
        showSecondaryPills
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeExploreCategories
        title={t("home.exploreByCategory")}
        categories={exploreRailCategories}
        allGames={explorePool}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
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
