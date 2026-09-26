-- Replacement database schema. Do not run against piratebox-games (v1).
-- Screenshot URLs are packed by scripts/migrate-v2.mjs, then restored by toGame.
CREATE TABLE games (
  app_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  release_date TEXT,
  release_year TEXT NOT NULL,
  release_sort INTEGER NOT NULL,
  header_image TEXT,
  developers_json TEXT NOT NULL,
  publishers_json TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  genres_json TEXT NOT NULL,
  screenshots_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  popularity_score REAL NOT NULL DEFAULT 0,
  popularity_rank INTEGER,
  steam_review_count INTEGER NOT NULL DEFAULT 0,
  steam_positive_ratio REAL NOT NULL DEFAULT 0,
  metacritic_score INTEGER NOT NULL DEFAULT 0,
  recommendations INTEGER NOT NULL DEFAULT 0,
  steamspy_ccu INTEGER NOT NULL DEFAULT 0,
  steamspy_owners_max INTEGER NOT NULL DEFAULT 0,
  app_type TEXT NOT NULL DEFAULT 'unclassified',
  ranking_score REAL GENERATED ALWAYS AS (
    (0.72 * ((steam_positive_ratio * steam_review_count + 0.70 * 1500) / (steam_review_count + 1500))
     + 0.20 * (CAST(steam_review_count AS REAL) / (steam_review_count + 25000.0))
     + 0.08 * (CAST(metacritic_score AS REAL) / 100.0))
    * (0.25 + 0.75 * (CAST(steam_review_count + recommendations AS REAL) / (steam_review_count + recommendations + 500.0)))
  ) VIRTUAL,
  ranking_tier INTEGER GENERATED ALWAYS AS (CAST(ranking_score * 50 AS INTEGER)) VIRTUAL
);
CREATE INDEX idx_games_ranking ON games(ranking_tier DESC, CAST(app_id AS INTEGER) ASC);
CREATE INDEX idx_games_recent ON games(updated_at DESC, CAST(app_id AS INTEGER) DESC);
CREATE INDEX idx_games_ccu ON games(steamspy_ccu DESC, CAST(app_id AS INTEGER) ASC);
CREATE TABLE catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- No duplicate stored content; column locations retained for facet filters and bm25.
-- contentless_delete makes incremental ingest/delete possible with no shadow content table.
CREATE VIRTUAL TABLE games_search USING fts5(
  text, genres, tags, developers, publishers, years,
  tokenize='unicode61 remove_diacritics 2', prefix='2 3',
  content='', contentless_delete=1, detail=column
);
