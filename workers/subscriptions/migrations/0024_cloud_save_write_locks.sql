-- Serialize storage and D1 writes per account/game (storage cannot join a D1 transaction).
CREATE TABLE IF NOT EXISTS cloud_save_write_locks (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);
