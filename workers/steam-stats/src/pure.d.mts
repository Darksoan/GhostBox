export function validSteamId(value: string | null): value is string;
export function validAppId(value: string | null): value is string;
export function parseRetryAfter(
  value: string | null,
  now?: number,
  maxSeconds?: number
): number | undefined;
export function sortWishlistItems<T extends { priority: number; dateAdded: number }>(
  items: T[]
): T[];
export function normalizeSchemaAchievements(game: unknown): Array<{
  name: string;
  title: string;
  description: string;
  icon: string;
  iconGray: string;
}>;
export function normalizeGlobalPercentages(payload: unknown): Map<string, number>;
export function mergeGlobalPercentages(
  achievements: Array<{ name: string; title: string; description: string; icon: string; iconGray: string }>,
  percentageMap: Map<string, number>
): Array<{ name: string; title: string; description: string; icon: string; iconGray: string; globalPercent?: number }>;
export function parseSimilarAppIds(html: string, sourceAppId: string): string[];
