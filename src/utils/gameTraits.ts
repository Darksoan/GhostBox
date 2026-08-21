import type { GhostBoxGame } from "../data";

/**
 * Canonical trait vocabulary shared by every surface that groups games by
 * genre/tag. The same alias table used to live copy-pasted in three places
 * (`normalizeHomeCategory` na HomePage, `normalizeCalendarTrait` no calendário
 * pessoal e `normalizeWishlistTrait` no ciclo da wishlist), so a rename in one
 * silently diverged from the others.
 */
const traitAliases: Record<string, string> = {
  acao: "Action",
  ação: "Action",
  action: "Action",
  aventura: "Adventure",
  adventure: "Adventure",
  historia: "Story Rich",
  história: "Story Rich",
  story: "Story Rich",
  "story rich": "Story Rich",
  terror: "Horror",
  horror: "Horror",
  corrida: "Racing",
  racing: "Racing",
  esportes: "Sports",
  sports: "Sports",
  estrategia: "Strategy",
  estratégia: "Strategy",
  strategy: "Strategy",
  exploracao: "Exploration",
  exploração: "Exploration",
  exploration: "Exploration",
};

/** Display form: "ação" -> "Action". Unknown traits keep their original casing. */
export function normalizeGameTrait(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return traitAliases[normalized.toLowerCase()] ?? normalized;
}

/** Comparison form: case-insensitive key for set membership / overlap counting. */
export function normalizeGameTraitKey(value: string) {
  return normalizeGameTrait(value).toLowerCase();
}

/** Deduped display-form traits of a game, genres first (they read better as pills). */
export function getGameTraits(game: GhostBoxGame) {
  return [
    ...new Set(
      [...game.genres, ...game.tags].map(normalizeGameTrait).filter(Boolean)
    ),
  ];
}

/** Deduped comparison-form traits, for overlap scoring. */
export function getGameTraitSet(game: GhostBoxGame) {
  return new Set(
    [...game.genres, ...game.tags].map(normalizeGameTraitKey).filter(Boolean)
  );
}

/**
 * Quality-weighted popularity used to rank a game inside a category rail.
 * Review ratio dominates; the log keeps a 2M-review blockbuster from burying
 * an excellent title with 20k reviews.
 */
export function gameCategoryScore(game: GhostBoxGame) {
  const reviewScore = game.steamPositiveRatio ?? game.rating ?? 0;
  const popularityScore = game.recommendations ?? game.steamReviewCount ?? 0;
  return reviewScore * 100 + Math.log10(popularityScore + 1);
}

/** Numeric Steam app id of a game, or "" when it isn't a Steam entry. */
export function gameTraitAppId(game: GhostBoxGame) {
  const appId = (game.appId || game.id.replace(/^steam-/, "")).trim();
  return /^\d+$/.test(appId) ? appId : "";
}
