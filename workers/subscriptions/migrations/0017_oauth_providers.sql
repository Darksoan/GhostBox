-- Opens the Discord login hand-off up to every provider.
--
-- The shape was already right: a single-use ticket bounced to the desktop
-- app's loopback port, traded for a real session over HTTPS, so no session
-- token ever travels through the browser. Only the Discord-specific naming
-- and the missing app binding needed work.
--
-- The table keeps its name and its discord_* columns: renaming a column in D1
-- means rebuilding the table, and these rows live for 90 seconds. Read
-- `discord_user_id` as "the provider's id for this user" and `discord_email`
-- as "the address the provider reported", whatever `provider` says.
ALTER TABLE discord_login_tickets ADD COLUMN provider TEXT NOT NULL DEFAULT 'discord';

-- 'login' resolves an existing account (or offers signup); 'recover' proves
-- the account in order to set a new password and nothing else.
ALTER TABLE discord_login_tickets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';

-- Binds the ticket to the app instance that started the flow.
--
-- Without it the loopback listener accepted any ticket that reached its port,
-- so a local process could hand the app a ticket for an attacker's account and
-- the user would silently end up signed in as someone else — uploading their
-- saves there. The app now generates this nonce, the Worker echoes it in the
-- redirect, and the listener refuses callbacks that do not carry it.
ALTER TABLE discord_login_tickets ADD COLUMN app_nonce TEXT;

CREATE INDEX IF NOT EXISTS idx_discord_login_tickets_provider
  ON discord_login_tickets(provider, discord_user_id);
