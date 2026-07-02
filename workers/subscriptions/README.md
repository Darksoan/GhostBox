# GhostBox Subscriptions Worker

Cloudflare Worker responsible for GhostBox Premium subscriptions.

## Endpoints

- `GET /health`
- `POST /subscription/checkouts`
- `GET /subscription/status?steamId=...`
- `POST /subscription/refresh?checkoutId=...`
- `GET /discord/link?steamId=...`
- `GET /discord/callback`
- `GET /discord/link-status?steamId=...`
- `POST /discord/sync-premium`
- `POST /sumup/webhook`
- `POST /auth/steam`
- `GET /cloud-saves?appId=...`
- `POST /cloud-saves`
- `GET /cloud-saves/:id/download`

## Secrets

```powershell
npx wrangler secret put SUMUP_API_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUMUP_MERCHANT_CODE --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_CLIENT_ID --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_OAUTH_STATE_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_SYNC_TOKEN --config workers/subscriptions/wrangler.toml
npx wrangler secret put CLOUD_SESSION_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUPABASE_URL --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/subscriptions/wrangler.toml
```

Optional variables/secrets:

- `SUMUP_BASE_URL`
- `CHECKOUT_RETURN_URL`
- `DISCORD_REDIRECT_URI` defaults to `/discord/callback` on the worker origin. Configure the same URL in the Discord OAuth2 app.
- `DISCORD_GUILD_ID` is the server ID where the Premium role exists.
- `DISCORD_PREMIUM_ROLE_ID` is the role ID assigned to active subscribers.
- `ALLOWED_ORIGIN`
- `CLOUD_SAVE_BUCKET` defaults to `cloud-saves` and must exist as a private Supabase Storage bucket.

The bot must be in the Discord server and have `Manage Roles`. Its highest role must be above the Premium role.

## D1

Create the database, update `database_id` in `wrangler.toml`, and apply migrations:

```powershell
npx wrangler d1 create ghostbox-subscriptions
npx wrangler d1 migrations apply ghostbox-subscriptions --remote --config workers/subscriptions/wrangler.toml
```

## Deploy

```powershell
npx wrangler deploy --config workers/subscriptions/wrangler.toml
```
