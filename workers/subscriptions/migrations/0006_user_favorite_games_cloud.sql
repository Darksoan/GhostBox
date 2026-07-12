CREATE TABLE IF NOT EXISTS user_favorite_games_cloud (
  steam_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (steam_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorite_games_cloud_steam
  ON user_favorite_games_cloud(steam_id, sort_order);
