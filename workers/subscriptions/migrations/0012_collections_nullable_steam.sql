-- 0011 relaxed steam_id NOT NULL on payments and cloud_saves but missed the
-- three profile/collection tables, so PUT /cloud-profile still throws
-- "NOT NULL constraint failed" for any account without a Steam connection as
-- soon as the snapshot carries one collection or one favorite. SQLite can't
-- ALTER a column's NOT NULL, so rebuild all three with steam_id optional.
--
-- The composite PRIMARY KEYs are kept: SQLite allows NULL in a non-INTEGER
-- primary key, so legacy Steam-keyed rows stay deduplicated while the new
-- user_id UNIQUE indexes govern account-keyed rows.

CREATE TABLE user_collections_cloud_new (
  id TEXT NOT NULL,
  steam_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (steam_id, id)
);

INSERT INTO user_collections_cloud_new (id, steam_id, user_id, name, sort_order, updated_at)
SELECT id, steam_id, user_id, name, sort_order, updated_at FROM user_collections_cloud;

DROP TABLE user_collections_cloud;
ALTER TABLE user_collections_cloud_new RENAME TO user_collections_cloud;

CREATE INDEX IF NOT EXISTS idx_user_collections_cloud_steam
  ON user_collections_cloud(steam_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collections_cloud_user_id
  ON user_collections_cloud(user_id, id);
CREATE INDEX IF NOT EXISTS idx_user_collections_cloud_user_sort
  ON user_collections_cloud(user_id, sort_order);

CREATE TABLE user_collection_games_cloud_new (
  steam_id TEXT,
  user_id TEXT,
  collection_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (steam_id, collection_id, game_id)
);

INSERT INTO user_collection_games_cloud_new (steam_id, user_id, collection_id, game_id, sort_order)
SELECT steam_id, user_id, collection_id, game_id, sort_order FROM user_collection_games_cloud;

DROP TABLE user_collection_games_cloud;
ALTER TABLE user_collection_games_cloud_new RENAME TO user_collection_games_cloud;

CREATE INDEX IF NOT EXISTS idx_user_collection_games_cloud_collection
  ON user_collection_games_cloud(steam_id, collection_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collection_games_cloud_user_id
  ON user_collection_games_cloud(user_id, collection_id, game_id);

CREATE TABLE user_favorite_games_cloud_new (
  steam_id TEXT,
  user_id TEXT,
  game_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (steam_id, game_id)
);

INSERT INTO user_favorite_games_cloud_new (steam_id, user_id, game_id, sort_order)
SELECT steam_id, user_id, game_id, sort_order FROM user_favorite_games_cloud;

DROP TABLE user_favorite_games_cloud;
ALTER TABLE user_favorite_games_cloud_new RENAME TO user_favorite_games_cloud;

CREATE INDEX IF NOT EXISTS idx_user_favorite_games_cloud_steam
  ON user_favorite_games_cloud(steam_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorite_games_cloud_user_id
  ON user_favorite_games_cloud(user_id, game_id);
