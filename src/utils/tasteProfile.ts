import type { GhostBoxGame } from "../data";
import type { SteamRecommendedTag } from "../lib/ghostboxApi.types";
import {
  gameCategoryScore,
  gameTraitAppId,
  getGameTraitSet,
  normalizeGameTrait,
  normalizeGameTraitKey,
} from "./gameTraits";
import { isSteamTitlePlaceholder } from "./steamTitles";

export type TasteProfile = {
  /** Comparison-form trait -> accumulated weight. */
  traits: Map<string, number>;
  /** Heaviest single signal — anchors the "Porque você jogou X" shelf. */
  seedGame: GhostBoxGame | null;
  isEmpty: boolean;
};

type BuildTasteProfileInput = {
  libraryGames?: GhostBoxGame[];
  favoriteGames?: GhostBoxGame[];
  historyGames?: GhostBoxGame[];
  steamRecommendedTags?: string[];
};

// A favourited game the user never launched still says a lot; a 400h game says
// more. The log keeps one obsession from flattening the whole profile.
const favoriteWeight = 3;
const historyWeight = 1.5;
const recommendedTagWeight = 2;

function playtimeWeight(game: GhostBoxGame) {
  return 1 + Math.log10(Math.max(0, gamePlaytimeMs(game)) / 60_000 + 1);
}

function addTraits(traits: Map<string, number>, game: GhostBoxGame, weight: number) {
  getGameTraitSet(game).forEach((trait) => {
    traits.set(trait, (traits.get(trait) ?? 0) + weight);
  });
}

/** Playtime in ms, falling back to the `hours` column when the ms field is absent. */
function gamePlaytimeMs(game: GhostBoxGame) {
  return game.playTimeInMilliseconds ?? game.hours * 3_600_000;
}

function isUsableSeedGame(game: GhostBoxGame) {
  return (
    Boolean(gameTraitAppId(game)) &&
    !isSteamTitlePlaceholder(game.title, game.appId) &&
    gamePlaytimeMs(game) > 0
  );
}

/** Most-played game, ties broken by the most recent session. */
function pickSeedGame(candidates: GhostBoxGame[]) {
  return candidates.filter(isUsableSeedGame).reduce<GhostBoxGame | null>(
    (best, game) => {
      if (!best) return game;
      const delta = gamePlaytimeMs(game) - gamePlaytimeMs(best);
      if (delta !== 0) return delta > 0 ? game : best;
      const gameLastPlayed = Date.parse(game.lastTimePlayed ?? "") || 0;
      const bestLastPlayed = Date.parse(best.lastTimePlayed ?? "") || 0;
      return gameLastPlayed > bestLastPlayed ? game : best;
    },
    null
  );
}

export function buildTasteProfile({
  libraryGames = [],
  favoriteGames = [],
  historyGames = [],
  steamRecommendedTags = [],
}: BuildTasteProfileInput): TasteProfile {
  const traits = new Map<string, number>();

  libraryGames.forEach((game) => addTraits(traits, game, playtimeWeight(game)));
  favoriteGames.forEach((game) => addTraits(traits, game, favoriteWeight));
  historyGames.forEach((game) => addTraits(traits, game, historyWeight));
  steamRecommendedTags.forEach((tag) => {
    const trait = normalizeGameTraitKey(tag);
    if (!trait) return;
    traits.set(trait, (traits.get(trait) ?? 0) + recommendedTagWeight);
  });

  // Library first: a game the user installed and played beats one that only
  // shows up in the profile history (which includes games merely opened).
  const seedGame = pickSeedGame([...libraryGames, ...historyGames]);

  return { traits, seedGame, isEmpty: traits.size === 0 };
}

/**
 * How well a candidate matches the profile. Returns `gameCategoryScore` alone
 * for an empty profile, so a brand-new user still gets a quality-ordered rail
 * instead of an arbitrary one.
 */
export function scoreGameAgainstTaste(game: GhostBoxGame, profile: TasteProfile) {
  const quality = gameCategoryScore(game);
  if (profile.isEmpty) return quality;

  let match = 0;
  getGameTraitSet(game).forEach((trait) => {
    match += profile.traits.get(trait) ?? 0;
  });

  // Taste dominates, quality breaks ties among equally-matched candidates.
  return match * 100 + quality;
}

/**
 * Steam returns recommended tags under one of three key spellings depending on
 * the endpoint version; take whichever is present and normalize it.
 */
export function steamRecommendedTagNames(tags: readonly SteamRecommendedTag[] = []) {
  return [
    ...new Set(
      tags
        .map((tag) => tag?.name ?? tag?.tag_name ?? tag?.tagName ?? "")
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        .map((name) => normalizeGameTrait(name))
    ),
  ];
}

/** Convenience for shelves that just need the profile's strongest traits. */
export function getTopTasteTraits(profile: TasteProfile, limit: number) {
  return [...profile.traits.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([trait]) => trait);
}
