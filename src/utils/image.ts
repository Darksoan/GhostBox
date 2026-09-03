import type { CSSProperties } from "react";
import type { GhostBoxGame } from "../data";
import {
  preloadGameDetailsCached,
  preloadGameDetailsListCached,
  normalizeGameCacheId,
} from "./gameCache";
import {
  uniqueSources,
  cssImageUrl,
  preloadImageSources,
} from "./imageCache";
import { preloadGameModalModule } from "./gameModalLoader";

export const profileBannerPlaceholderSource = new URL(
  "../../Icons/ghost-solid.png",
  import.meta.url
).href;

type GameListPreloadOptions = {
  decode?: boolean;
  details?: boolean;
  detailsLimit?: number;
  idle?: boolean;
  limit?: number;
  nativeResolve?: boolean;
  roundRobin?: boolean;
  sourceLimit?: number;
  steamHeaderFirst?: boolean;
  variant?: "header" | "catalogueHeader" | "portrait" | "hero";
};

export function layeredImageStyle(
  sources: string[],
  gradient: string,
  imageSize = "cover",
  hoverImageSize = imageSize
): CSSProperties {
  const imageSources = uniqueSources(sources).map(cssImageUrl).filter(Boolean);
  const layers = [gradient, ...imageSources].filter(Boolean);
  const backgroundSize = [
    ...(gradient ? ["cover"] : []),
    ...imageSources.map(() => imageSize),
  ].join(", ");
  const hoverBackgroundSize = [
    ...(gradient ? ["cover"] : []),
    ...imageSources.map(() => hoverImageSize),
  ].join(", ");

  return {
    backgroundImage: layers.join(", "),
    backgroundPosition: layers.map(() => "center").join(", "),
    backgroundRepeat: layers.map(() => "no-repeat").join(", "),
    backgroundSize:
      "var(--pb-background-size-current, var(--pb-background-size))",
    "--pb-background-image": layers.join(", "),
    "--pb-background-size": backgroundSize,
    "--pb-background-size-hover": hoverBackgroundSize,
  } as CSSProperties;
}

export function getPriorityScreenshotSources(
  screenshots: string[],
  activeIndex: number
) {
  if (!screenshots.length) return [];

  const indexes = [
    activeIndex,
    activeIndex + 1,
    activeIndex - 1,
    activeIndex + 2,
    activeIndex - 2,
  ];

  return uniqueSources(
    indexes.map(
      (index) => screenshots[(index + screenshots.length) % screenshots.length]
    )
  );
}

export function gameCatalogueHeaderSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const screenshotFallback = withoutHeaderImageSources(game.screenshots ?? [])[0];

  return uniqueSources([
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    game.coverUrl,
    ...(game.coverFallbacks ?? []).slice(0, 2),
    screenshotFallback,
  ]);
}

/**
 * Header em alta densidade (920×430) para heros largos de modal. O `header.jpg`
 * da Steam tem 460px e é ampliado em qualquer hero acima disso — em tela a 150%
 * um hero de 560px já pede 840 pixels físicos. Estas URLs sem hash servem de
 * chave: o manifesto injeta a variante com hash na frente de cada uma.
 * `library_hero` entra depois porque alguns jogos não publicam `header_2x`.
 */
export function highDensityHeaderSources(appId: string): string[] {
  if (!appId) return [];
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header_2x.jpg`,
  ];
}

function isHeaderCapsuleImageSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;
  let pathname = normalizedSource.split(/[?#]/)[0];
  try {
    pathname = new URL(normalizedSource).pathname;
  } catch {
    // non-URL still classified by filename
  }
  return /(^|\/)(?:header_2x|capsule_616x353|capsule_231x87|capsule_467x181)\.jpg$/.test(
    pathname.replace(/\\/g, "/"),
  );
}

export function gameHeaderOnlySources(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const rawScreenshotFallback = withoutHeaderImageSources(game.screenshots ?? [])[0];
  // hero 3840×1240 / hero_capsule nunca podem ocupar slot de header 460×215
  const screenshotFallback =
    rawScreenshotFallback &&
    !isHeroImageSource(rawScreenshotFallback) &&
    !/(^|\/)hero_capsule(_2x)?\.jpg$/i.test(rawScreenshotFallback.split(/[?#]/)[0])
      ? rawScreenshotFallback
      : undefined;
  const customHeaderSources = [game.coverUrl, ...(game.coverFallbacks ?? [])].filter(
    (source) =>
      isHeaderImageSource(source) || isHeaderCapsuleImageSource(source),
  );

  return uniqueSources([
    ...customHeaderSources,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    screenshotFallback,
  ]);
}

export function gameSteamHeaderFirstSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const sources = gameHeaderOnlySources(game);
  const steamHeaderSources = sources.filter((source) =>
    isSteamHeaderImageSource(source, appId)
  );

  return uniqueSources([
    ...steamHeaderSources,
    ...sources,
  ]);
}

function isSteamHeaderImageSource(source: string, appId: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource || !appId) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname.toLowerCase();
  } catch {
    // Non-URL sources cannot be predictable Steam CDN headers.
  }

  return pathname.replace(/\\/g, "/").endsWith(`/steam/apps/${appId}/header.jpg`);
}

function getGameListPreloadSources(
  game: GhostBoxGame,
  variant: NonNullable<GameListPreloadOptions["variant"]>,
  sourceLimit: number,
  options: Pick<GameListPreloadOptions, "steamHeaderFirst">
) {
  if (variant === "portrait") {
    return gamePortraitPreviewSources(game).slice(0, sourceLimit);
  }

  if (variant === "hero") {
    return uniqueSources([
      ...gameHeroSources(game),
      ...gameLogoSources(game),
    ]).slice(0, sourceLimit);
  }

  if (variant === "catalogueHeader") {
    return gameCatalogueHeaderSources(game).slice(0, sourceLimit);
  }

  const headerSources = options.steamHeaderFirst
    ? gameSteamHeaderFirstSources(game)
    : gameHeaderOnlySources(game);

  return headerSources.slice(0, sourceLimit);
}

function roundRobinImageSources(sourcesByGame: string[][]) {
  const sources: string[] = [];
  const maxLength = Math.max(0, ...sourcesByGame.map((sources) => sources.length));

  for (let index = 0; index < maxLength; index += 1) {
    for (const gameSources of sourcesByGame) {
      const source = gameSources[index];
      if (source) sources.push(source);
    }
  }

  return uniqueSources(sources);
}

export function isHeaderImageSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname;
  } catch {
    // Non-URL sources still get checked by filename below.
  }

  return /(^|\/)header\.jpg$/.test(pathname.replace(/\\/g, "/"));
}

export function isHeroImageSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname;
  } catch {
    // Non-URL sources still get checked by filename below.
  }

  return /(^|\/)library_hero(_2x)?\.jpg$/.test(pathname.replace(/\\/g, "/"));
}

function isSteamScreenshotSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname;
  } catch {
    // Non-URL sources still get checked by filename below.
  }

  return /(^|\/)ss_[^/]+\.jpg$/.test(pathname.replace(/\\/g, "/"));
}

export function isLandscapeImageSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname;
  } catch {
    // Non-URL sources still get checked by filename below.
  }

  // Common Steam landscape assets that must not be used for portrait covers.
  // The worst offender in the first-boot case is a horizontal screenshot
  // included as `coverFallbacks` by the backend.
  const normalizedPath = pathname.replace(/\\/g, "/");
  return (
    /(^|\/)(?:header_2x|capsule_616x353|capsule_231x87|capsule_467x181)\.jpg$/.test(
      normalizedPath
    ) ||
    /(^|\/)hero_capsule(_2x)?\.jpg$/.test(normalizedPath) ||
    /(^|\/)library_hero(_2x)?\.jpg$/.test(normalizedPath)
  );
}

/**
 * Identifica as capsules verticais da biblioteca Steam, incluindo os aliases
 * legados que ainda podem existir em tarefas de download persistidas.
 */
export function isPortraitLibraryImageSource(source: string) {
  const normalizedSource = source.trim().toLowerCase();
  if (!normalizedSource) return false;

  let pathname = normalizedSource.split(/[?#]/)[0];

  try {
    pathname = new URL(normalizedSource).pathname.toLowerCase();
  } catch {
    // Fontes locais ou relativas ainda podem ser classificadas pelo nome.
  }

  return /(^|\/)(?:library_600x900(?:_2x)?|library_capsule(?:_2x)?)\.jpg$/.test(
    pathname.replace(/\\/g, "/")
  );
}

export function withoutHeaderImageSources(sources: string[]) {
  return uniqueSources(sources).filter(
    (source) => !isHeaderImageSource(source)
  );
}

export function withoutHeroImageSources(sources: string[]) {
  return uniqueSources(sources).filter((source) => !isHeroImageSource(source));
}

export function gameHeroSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const screenshotSources = new Set(game.screenshots ?? []);
  const steamHeroSources = [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
  ];
  const customHeroSources = [
    game.heroUrl,
    game.hero,
    ...(game.heroFallbacks ?? []),
  ].filter(
    (source) =>
      source &&
      !isHeaderImageSource(source) &&
      !isSteamScreenshotSource(source) &&
      !screenshotSources.has(source)
  );

  return uniqueSources([...steamHeroSources, ...customHeroSources]);
}

export function gamePortraitPreviewSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const screenshots = game.screenshots ?? [];
  const screenshotFallback = withoutHeaderImageSources(screenshots)[0];
  const customPortraitSources = [
    game.coverUrl,
    ...(game.coverFallbacks ?? []),
  ].filter(
    (source) =>
      source &&
      /(^|\/)library_600x900\.jpg(?:[?#].*)?$/i.test(source) &&
      !screenshots.includes(source)
  );

  return uniqueSources([
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    ...customPortraitSources,
    screenshotFallback,
  ]);
}

export function gameHeroCapsuleSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
  ]);
}
/**
 * Hero capsule (1920×620) para slots de arte larga, sem cair na library
 * capsule: os fallbacks são apenas artes de paisagem (`capsule_616x353` /
 * `header`), para o slot largo nunca receber a capa vertical da biblioteca
 * (`library_600x900`). O host legado `cdn.cloudflare.steamstatic.com` vem
 * primeiro porque publica hero_capsule para jogos antigos que a raiz
 * `store_item_assets` não tem.
 */
export function gameHeroCapsuleOnlySources(game: GhostBoxGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
  ]);
}

export function gameLogoSources(game: GhostBoxGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    game.logo,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_logo.png`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_logo.png`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/logo.png`,
  ]);
}

function gameModalAssetSources(game: GhostBoxGame, activeScreenshot = 0) {
  const screenshots = withoutHeaderImageSources(game.screenshots);
  const showcaseSources = uniqueSources([
    ...gameHeroSources(game),
    ...screenshots,
  ]);

  return uniqueSources([
    ...getPriorityScreenshotSources(showcaseSources, activeScreenshot),
    ...gameLogoSources(game),
  ]);
}

export function preloadGamePortraitSources(game: GhostBoxGame) {
  preloadImageSources(gamePortraitPreviewSources(game), { limit: 4, idle: true });
}

export function preloadGameModalAssets(
  game: GhostBoxGame,
  activeScreenshot = 0,
  options: { nativeResolve?: boolean } = {}
) {
  preloadGameModalModule();
  preloadGameDetailsCached(normalizeGameCacheId(game));
  preloadImageSources(gameModalAssetSources(game, activeScreenshot), {
    limit: 8,
    decode: true,
    includeCached: options.nativeResolve === true,
  });
}

// Throttled, deduped variant for hover/focus-driven preloads (sidebar items,
// header search suggestions). Avoids firing dozens of preloads when the
// pointer sweeps across a list rapidly.
const PRELOAD_HOVER_THROTTLE_MS = 120;
const preloadHoverLastRunRef = { current: 0 };
const preloadHoverQueuedRef = { current: null as GhostBoxGame | null };
const preloadHoverTimeoutRef = { current: undefined as number | undefined };
const preloadedGameIds = new Set<string>();

export function preloadGameModalAssetsThrottled(game: GhostBoxGame) {
  const cacheKey = normalizeGameCacheId(game);
  if (preloadedGameIds.has(cacheKey)) return;

  const now = Date.now();
  const elapsed = now - preloadHoverLastRunRef.current;

  preloadHoverQueuedRef.current = game;

  if (elapsed >= PRELOAD_HOVER_THROTTLE_MS) {
    flushPreloadHover();
    return;
  }

  if (preloadHoverTimeoutRef.current !== undefined) return;
  preloadHoverTimeoutRef.current = window.setTimeout(
    flushPreloadHover,
    PRELOAD_HOVER_THROTTLE_MS - elapsed
  );
}

function flushPreloadHover() {
  const game = preloadHoverQueuedRef.current;
  if (preloadHoverTimeoutRef.current !== undefined) {
    window.clearTimeout(preloadHoverTimeoutRef.current);
    preloadHoverTimeoutRef.current = undefined;
  }
  if (!game) return;

  preloadHoverQueuedRef.current = null;
  preloadHoverLastRunRef.current = Date.now();
  preloadedGameIds.add(normalizeGameCacheId(game));
  preloadGameModalAssets(game, 0, { nativeResolve: false });
}

export function preloadGameListAssets(
  games: GhostBoxGame[],
  options: GameListPreloadOptions = {}
) {
  const variant = options.variant ?? "header";
  const limit = options.limit ?? games.length;
  const sourceLimit = options.sourceLimit ?? 1;
  if (options.details) {
    preloadGameDetailsListCached(
      games,
      options.detailsLimit ?? Math.min(limit, 4)
    );
  }

  const sourcesByGame = games.slice(0, limit).map((game) =>
    getGameListPreloadSources(game, variant, sourceLimit, options)
  );
  const sources = options.roundRobin
    ? roundRobinImageSources(sourcesByGame)
    : sourcesByGame.flat();

  return preloadImageSources(sources, {
    decode: options.decode,
    idle: options.idle ?? true,
    includeCached: options.nativeResolve === true,
  });
}

export function preloadProfileImages(
  profile: { avatarUrl?: string; bannerUrl?: string } | null | undefined
) {
  if (!profile) return;

  preloadImageSources([profile.avatarUrl ?? ""], {
    limit: 1,
    idle: false,
    decode: true,
  });

  preloadImageSources(
    [profile.bannerUrl ?? profileBannerPlaceholderSource],
    {
      limit: 1,
      idle: false,
      decode: true,
    }
  );
}

export function getGameAppId(game: GhostBoxGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

export function gameStyle(game: GhostBoxGame): import("react").CSSProperties {
  return {
    "--accent": game.accent,
  } as import("react").CSSProperties;
}
