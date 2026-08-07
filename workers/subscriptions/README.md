# GhostBox Subscriptions Worker

Cloudflare Worker responsible for GhostBox Premium subscriptions. Billing is Stripe-only; there is no SumUp fallback.

## Endpoints

- `GET /health`
- `POST /auth/register` — `{ email, username, password, displayName? }`
- `POST /auth/login` — `{ identifier, password }` (identifier = email or username)
- `POST /auth/password-reset` — `{ identifier }`, always 200
- `POST /auth/resend-verification` — Bearer, `{ firebaseRefreshToken }`
- `POST /auth/change-password` — Bearer, `{ currentPassword, newPassword }`
- `GET /auth/me` — Bearer
- `POST /auth/claim-steam` — Bearer, `{ callbackUrl, displayName?, avatarUrl? }`, absorbs a legacy Steam-only account's data into the caller's account
- `DELETE /auth/connections/steam` / `DELETE /auth/connections/discord` — Bearer
- `POST /subscription/checkouts` — Bearer, `{ planId }`
- `POST /subscription/portal` — Bearer, `{ flow?: "manage" | "payment_method_update" }`
- `GET /subscription/status` — Bearer
- `POST /subscription/refresh?checkoutId=...`
- `POST /discord/link` — Bearer, returns `{ url }` to open in the system browser
- `GET /discord/callback`
- `GET /discord/link-status` — Bearer
- `POST /discord/sync-premium`
- `POST /stripe/webhook` — Stripe webhook endpoint
- `GET /cloud-saves?appId=...` — Bearer + premium
- `POST /cloud-saves` — Bearer + premium
- `GET /cloud-saves/:id/download` — Bearer + premium

Identity is the Firebase uid (`user_id`), issued by `/auth/register` or `/auth/login` and wrapped in the same 7-day HMAC session token used everywhere else (`Authorization: Bearer <token>`). Steam and Discord are optional connections (`user_connections` table), linked after login — Steam via `/auth/claim-steam`, Discord via `/discord/link`. `/auth/claim-steam` migrates a pre-existing Steam-only account's subscription, cloud saves, profile and Discord link onto the new account the first time that Steam ID is connected.

## Secrets

```powershell
npx wrangler secret put STRIPE_SECRET_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_CLIENT_ID --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_OAUTH_STATE_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --config workers/subscriptions/wrangler.toml
npx wrangler secret put DISCORD_SYNC_TOKEN --config workers/subscriptions/wrangler.toml
npx wrangler secret put CLOUD_SESSION_SECRET --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUPABASE_URL --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put FIREBASE_API_KEY --config workers/subscriptions/wrangler.toml
```

`FIREBASE_API_KEY` is the Web API key of the Firebase project (Project settings → General → Web API Key). The worker talks to Firebase Auth over its public REST API only (Identity Toolkit + Secure Token) — no service account/Admin SDK key is needed. Email templates (verification, password reset) are configured in the Firebase console under Authentication → Templates.

Optional variables/secrets:

- `CHECKOUT_RETURN_URL`
- `STRIPE_PORTAL_RETURN_URL` — URL after leaving the Stripe Customer Portal (defaults to checkout return / worker return page)
- `DISCORD_REDIRECT_URI` defaults to `/discord/callback` on the worker origin. Configure the same URL in the Discord OAuth2 app.
- `DISCORD_GUILD_ID` is the server ID where the Premium role exists.
- `DISCORD_PREMIUM_ROLE_ID` is the role ID assigned to active subscribers.
- `ALLOWED_ORIGIN`
- `CLOUD_SAVE_BUCKET` defaults to `cloud-saves` and must exist as a private Supabase Storage bucket.

The bot must be in the Discord server and have `Manage Roles`. Its highest role must be above the Premium role.

Stripe Customer Portal must be configured in the Stripe dashboard before `/subscription/portal` can open subscription management or payment method update flows.

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
