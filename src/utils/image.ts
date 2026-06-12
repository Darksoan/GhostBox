import type { CSSProperties } from "react";
import type { PirateGame } from "../data";
import {
  preloadGameDetailsCached,
  preloadGameDetailsListCached,
} from "./gameCache";
import {
  imageSourceCache,
  uniqueSources,
  cssImageUrl,
  preloadImageSources,
  preloadBrowserImage,
  resolveCachedImageSource,
} from "./imageCache";

export const profileBannerPlaceholderSource = new URL(
  "../assets/images/defaultbanner.png",
  import.meta.url
).href;

type GameListPreloadOptions = {
  decode?: boolean;
  details?: boolean;
  detailsLimit?: number;
  idle?: boolean;
  limit?: number;
  variant?: "header" | "portrait" | "hero";
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

export function gameHeaderSources(game: PirateGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    game.coverUrl,
    ...(game.coverFallbacks ?? []),
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
  ]);
}

export function gameCatalogueHeaderSources(game: PirateGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    game.coverUrl,
    ...(game.coverFallbacks ?? []).slice(0, 2),
  ]);
}

export function gameHeaderOnlySources(game: PirateGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
  ]);
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
  // included as `coverFallbacks` by the backend; we also exclude actual
  // `game.screenshots` in `gamePortraitSources()`.
  const normalizedPath = pathname.replace(/\\/g, "/");
  return (
    /(^|\/)(?:capsule_616x353|capsule_231x87|capsule_467x181)\.jpg$/.test(
      normalizedPath
    ) ||
    /(^|\/)hero_capsule(_2x)?\.jpg$/.test(normalizedPath) ||
    /(^|\/)library_hero(_2x)?\.jpg$/.test(normalizedPath)
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

export function gameHeroSources(game: PirateGame) {
  const appId = getGameAppId(game);

  return withoutHeaderImageSources([
    game.heroUrl,
    ...(game.heroFallbacks ?? []),
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
  ]);
}

export function gamePortraitSources(game: PirateGame) {
  const appId = getGameAppId(game);
  const customPortraitSources = [
    game.coverUrl,
    ...(game.coverFallbacks ?? []),
  ].filter((source) => !isHeaderImageSource(source));

  return uniqueSources([
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    ...customPortraitSources.filter(
      (source) =>
        // Avoid landscape (horizontal) assets being used as portrait cover.
        !isHeroImageSource(source) &&
        !isLandscapeImageSource(source) &&
        // Backend includes `screenshots[0]` inside `coverFallbacks`; that is
        // almost always horizontal and causes the initial "stretched" cover.
        !game.screenshots.includes(source)
    ),
  ]);
}

export function gameHeroCapsuleSources(game: PirateGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.akamai.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://shared.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/hero_capsule.jpg`,
  ]);
}

export function gameLogoSources(game: PirateGame) {
  const appId = getGameAppId(game);

  return uniqueSources([
    game.logo,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_logo.png`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_logo.png`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/logo.png`,
  ]);
}

export function gameModalAssetSources(game: PirateGame, activeScreenshot = 0) {
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

export function preloadGamePortraitSources(game: PirateGame) {
  preloadImageSources(gamePortraitSources(game), { limit: 6, idle: true });
}

export function preloadGameHeroCapsuleSources(game: PirateGame) {
  preloadImageSources(gameHeroCapsuleSources(game), { limit: 3, idle: true });
}

export function preloadGameHeaderSources(game: PirateGame) {
  preloadImageSources(gameHeaderSources(game), { limit: 3, idle: true });
}

export function preloadGameHeaderOnlySources(game: PirateGame) {
  preloadImageSources(gameHeaderOnlySources(game), { limit: 3, idle: true });
}

export function preloadGameHeroSources(game: PirateGame) {
  preloadImageSources(
    uniqueSources([...gameHeroSources(game), ...gameLogoSources(game)]),
    { limit: 6, idle: true }
  );
}

export function preloadGameLogoSources(game: PirateGame) {
  preloadImageSources(gameLogoSources(game), { limit: 3, decode: true });
}

export function preloadGameModalAssets(game: PirateGame, activeScreenshot = 0) {
  preloadGameDetailsCached(game.id);
  preloadImageSources(gameModalAssetSources(game, activeScreenshot), {
    limit: 8,
    decode: true,
  });
}

export function preloadGameListAssets(
  games: PirateGame[],
  options: GameListPreloadOptions = {}
) {
  const variant = options.variant ?? "header";
  const limit = options.limit ?? games.length;
  if (options.details) {
    preloadGameDetailsListCached(
      games,
      options.detailsLimit ?? Math.min(limit, 4)
    );
  }

  const sources = games.slice(0, limit).flatMap((game) => {
    if (variant === "portrait") return gamePortraitSources(game).slice(0, 6);
    if (variant === "hero") {
      return uniqueSources([
        ...gameHeroSources(game),
        ...gameLogoSources(game),
      ]).slice(0, 6);
    }

    return gameHeaderOnlySources(game).slice(0, 6);
  });

  preloadImageSources(sources, {
    decode: options.decode,
    idle: options.idle ?? true,
  });
}

export async function preloadGameListAssetsReady(
  games: PirateGame[],
  options: GameListPreloadOptions = {}
) {
  const variant = options.variant ?? "header";
  const limit = options.limit ?? games.length;

  const sources = games.slice(0, limit).flatMap((game) => {
    if (variant === "portrait") return gamePortraitSources(game).slice(0, 1);
    if (variant === "hero") {
      return uniqueSources([...gameHeroSources(game), ...gameLogoSources(game)]).slice(0, 1);
    }

    return gameHeaderOnlySources(game).slice(0, 1);
  });

  await Promise.all(
    uniqueSources(sources).map(async (source) => {
      const resolvedSource = await resolveCachedImageSource(source);
      await preloadBrowserImage(resolvedSource, {
        decode: options.decode ?? true,
      });
    })
  );
}

export function preloadProfileImages(
  profile: { avatarUrl?: string; bannerUrl?: string } | null | undefined
) {
  if (!profile) return;

  preloadImageSources(
    [
      profile.avatarUrl ?? "",
      profile.bannerUrl ?? profileBannerPlaceholderSource,
    ],
    {
      limit: 2,
      idle: false,
      decode: true,
    }
  );
}

export function getGameAppId(game: PirateGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

export function gameStyle(game: PirateGame): import("react").CSSProperties {
  return {
    "--accent": game.accent,
  } as import("react").CSSProperties;
}

export function getImageFromCache(source: string) {
  return imageSourceCache.get(source);
}
