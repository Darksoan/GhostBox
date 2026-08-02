export interface Env {
  DB: D1Database;
}

export const FILTER_NAMES = [
  "genres",
  "tags",
  "developers",
  "publishers",
  "years",
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];
export type Sort = "popular" | "recentlyAdded";
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
  /** "any" matches a game with at least one selected value per filter category (used for
   * recommendation candidate pools); "all" (default) requires every selected value. */
  match: "any" | "all";
  filters: Record<FilterName, string[]>;
}

export interface CatalogueMeta {
  total: number;
  updatedAt: string;
}
