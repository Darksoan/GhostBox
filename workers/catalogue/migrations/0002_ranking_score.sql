-- Replaces the max()-based POPULAR_ORDER with a Bayesian-shrunk quality score.
-- Expression must exactly match RANKING_SCORE_SQL in src/ranking.ts.
ALTER TABLE games ADD COLUMN ranking_score REAL GENERATED ALWAYS AS (
  (0.72 * ((steam_positive_ratio * steam_review_count + 0.70 * 1500) / (steam_review_count + 1500))
   + 0.20 * (CAST(steam_review_count AS REAL) / (steam_review_count + 25000.0))
   + 0.08 * (CAST(metacritic_score AS REAL) / 100.0))
  * (0.25 + 0.75 * (CAST(steam_review_count + recommendations AS REAL) / (steam_review_count + recommendations + 500.0)))
) VIRTUAL;

-- Coarse 0.02-wide buckets: rotation shuffles within a tier, never across one.
ALTER TABLE games ADD COLUMN ranking_tier INTEGER GENERATED ALWAYS AS (
  CAST(ranking_score * 50 AS INTEGER)
) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_games_ranking
ON games (ranking_tier DESC, CAST(app_id AS INTEGER) ASC);

DROP INDEX IF EXISTS idx_games_popular_ranking;
