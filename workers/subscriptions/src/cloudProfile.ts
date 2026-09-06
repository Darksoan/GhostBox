export type NormalizedBannerPosition = { x: number; y: number; scale: number };

export type NormalizedCloudCollection = {
  id: string;
  name: string;
  gameIds: string[];
};

export type NormalizedCloudProfileSnapshot = {
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bannerPosition: NormalizedBannerPosition;
  favoriteGameIds: string[];
  collections: NormalizedCloudCollection[];
};

export type StoredProfileRow = {
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  banner_position_x: number | null;
  banner_position_y: number | null;
  banner_position_scale: number | null;
};

export type StoredCollectionRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

export type StoredCollectionGameRow = {
  collection_id: string;
  game_id: string;
  sort_order: number | null;
};

export type StoredFavoriteRow = {
  game_id: string;
};

export type CloudProfileDiff = {
  profileChanged: boolean;
  favoritesAdded: string[];
  favoritesRemoved: string[];
  favoritesOrderChanged: boolean;
  collectionsAdded: string[];
  collectionsRemoved: string[];
  collectionsChanged: string[];
  gamesAdded: Array<{ collectionId: string; gameId: string }>;
  gamesRemoved: Array<{ collectionId: string; gameId: string }>;
  gamesOrderChanged: string[];
};

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function storedRowsToNormalizedSnapshot(
  profile: StoredProfileRow | null,
  collections: StoredCollectionRow[],
  games: StoredCollectionGameRow[],
  favorites: StoredFavoriteRow[]
): NormalizedCloudProfileSnapshot {
  const orderedCollections = [...collections].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (order !== 0) return order;
    return String(a.name).localeCompare(String(b.name));
  });
  const gamesByCollection = new Map<string, Array<{ gameId: string; order: number }>>();
  for (const row of games) {
    const list = gamesByCollection.get(row.collection_id) || [];
    list.push({ gameId: row.game_id, order: row.sort_order ?? 0 });
    gamesByCollection.set(row.collection_id, list);
  }
  for (const list of gamesByCollection.values()) {
    list.sort((a, b) => a.order - b.order);
  }

  return {
    displayName: normalizeName(profile?.display_name),
    avatarUrl: profile?.avatar_url || null,
    bannerUrl: profile?.banner_url || null,
    bannerPosition: {
      x: clampInt(profile?.banner_position_x, 0, 100, 50),
      y: clampInt(profile?.banner_position_y, 0, 100, 50),
      scale: clampInt(profile?.banner_position_scale, 100, 300, 100),
    },
    favoriteGameIds: [...favorites.map((row) => row.game_id)],
    collections: orderedCollections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      gameIds: (gamesByCollection.get(collection.id) || []).map((entry) => entry.gameId),
    })),
  };
}

export function normalizeIncomingSnapshot(snapshot: {
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bannerPosition: NormalizedBannerPosition;
  favoriteGameIds: string[];
  collections: Array<{ id: string; name: string; gameIds: string[] }>;
}): NormalizedCloudProfileSnapshot {
  return {
    displayName: normalizeName(snapshot.displayName),
    avatarUrl: snapshot.avatarUrl || null,
    bannerUrl: snapshot.bannerUrl || null,
    bannerPosition: {
      x: clampInt(snapshot.bannerPosition?.x, 0, 100, 50),
      y: clampInt(snapshot.bannerPosition?.y, 0, 100, 50),
      scale: clampInt(snapshot.bannerPosition?.scale, 100, 300, 100),
    },
    favoriteGameIds: [...snapshot.favoriteGameIds],
    collections: snapshot.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      gameIds: [...collection.gameIds],
    })),
  };
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function diffCloudProfileSnapshots(
  current: NormalizedCloudProfileSnapshot | null,
  incoming: NormalizedCloudProfileSnapshot
): CloudProfileDiff | null {
  const base: NormalizedCloudProfileSnapshot = current || {
    displayName: null,
    avatarUrl: null,
    bannerUrl: null,
    bannerPosition: { x: 50, y: 50, scale: 100 },
    favoriteGameIds: [],
    collections: [],
  };

  const profileChanged =
    current === null ||
    (base.displayName || null) !== (incoming.displayName || null) ||
    (base.avatarUrl || null) !== (incoming.avatarUrl || null) ||
    (base.bannerUrl || null) !== (incoming.bannerUrl || null) ||
    base.bannerPosition.x !== incoming.bannerPosition.x ||
    base.bannerPosition.y !== incoming.bannerPosition.y ||
    base.bannerPosition.scale !== incoming.bannerPosition.scale;

  const currentFavorites = new Set(base.favoriteGameIds);
  const incomingFavorites = new Set(incoming.favoriteGameIds);
  const favoritesAdded = incoming.favoriteGameIds.filter((id) => !currentFavorites.has(id));
  const favoritesRemoved = base.favoriteGameIds.filter((id) => !incomingFavorites.has(id));
  const favoritesOrderChanged =
    favoritesAdded.length === 0 &&
    favoritesRemoved.length === 0 &&
    !sameStringList(base.favoriteGameIds, incoming.favoriteGameIds);

  const currentCollections = new Map(base.collections.map((entry) => [entry.id, entry]));
  const incomingCollections = new Map(incoming.collections.map((entry) => [entry.id, entry]));
  const collectionsAdded = incoming.collections
    .filter((entry) => !currentCollections.has(entry.id))
    .map((entry) => entry.id);
  const collectionsRemoved = base.collections
    .filter((entry) => !incomingCollections.has(entry.id))
    .map((entry) => entry.id);
  const collectionsChanged: string[] = [];
  const currentOrder = base.collections.map((entry) => entry.id);
  const incomingOrder = incoming.collections.map((entry) => entry.id);
  const orderChanged =
    collectionsAdded.length === 0 &&
    collectionsRemoved.length === 0 &&
    !sameStringList(currentOrder, incomingOrder);
  for (const incomingCollection of incoming.collections) {
    const existing = currentCollections.get(incomingCollection.id);
    if (!existing) continue;
    if (existing.name !== incomingCollection.name) {
      collectionsChanged.push(incomingCollection.id);
    }
  }
  if (orderChanged) {
    for (const id of incomingOrder) {
      if (!collectionsChanged.includes(id) && currentCollections.has(id)) {
        collectionsChanged.push(id);
      }
    }
  }

  const gamesAdded: CloudProfileDiff["gamesAdded"] = [];
  const gamesRemoved: CloudProfileDiff["gamesRemoved"] = [];
  const gamesOrderChanged: string[] = [];
  for (const incomingCollection of incoming.collections) {
    const existing = currentCollections.get(incomingCollection.id);
    if (!existing) {
      for (const gameId of incomingCollection.gameIds) {
        gamesAdded.push({ collectionId: incomingCollection.id, gameId });
      }
      continue;
    }
    const currentSet = new Set(existing.gameIds);
    const incomingSet = new Set(incomingCollection.gameIds);
    for (const gameId of incomingCollection.gameIds) {
      if (!currentSet.has(gameId)) gamesAdded.push({ collectionId: incomingCollection.id, gameId });
    }
    for (const gameId of existing.gameIds) {
      if (!incomingSet.has(gameId)) gamesRemoved.push({ collectionId: incomingCollection.id, gameId });
    }
    const onlyReordered =
      existing.gameIds.length === incomingCollection.gameIds.length &&
      existing.gameIds.every((gameId) => incomingSet.has(gameId)) &&
      !sameStringList(existing.gameIds, incomingCollection.gameIds);
    if (onlyReordered) gamesOrderChanged.push(incomingCollection.id);
  }
  for (const removedId of collectionsRemoved) {
    const removed = currentCollections.get(removedId);
    if (!removed) continue;
    for (const gameId of removed.gameIds) {
      gamesRemoved.push({ collectionId: removedId, gameId });
    }
  }

  const diff: CloudProfileDiff = {
    profileChanged,
    favoritesAdded,
    favoritesRemoved,
    favoritesOrderChanged,
    collectionsAdded,
    collectionsRemoved,
    collectionsChanged,
    gamesAdded,
    gamesRemoved,
    gamesOrderChanged,
  };

  const identical =
    !diff.profileChanged &&
    diff.favoritesAdded.length === 0 &&
    diff.favoritesRemoved.length === 0 &&
    !diff.favoritesOrderChanged &&
    diff.collectionsAdded.length === 0 &&
    diff.collectionsRemoved.length === 0 &&
    diff.collectionsChanged.length === 0 &&
    diff.gamesAdded.length === 0 &&
    diff.gamesRemoved.length === 0 &&
    diff.gamesOrderChanged.length === 0;

  if (identical) return null;
  return diff;
}

export function buildCloudProfilePayloads(snapshot: NormalizedCloudProfileSnapshot): {
  favoritesJson: string;
  collectionsJson: string;
} {
  const favoritesJson = JSON.stringify(snapshot.favoriteGameIds);
  const collectionsJson = JSON.stringify(
    snapshot.collections.map((collection, index) => ({
      id: collection.id,
      name: collection.name,
      o: index,
      games: collection.gameIds,
    }))
  );
  return { favoritesJson, collectionsJson };
}
