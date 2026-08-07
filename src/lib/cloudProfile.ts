import type { SteamProfile, UserCollection } from "../types";

export const CLOUD_PROFILE_SCHEMA_VERSION = 2 as const;

const MAX_URL_LENGTH = 2048;
const MAX_COLLECTION_NAME_LENGTH = 64;
const MAX_COLLECTIONS = 100;
const MAX_GAMES_PER_COLLECTION = 2000;
const MAX_FAVORITES = 5000;

const URL_PREFIXES: Array<{ compact: string; expand: string }> = [
  {
    compact: "s-av:",
    expand: "https://avatars.cloudflare.steamstatic.com/",
  },
  {
    compact: "s-av2:",
    expand: "https://avatars.akamai.steamstatic.com/",
  },
  {
    compact: "s-av3:",
    expand: "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/",
  },
  {
    compact: "s-cdn:",
    expand: "https://cdn.cloudflare.steamstatic.com/steam/",
  },
  {
    compact: "s-cdn2:",
    expand: "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/",
  },
  {
    compact: "s-media:",
    expand: "https://shared.akamai.steamstatic.com/store_item_assets/steam/",
  },
];

export type CloudProfileBannerPosition = {
  x: number;
  y: number;
  scale: number;
};

export type CloudProfileCollection = {
  id: string;
  name: string;
  gameIds: string[];
};

export type CloudProfileSnapshot = {
  version: number;
  updatedAt: string;
  steamProfile: {
    displayName: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    bannerPosition: CloudProfileBannerPosition | null;
  };
  favoriteGameIds: string[];
  userCollections: CloudProfileCollection[];
};

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:/i.test(trimmed)) {
    throw new Error("Cloud profile images must be uploaded to storage before syncing.");
  }
  if (trimmed.length > MAX_URL_LENGTH) throw new Error("Cloud profile URL is too long.");
  return trimmed;
}

export function compactCloudUrl(value: string | null | undefined): string | null {
  const url = normalizeUrl(value);
  if (!url) return null;

  for (const entry of URL_PREFIXES) {
    if (url.startsWith(entry.expand)) {
      const rest = url.slice(entry.expand.length);
      if (!rest) return url;
      return `${entry.compact}${rest}`;
    }
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "steamcommunity.com" ||
      parsed.hostname.endsWith(".steamcommunity.com")
    ) {
      return url;
    }
  } catch {
    // keep as-is
  }

  return url;
}

export function expandCloudUrl(value: string | null | undefined): string | null {
  const raw = normalizeUrl(value);
  if (!raw) return null;

  for (const entry of URL_PREFIXES) {
    if (raw.startsWith(entry.compact)) {
      return `${entry.expand}${raw.slice(entry.compact.length)}`;
    }
  }

  return raw;
}

export function compactBannerPosition(
  position: SteamProfile["bannerPosition"] | null | undefined
): CloudProfileBannerPosition | null {
  if (!position) return null;
  return {
    x: clampInt(position.x ?? 50, 0, 100),
    y: clampInt(position.y ?? 50, 0, 100),
    scale: Number(
      Math.min(3, Math.max(1, Number(position.scale ?? 1) || 1)).toFixed(2)
    ),
  };
}

export function buildCloudProfileSnapshot(input: {
  updatedAt?: string;
  steamProfile: Pick<
    SteamProfile,
    "displayName" | "avatarUrl" | "bannerUrl" | "bannerPosition"
  > | null;
  favoriteGames: Array<{ id: string }>;
  favoriteGameIds?: string[];
  userCollections: UserCollection[];
}): CloudProfileSnapshot {
  const usedCollectionIds = new Set<string>();
  const collections = input.userCollections
    .slice(0, MAX_COLLECTIONS)
    .map((collection, index) => {
      const baseId = String(collection.id || `collection-${index}`).trim().slice(0, 80);
      let id = baseId || `collection-${index}`;
      if (usedCollectionIds.has(id)) id = `${id}-${index}`.slice(0, 80);
      usedCollectionIds.add(id);
      const name = String(collection.name || "")
        .trim()
        .slice(0, MAX_COLLECTION_NAME_LENGTH);
      const gameIds = Array.from(
        new Set(
          (collection.gameIds ?? [])
            .map((gameId) => String(gameId || "").trim())
            .filter(Boolean)
        )
      ).slice(0, MAX_GAMES_PER_COLLECTION);

      return { id, name, gameIds };
    })
    .filter((collection) => collection.id && collection.name);
  const favoriteGameIds = Array.from(
    new Set(
      input.favoriteGames
        .map((game) => String(game.id || "").trim())
        .concat(
          (input.favoriteGameIds ?? []).map((gameId) =>
            String(gameId || "").trim()
          )
        )
        .filter(Boolean)
    )
  ).slice(0, MAX_FAVORITES);

  return {
    version: CLOUD_PROFILE_SCHEMA_VERSION,
    updatedAt: input.updatedAt || new Date().toISOString(),
    steamProfile: {
      displayName: input.steamProfile?.displayName?.trim() || null,
      avatarUrl: compactCloudUrl(input.steamProfile?.avatarUrl),
      bannerUrl: compactCloudUrl(input.steamProfile?.bannerUrl),
      bannerPosition: compactBannerPosition(input.steamProfile?.bannerPosition),
    },
    favoriteGameIds,
    userCollections: collections,
  };
}

export function expandCloudProfileSnapshot(
  snapshot: CloudProfileSnapshot | null | undefined
): CloudProfileSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;

  return {
    version: CLOUD_PROFILE_SCHEMA_VERSION,
    updatedAt:
      typeof snapshot.updatedAt === "string" && snapshot.updatedAt
        ? snapshot.updatedAt
        : new Date(0).toISOString(),
    steamProfile: {
      displayName: snapshot.steamProfile?.displayName?.trim() || null,
      avatarUrl: expandCloudUrl(snapshot.steamProfile?.avatarUrl),
      bannerUrl: expandCloudUrl(snapshot.steamProfile?.bannerUrl),
      bannerPosition: compactBannerPosition(snapshot.steamProfile?.bannerPosition),
    },
    favoriteGameIds: Array.isArray(snapshot.favoriteGameIds)
      ? Array.from(
          new Set(
            snapshot.favoriteGameIds
              .map((gameId) => String(gameId || "").trim())
              .filter(Boolean)
          )
        ).slice(0, MAX_FAVORITES)
      : [],
    userCollections: Array.isArray(snapshot.userCollections)
      ? snapshot.userCollections
          .slice(0, MAX_COLLECTIONS)
          .map((collection, index) => ({
            id: String(collection?.id || `collection-${index}`).trim().slice(0, 80),
            name: String(collection?.name || "")
              .trim()
              .slice(0, MAX_COLLECTION_NAME_LENGTH),
            gameIds: Array.from(
              new Set(
                (collection?.gameIds ?? [])
                  .map((gameId) => String(gameId || "").trim())
                  .filter(Boolean)
              )
            ).slice(0, MAX_GAMES_PER_COLLECTION),
          }))
          .filter((collection) => collection.id && collection.name)
      : [],
  };
}

export function applyCloudProfileToLocal(input: {
  currentProfile: SteamProfile | null;
  snapshot: CloudProfileSnapshot;
}): {
  steamProfile: SteamProfile | null;
  favoriteGameIds: string[];
  userCollections: UserCollection[];
} {
  const expanded = expandCloudProfileSnapshot(input.snapshot);
  if (!expanded) {
    return {
      steamProfile: input.currentProfile,
      favoriteGameIds: [],
      userCollections: [],
    };
  }

  // The cloud profile belongs to the GhostBox account, not to Steam, so a
  // user with no Steam connected still gets their avatar/banner/display name
  // back. Returning null here used to drop them on the floor.
  const current: SteamProfile = input.currentProfile ?? {
    steamId: "",
    displayName: "",
    avatarUrl: "",
    profileUrl: "",
  };
  const steamProfile: SteamProfile = {
    ...current,
    displayName:
      expanded.steamProfile.displayName?.trim() || current.displayName,
    avatarUrl: expanded.steamProfile.avatarUrl ?? "",
    bannerUrl: expanded.steamProfile.bannerUrl ?? "",
    bannerPosition: expanded.steamProfile.bannerPosition ?? undefined,
  };

  const userCollections: UserCollection[] = expanded.userCollections.map(
    (collection) => ({
      id: collection.id,
      name: collection.name,
      gameIds: collection.gameIds,
      games: [],
    })
  );

  return { steamProfile, favoriteGameIds: expanded.favoriteGameIds, userCollections };
}

export function isCloudSnapshotNewer(
  remoteUpdatedAt: string | null | undefined,
  localUpdatedAt: string | null | undefined
) {
  const remote = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : Number.NaN;
  const local = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (!Number.isFinite(remote)) return false;
  if (!Number.isFinite(local)) return true;
  return remote > local;
}
