import type { GhostBoxGame } from "../data";
import type { StoredSteamWishlistCycle } from "./storage";
import { isSteamTitlePlaceholder } from "./steamTitles";

export const wishlistCycleAlgorithmVersion = "wishlist-cycle-v3";
// One entry per past day: keep two months of exposures before recycling games.
export const homeWishlistCycleHistoryLimit = 60;

type WishlistTraitInput = Iterable<string>;

type RankWishlistCandidatesOptions = {
  sourceTraits?: WishlistTraitInput;
  userTraits?: WishlistTraitInput;
  excludedAppIds?: Set<string>;
};

type PickWishlistCycleGamesOptions = RankWishlistCandidatesOptions & {
  gameCount: number;
};

type CreateWishlistCycleOptions = {
  steamId: string;
  selectedGames: GhostBoxGame[];
  storedCycle: StoredSteamWishlistCycle | null;
  cycleStart: Date;
  historyLimit?: number;
};

function atLocalStartOfDay(date: Date) {
  const next = Number.isFinite(date.getTime()) ? new Date(date) : new Date();
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeWishlistTrait(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  const aliases: Record<string, string> = {
    acao: "action",
    ação: "action",
    aventura: "adventure",
    historia: "story rich",
    história: "story rich",
    story: "story rich",
    terror: "horror",
    corrida: "racing",
    esportes: "sports",
    estrategia: "strategy",
    estratégia: "strategy",
    exploracao: "exploration",
    exploração: "exploration",
  };
  return aliases[normalized] ?? normalized;
}

function gameAppId(game: GhostBoxGame) {
  return (game.appId || game.id.replace(/^steam-/, "")).trim();
}

function gameTraits(game: GhostBoxGame) {
  return new Set(
    [...game.tags, ...game.genres].map(normalizeWishlistTrait).filter(Boolean)
  );
}

function traitSet(values: WishlistTraitInput = []) {
  return new Set([...values].map(normalizeWishlistTrait).filter(Boolean));
}

function qualityScore(game: GhostBoxGame) {
  const popularity = Math.log10(
    (game.recommendations ?? game.steamReviewCount ?? game.popularityScore ?? 0) + 1
  );
  const quality = game.steamPositiveRatio ?? game.rating ?? 0;
  return quality * 10 + popularity;
}

function overlapScore(game: GhostBoxGame, selectedGames: GhostBoxGame[]) {
  const traits = gameTraits(game);
  if (!traits.size) return 0;

  return selectedGames.reduce((score, selectedGame) => {
    const selectedTraits = gameTraits(selectedGame);
    let overlap = 0;
    traits.forEach((trait) => {
      if (selectedTraits.has(trait)) overlap += 1;
    });
    return score + overlap;
  }, 0);
}

// The cycle is one local day: recommendations roll over at midnight.
export function getWishlistCycleStart(date = new Date()) {
  return atLocalStartOfDay(date);
}

export function getWishlistCycleExpiry(cycleStart: Date) {
  const next = atLocalStartOfDay(cycleStart);
  next.setDate(next.getDate() + 1);
  // Re-normalize so DST transitions still land on the next local midnight.
  next.setHours(0, 0, 0, 0);
  return next;
}

export function getWishlistCycleIndex(cycleStart: Date) {
  const start = getWishlistCycleStart(cycleStart);
  return Math.floor(
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) /
      (24 * 60 * 60 * 1000)
  );
}

export function isStoredWishlistCycleFresh(
  stored: StoredSteamWishlistCycle | null,
  steamId: string | undefined,
  expectedCount: number,
  now = Date.now()
): stored is StoredSteamWishlistCycle {
  return Boolean(
    stored &&
      steamId &&
      stored.steamId === steamId &&
      stored.algorithmVersion === wishlistCycleAlgorithmVersion &&
      stored.gameIds.length === expectedCount &&
      Number.isFinite(Date.parse(stored.cycleStart)) &&
      Date.parse(stored.expiresAt) > now
  );
}

function rankWishlistCandidates(
  candidates: GhostBoxGame[],
  {
    sourceTraits = [],
    userTraits = [],
    excludedAppIds = new Set<string>(),
  }: RankWishlistCandidatesOptions = {}
) {
  const normalizedSourceTraits = traitSet(sourceTraits);
  const normalizedUserTraits = traitSet(userTraits);

  return candidates
    .flatMap((candidate, index) => {
      const appId = gameAppId(candidate);
      if (
        !appId ||
        excludedAppIds.has(appId) ||
        isSteamTitlePlaceholder(candidate.title, candidate.appId)
      ) {
        return [];
      }

      const traits = gameTraits(candidate);
      let sourceMatchScore = 0;
      let userMatchScore = 0;
      traits.forEach((trait) => {
        if (normalizedSourceTraits.has(trait)) sourceMatchScore += 1;
        if (normalizedUserTraits.has(trait)) userMatchScore += 1;
      });

      return [{
        candidate,
        score: sourceMatchScore * 1000 + userMatchScore * 15 + qualityScore(candidate),
        sourceMatchScore,
        index,
      }];
    })
    .sort(
      (left, right) =>
        right.sourceMatchScore - left.sourceMatchScore ||
        right.score - left.score ||
        left.index - right.index
    )
    .map(({ candidate }) => candidate);
}

export function pickWishlistCycleGames(
  candidates: GhostBoxGame[],
  {
    gameCount,
    sourceTraits = [],
    userTraits = [],
    excludedAppIds = new Set<string>(),
  }: PickWishlistCycleGamesOptions
) {
  const selectedGames: GhostBoxGame[] = [];
  const selectedIds = new Set(excludedAppIds);
  let remaining = rankWishlistCandidates(candidates, { sourceTraits, userTraits, excludedAppIds });

  while (selectedGames.length < gameCount && remaining.length > 0) {
    const ranked = remaining
      .map((candidate, index) => ({
        candidate,
        index,
        overlap: overlapScore(candidate, selectedGames),
        rankedIndex: index,
      }))
      .sort(
        (left, right) =>
          left.overlap - right.overlap || left.rankedIndex - right.rankedIndex
      );
    const next = ranked[0];
    if (!next) break;

    selectedGames.push(next.candidate);
    const selectedId = gameAppId(next.candidate);
    selectedIds.add(selectedId);
    remaining = remaining.filter(
      (candidate, index) => index !== next.index && !selectedIds.has(gameAppId(candidate))
    );
  }

  return selectedGames;
}

export function createWishlistCycle({
  steamId,
  selectedGames,
  storedCycle,
  cycleStart,
  historyLimit = homeWishlistCycleHistoryLimit,
}: CreateWishlistCycleOptions): StoredSteamWishlistCycle {
  const normalizedStart = atLocalStartOfDay(cycleStart);
  const cycleStartIso = normalizedStart.toISOString();
  const gameIds = [...new Set(selectedGames.map(gameAppId).filter(Boolean))];
  const previousHistory = storedCycle?.cycleStart === cycleStartIso
    ? storedCycle.history.slice(1)
    : storedCycle?.history ?? [];
  const history = [
    gameIds,
    ...previousHistory,
  ].slice(0, Math.max(0, historyLimit));

  return {
    steamId,
    algorithmVersion: wishlistCycleAlgorithmVersion,
    cycleStart: cycleStartIso,
    expiresAt: getWishlistCycleExpiry(normalizedStart).toISOString(),
    gameIds,
    history,
  };
}
