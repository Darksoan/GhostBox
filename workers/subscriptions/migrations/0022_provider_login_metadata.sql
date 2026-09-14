-- Provider-only login creates the account during the first exchange. Keep the
-- Discord avatar in the short-lived hand-off so the initial connection has the
-- same profile data as subsequent logins.
ALTER TABLE discord_login_tickets ADD COLUMN discord_avatar_url TEXT;
