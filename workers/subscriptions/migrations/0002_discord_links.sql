CREATE TABLE IF NOT EXISTS discord_links (
  steam_id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  discord_global_name TEXT,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (steam_id) REFERENCES users(steam_id)
);

CREATE INDEX IF NOT EXISTS idx_discord_links_discord_user_id ON discord_links(discord_user_id);
