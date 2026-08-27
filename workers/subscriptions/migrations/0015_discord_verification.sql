-- Discord as a login and verification channel.
--
-- verified_via records HOW an account proved itself, which email_verified
-- alone cannot express: a Discord DM PIN proves a real person holds the
-- Discord account, but says nothing about the email address on file. Only
-- an email that Discord itself reports as verified AND that matches
-- accounts.email may set email_verified = 1.
ALTER TABLE accounts ADD COLUMN verified_via TEXT;

UPDATE accounts SET verified_via = 'email' WHERE email_verified = 1;

CREATE TABLE IF NOT EXISTS discord_verification_codes (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

-- Single-use hand-off between the OAuth callback (browser) and the desktop
-- app's loopback listener. user_id is NULL while the Discord account has no
-- GhostBox account yet — the app then collects a password and finishes the
-- signup against the same ticket.
CREATE TABLE IF NOT EXISTS discord_login_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id TEXT,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  discord_global_name TEXT,
  discord_email TEXT,
  discord_email_verified INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_login_tickets_expires
  ON discord_login_tickets(expires_at);
