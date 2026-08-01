import type { GhostBoxGame } from "../data";
import type { GamePlaytimeSnapshot } from "../lib/ghostboxApi.types";
import type { SteamOwnedPlaytime } from "../types";

function steamAssetUrl(appId: string, fileName: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${fileName}`;
}

function isoFromUnixSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

export function buildSteamOwnedGamesFromPlaytimes(
  entries: SteamOwnedPlaytime[],
  snapshot: GamePlaytimeSnapshot,
): GhostBoxGame[] {
  return entries
    .map((entry) => {
      const appId = entry.appId.trim();
      if (!/^\d+$/.test(appId)) return null;

      const playtime = snapshot[appId];
      const playTimeInMilliseconds =
        playtime?.playTimeInMilliseconds ?? entry.playtimeForever * 60_000;
      const lastTimePlayed =
        playtime?.lastTimePlayed ?? isoFromUnixSeconds(entry.rtimeLastPlayed);
      const title = entry.name?.trim() || `Steam App ${appId}`;
      const cover = steamAssetUrl(appId, "library_600x900.jpg");
      const hero = steamAssetUrl(appId, "library_hero.jpg");

      const game: GhostBoxGame = {
        appId,
        id: `steam-${appId}`,
        librarySource: "steam-owned",
        title,
        subtitle: "Steam",
        status: "discover",
        hours: Math.round((playTimeInMilliseconds / 3_600_000) * 10) / 10,
        playTimeInMilliseconds,
        lastTimePlayed,
        rating: 0,
        size: "",
        release: "",
        progress: 0,
        accent: "#7aa2f7",
        cover,
        hero,
        coverUrl: cover,
        heroUrl: hero,
        coverFallbacks: [
          steamAssetUrl(appId, "library_600x900_2x.jpg"),
          steamAssetUrl(appId, "capsule_616x353.jpg"),
          steamAssetUrl(appId, "header.jpg"),
        ],
        heroFallbacks: [
          steamAssetUrl(appId, "library_hero_2x.jpg"),
          steamAssetUrl(appId, "hero_capsule.jpg"),
          steamAssetUrl(appId, "header.jpg"),
        ],
        logo: steamAssetUrl(appId, "logo.png"),
        tags: [],
        genres: [],
        screenshots: [],
        achievements: { unlocked: 0, total: 0, progress: 0 },
        achievementList: [],
      };

      return game;
    })
    .filter((game): game is GhostBoxGame => game !== null);
}
