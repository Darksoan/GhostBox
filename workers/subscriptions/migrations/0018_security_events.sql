-- A visible history of what happened to an account's access.
--
-- With no recovery emails there is no "your password was changed" message
-- landing in an inbox, so this is where a user finds out that someone signed
-- in through a provider or reset their password. The Discord DM covers the
-- moment it happens; this covers looking back.
--
-- ip_prefix is the /24 only, never the full address. It is enough to tell
-- "that was me at home" from "that was not me", and not enough to be a
-- location log — this table would otherwise become the most sensitive thing
-- GhostBox stores about its users.
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- login | recover | password_changed | provider_linked | provider_unlinked
  kind TEXT NOT NULL,
  provider TEXT,
  ip_prefix TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created
  ON security_events(user_id, created_at DESC);
