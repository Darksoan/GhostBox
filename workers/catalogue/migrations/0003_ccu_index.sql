-- Powers sort=playingNow ("Jogando agora"). Without this, ordering ~108k rows
-- by steamspy_ccu is a full table scan + sort on every cache miss.
CREATE INDEX IF NOT EXISTS idx_games_ccu
ON games (steamspy_ccu DESC, CAST(app_id AS INTEGER) ASC);
