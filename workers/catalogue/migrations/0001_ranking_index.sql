-- The expression and tie-breakers exactly match POPULAR_ORDER in src/catalogue.ts.
CREATE INDEX IF NOT EXISTS idx_games_popular_ranking
ON games (
  max(
    steam_positive_ratio * steam_positive_ratio * (CAST(steam_review_count AS REAL) / (steam_review_count + 5000)),
    (CAST(recommendations AS REAL) / (recommendations + 2000)) * 0.82,
    (CAST(metacritic_score AS REAL) / 100) * (CAST(metacritic_score AS REAL) / 100) * 0.75
  ) DESC,
  steam_review_count DESC,
  recommendations DESC,
  metacritic_score DESC,
  popularity_score DESC,
  popularity_rank ASC,
  name COLLATE NOCASE ASC,
  CAST(app_id AS INTEGER) ASC
);

CREATE INDEX IF NOT EXISTS idx_games_recent
ON games (updated_at DESC, CAST(app_id AS INTEGER) DESC);
