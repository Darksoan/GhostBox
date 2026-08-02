/**
 * Local-only affinity profile for catalogue recommendations. Built entirely
 * from data already on the device (installed library, favorites, collections)
 * — nothing here reads or sends anything over the network.
 */

export interface AffinityGameLike {
  genres?: string[];
  tags?: string[];
  developers?: string[];
  playTimeInMilliseconds?: number;
}

export interface AffinitySources {
  libraryGames?: AffinityGameLike[];
  favoriteGames?: AffinityGameLike[];
  collectionGames?: AffinityGameLike[];
}

export interface AffinityProfile {
  genres: Map<string, number>;
  tags: Map<string, number>;
  developers: Map<string, number>;
  isEmpty: boolean;
}

// Playtime is the strongest signal (proven interest); library and favorites
// are both an explicit, similarly strong signal; collections are a weaker,
// more casual grouping.
const LIBRARY_BASE_WEIGHT = 2;
const FAVORITE_WEIGHT = 2;
const COLLECTION_WEIGHT = 1;
const PLAYTIME_HOURS_WEIGHT = 0.2;
const PLAYTIME_HOURS_CAP = 20;

// A shared genre matters more than a shared tag; a shared developer sits
// between the two.
const GENRE_MATCH_WEIGHT = 1;
const TAG_MATCH_WEIGHT = 0.6;
const DEVELOPER_MATCH_WEIGHT = 0.8;

function normalizeTrait(value: string): string {
  return value.trim().toLowerCase();
}

function playtimeHours(game: AffinityGameLike): number {
  return (game.playTimeInMilliseconds ?? 0) / 3_600_000;
}

function accumulate(map: Map<string, number>, values: string[] | undefined, weight: number) {
  for (const raw of values ?? []) {
    const trait = normalizeTrait(raw);
    if (!trait) continue;
    map.set(trait, (map.get(trait) ?? 0) + weight);
  }
}

function normalizeMap(map: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...map.values());
  if (max <= 0) return map;
  const normalized = new Map<string, number>();
  for (const [trait, value] of map) normalized.set(trait, value / max);
  return normalized;
}

export function buildAffinityProfile(sources: AffinitySources): AffinityProfile {
  const genres = new Map<string, number>();
  const tags = new Map<string, number>();
  const developers = new Map<string, number>();

  for (const game of sources.libraryGames ?? []) {
    const hours = Math.min(playtimeHours(game), PLAYTIME_HOURS_CAP);
    const weight = LIBRARY_BASE_WEIGHT + hours * PLAYTIME_HOURS_WEIGHT;
    accumulate(genres, game.genres, weight);
    accumulate(tags, game.tags, weight);
    accumulate(developers, game.developers, weight);
  }
  for (const game of sources.favoriteGames ?? []) {
    accumulate(genres, game.genres, FAVORITE_WEIGHT);
    accumulate(tags, game.tags, FAVORITE_WEIGHT);
    accumulate(developers, game.developers, FAVORITE_WEIGHT);
  }
  for (const game of sources.collectionGames ?? []) {
    accumulate(genres, game.genres, COLLECTION_WEIGHT);
    accumulate(tags, game.tags, COLLECTION_WEIGHT);
    accumulate(developers, game.developers, COLLECTION_WEIGHT);
  }

  return {
    genres: normalizeMap(genres),
    tags: normalizeMap(tags),
    developers: normalizeMap(developers),
    isEmpty: genres.size === 0 && tags.size === 0 && developers.size === 0,
  };
}

export function scoreAffinity(profile: AffinityProfile, game: AffinityGameLike): number {
  let score = 0;
  for (const genre of game.genres ?? []) {
    score += (profile.genres.get(normalizeTrait(genre)) ?? 0) * GENRE_MATCH_WEIGHT;
  }
  for (const tag of game.tags ?? []) {
    score += (profile.tags.get(normalizeTrait(tag)) ?? 0) * TAG_MATCH_WEIGHT;
  }
  for (const developer of game.developers ?? []) {
    score += (profile.developers.get(normalizeTrait(developer)) ?? 0) * DEVELOPER_MATCH_WEIGHT;
  }
  return score;
}

export function topAffinityTraits(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([trait]) => trait);
}
