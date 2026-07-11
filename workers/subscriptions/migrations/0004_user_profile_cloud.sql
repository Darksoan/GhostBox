CREATE TABLE IF NOT EXISTS user_profile_cloud (
  steam_id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  banner_position_x INTEGER NOT NULL DEFAULT 50,
  banner_position_y INTEGER NOT NULL DEFAULT 50,
  banner_position_scale INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_collections_cloud (
  id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (steam_id, id)
);

CREATE TABLE IF NOT EXISTS user_collection_games_cloud (
  steam_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (steam_id, collection_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_collections_cloud_steam
  ON user_collections_cloud(steam_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_user_collection_games_cloud_collection
  ON user_collection_games_cloud(steam_id, collection_id, sort_order);
