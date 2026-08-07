-- Adds the Firebase-uid identity column to every table that used to be
-- keyed only by steam_id. steam_id columns are left in place (now optional)
-- so /auth/claim-steam can backfill user_id into rows created before this
-- migration. Primary keys are NOT swapped: SQLite allows NULL and repeated
-- NULL in a non-INTEGER PRIMARY KEY, so legacy (unclaimed) rows keep working
-- unmodified, and going-forward upserts target the new UNIQUE(user_id)
-- indexes instead of the old PK.

ALTER TABLE subscriptions ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

ALTER TABLE discord_links ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_links_user_id ON discord_links(user_id);

ALTER TABLE user_profile_cloud ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_cloud_user_id ON user_profile_cloud(user_id);

ALTER TABLE user_collections_cloud ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collections_cloud_user_id ON user_collections_cloud(user_id, id);
CREATE INDEX IF NOT EXISTS idx_user_collections_cloud_user_sort ON user_collections_cloud(user_id, sort_order);

ALTER TABLE user_collection_games_cloud ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collection_games_cloud_user_id
  ON user_collection_games_cloud(user_id, collection_id, game_id);

ALTER TABLE user_favorite_games_cloud ADD COLUMN user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorite_games_cloud_user_id
  ON user_favorite_games_cloud(user_id, game_id);
