export interface Env {
  DB: D1Database;
  /** Daily SteamSpy snapshots. The D1 columns remain the migration fallback. */
  STEAMSPY_SNAPSHOT?: KVNamespace;
}

export const FILTER_NAMES = [
  "genres",
  "tags",
  "developers",
  "publishers",
  "years",
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];
export type Sort = "popular" | "recentlyAdded" | "playingNow";
export type Facets = Record<FilterName, string[]>;

export interface SearchRequest {
  q: string;
  limit: number;
  offset: number;
  sort: Sort;
  includeFacets: boolean;
  facetsOnly: boolean;
  /** Rotation seed. 0 disables rotation and keeps the pure ranking order. */
  seed: number;
  filters: Record<FilterName, string[]>;
}

export interface CatalogueMeta {
  total: number;
  updatedAt: string;
  /** Set only after the resumable FTS backfill has verified every game. */
  searchIndexVersion: string;
  /**
   * Quando o cron da SteamSpy gravou amostras pela última vez. Separado de
   * `updatedAt` de propósito: o CCU muda de hora em hora e não deve invalidar
   * o cache do catálogo inteiro, só o das rotas que servem o número.
   */
  steamspySampledAt: string;
}
