import type { GhostBoxGame } from "../data";

export type GameSeed = {
  appId: string;
  title: string;
  shortDescription?: string;
};

function seedSteamCdnUrl(appId: string, asset: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`;
}

/**
 * Synthesizes a displayable GhostBoxGame from just {appId, title} so a section
 * can paint instantly before the real catalogue/store-details hydration lands.
 */
export function createSeedGame(
  game: GameSeed,
  index: number,
  subtitle = "Mais avaliados na Steam"
): GhostBoxGame {
  // Brand-aligned card accents only (no blue UI tints).
  const accent = ["#ff2d35", "#f59e0b", "#35d07f", "#8b5cf6", "#c084fc"][
    index % 5
  ];
  const headerImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`;
  const heroImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_hero.jpg`;
  const headerCdn = seedSteamCdnUrl(game.appId, "header.jpg");
  const heroCdn = seedSteamCdnUrl(game.appId, "library_hero.jpg");
  const logoCdn = seedSteamCdnUrl(game.appId, "logo.png");

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
