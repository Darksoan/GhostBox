-- Provider-only auth: Discord and Steam create accounts directly.
--
-- Email/password signup, login, change and recovery were removed. Every
-- account must hold at least one provider connection (Discord or Steam);
-- the server refuses to drop the last one. This migration:
--   1. Adds the Steam OpenID replay guard (`steam_openid_nonces`).
--   2. Makes `accounts.email` nullable so provider-created accounts do not
--      need an address on file (SQLite cannot ALTER a column's nullability,
--      so the table is rebuilt).
--   3. Removes accounts that never linked a provider. Those were reachable
--      only through email/password, which no longer exists, so they are
--      unrecoverable by design. Financial rows (payments/subscriptions) are
--      kept for legal retention; they are keyed by user_id and harmless
--      without the account row. All non-financial account data is removed.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS steam_openid_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steam_openid_nonces_expires
  ON steam_openid_nonces(expires_at);

-- Rebuild accounts with a nullable email. New provider-only accounts store
-- NULL; legacy rows keep their address for display.
CREATE TABLE IF NOT EXISTS accounts_new (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verified_via TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO accounts_new
  (user_id, email, username, display_name, email_verified, verified_via, token_version, created_at, updated_at)
SELECT user_id, email, username, display_name, email_verified, verified_via, token_version, created_at, updated_at
FROM accounts;

DROP TABLE IF EXISTS accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- Drop unrecoverable password-only accounts: no Discord, no Steam.
DELETE FROM cloud_saves WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM user_profile_cloud WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM user_collections_cloud WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM user_collection_games_cloud WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM user_favorite_games_cloud WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM discord_links WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM discord_verification_codes WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM discord_login_tickets WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM security_events WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

UPDATE subscriptions SET user_id = NULL, steam_id = NULL WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

UPDATE payments SET user_id = NULL, steam_id = NULL WHERE user_id IN (
  SELECT a.user_id FROM accounts a
  WHERE NOT EXISTS (SELECT 1 FROM user_connections c WHERE c.user_id = a.user_id)
);

DELETE FROM accounts WHERE NOT EXISTS (
  SELECT 1 FROM user_connections c WHERE c.user_id = accounts.user_id
);
