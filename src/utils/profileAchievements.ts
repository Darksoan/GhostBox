import type { GhostBoxGame } from "../data";
import {
  getAchievementTotal,
  getRicherAchievementGame,
  getUnlockedAchievementCount,
  isAchievementUnlocked,
} from "./achievementStats";

// Achievement counting lives in `achievementStats`. These aliases keep the
// profile-flavoured names their call sites already use.
export {
  isAchievementUnlocked as isProfileAchievementUnlocked,
  getUnlockedAchievementCount as getProfileUnlockedAchievementCount,
  getAchievementTotal as getProfileAchievementTotal,
};

const steamSoftwareLabelMarkers = [
  "software",
  "utilities",
  "utilitários",
  "utilitarios",
  "animation & modeling",
  "animação e modelagem",
  "animacao e modelagem",
  "video production",
  "produção de vídeo",
  "producao de video",
  "design & illustration",
  "web publishing",
  "education",
  "educação",
  "educacao",
  "accounting",
  "photo editing",
  "audio production",
  "game development",
  "desenvolvimento de jogos",
];

export function isSteamSoftwareLikeGame(game: GhostBoxGame) {
  const labels = [...(game.genres ?? []), ...(game.tags ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (labels.length === 0) return false;

  return labels.some((label) =>
    steamSoftwareLabelMarkers.some(
      (marker) => label === marker || label.includes(marker),
    ),
  );
}

/** Steam profile recognition: playtime + unlocked achievements, never software. */
export function isRecognizedSteamProfileGame(
  game: GhostBoxGame,
  playtimeInMilliseconds: number,
) {
  if (playtimeInMilliseconds <= 0) return false;
  // Require at least one unlocked achievement — total-only (e.g. 0 of 53) is not enough.
  if (getUnlockedAchievementCount(game) <= 0) return false;
  if (isSteamSoftwareLikeGame(game)) return false;
  return true;
}

/**
 * Profile flavour of the richer-game pick: history and local appcache entries often
 * arrive titled "STEAM APP 242760", so a real title from the losing side wins.
 */
export function getRicherProfileAchievementGame(
  current: GhostBoxGame | undefined,
  incoming: GhostBoxGame,
) {
  return getRicherAchievementGame(current, incoming, {
    preferNonPlaceholderTitle: true,
  });
}
