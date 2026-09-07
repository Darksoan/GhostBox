-- Populated by scripts/backfill-search-index.mjs before searchIndexVersion=1.
-- One FTS row per game keeps the migration and ongoing writes bounded.
CREATE VIRTUAL TABLE IF NOT EXISTS games_search USING fts5(
  app_id UNINDEXED,
  text,
  genres,
  tags,
  developers,
  publishers,
  years,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
