CREATE TABLE IF NOT EXISTS cloud_saves (
  id TEXT PRIMARY KEY,
  steam_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  game_title TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  manifest_json TEXT,
  device_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (steam_id) REFERENCES users(steam_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_saves_steam_app ON cloud_saves(steam_id, app_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_saves_steam_updated ON cloud_saves(steam_id, updated_at DESC);
