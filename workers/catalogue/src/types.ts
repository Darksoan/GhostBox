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
  filters: Record<FilterName, string[]>;
}

export interface CatalogueMeta {
  total: number;
  updatedAt: string;
}
