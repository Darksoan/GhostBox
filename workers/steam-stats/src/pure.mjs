export function validSteamId(value) {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

export function validAppId(value) {
  return typeof value === "string" && /^[0-9]{1,12}$/.test(value);
}

export function parseRetryAfter(value, now = Date.now(), maxSeconds = 24 * 60 * 60) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(maxSeconds, Math.max(0, Math.ceil(seconds)));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(maxSeconds, Math.max(0, Math.ceil((date - now) / 1000)));
}

export function sortWishlistItems(items) {
  return [...items].sort((left, right) => {
    if (left.priority > 0 && right.priority > 0) return left.priority - right.priority;
    if (left.priority > 0) return -1;
    if (right.priority > 0) return 1;
    return right.dateAdded - left.dateAdded;
  });
}

export function normalizeSchemaAchievements(game) {
  const achievements = game?.availableGameStats?.achievements ?? [];
  return achievements
    .map((achievement) => {
      const name = (achievement.name || "").trim();
      const title = (
        achievement.displayName ||
        achievement.title ||
        achievement.name ||
        ""
      ).trim();
      if (!name || !title) return null;
      return {
        name,
        title,
        description: (achievement.description || "").trim(),
        icon: (achievement.icon || "").trim(),
        iconGray: (achievement.icongray || achievement.iconGray || "").trim(),
      };
    })
    .filter((item) => item != null);
}

export function normalizeGlobalPercentages(payload) {
  const achievements = payload?.achievementpercentages?.achievements ?? [];
  const percentages = new Map();
  for (const entry of achievements) {
    const name = (entry.name || "").trim();
    const percent = Number(entry.percent);
    if (name && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
      percentages.set(name, percent);
    }
  }
  return percentages;
}

export function mergeGlobalPercentages(achievements, percentageMap) {
  return achievements.map((achievement) => ({
    ...achievement,
    ...(percentageMap.has(achievement.name) && {
      globalPercent: percentageMap.get(achievement.name),
    }),
  }));
}

export function parseSimilarAppIds(html, sourceAppId) {
  const marker = 'data-ds-appid="';
  const appIds = [];
  const seen = new Set();
  let rest = html;
  while (appIds.length < 12) {
    const markerIndex = rest.indexOf(marker);
    if (markerIndex < 0) break;
    const valueStart = markerIndex + marker.length;
    const valueEnd = rest.indexOf('"', valueStart);
    if (valueEnd < 0) break;
    const appId = rest.slice(valueStart, valueEnd).trim();
    rest = rest.slice(valueEnd + 1);
    if (!/^\d+$/.test(appId) || appId === sourceAppId || seen.has(appId)) continue;
    seen.add(appId);
    appIds.push(appId);
  }
  return appIds;
}
