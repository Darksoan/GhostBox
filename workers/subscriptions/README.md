# GhostBox Subscriptions Worker

Cloudflare Worker responsible for GhostBox Premium subscriptions. Billing is Stripe-only.

## Endpoints

- `GET /health`
- `GET /auth/discord/start?port=...` — no auth; returns `{ url }` for the desktop app's Discord sign-in, with the app's loopback port carried in the signed state
- `POST /auth/discord/exchange` / `POST /auth/oauth/exchange` — no auth, `{ ticket }`; resolves the current Discord owner or creates a provider-only account and returns a session
- `POST /auth/steam/login` — no auth, `{ callbackUrl, displayName?, avatarUrl? }`; resolves the Steam owner or creates a provider-only account and returns a session
- `GET /auth/me` — Bearer
- `POST /auth/claim-steam` — Bearer, `{ callbackUrl, displayName?, avatarUrl? }`, links Steam to the caller's account, consumes the assertion nonce, and backfills legacy Steam-keyed rows
- `DELETE /auth/connections/steam` / `DELETE /auth/connections/discord` — Bearer; conditionally refuses to remove the last provider (`last_connection`), rotates the session, and cleans provider-derived rows
- `POST /subscription/checkouts` — Bearer, `{ planId }`
- `POST /subscription/portal` — Bearer, `{ flow?: "manage" | "payment_method_update" }`
- `GET /subscription/status` — Bearer
- `POST /subscription/refresh?checkoutId=...` — Bearer; only the account that owns the checkout can read it (anything else answers 404). Fallback for a delayed webhook.
- `POST /discord/link` — Bearer, returns `{ url }` to open in the system browser
- `GET /discord/callback`
- `GET /discord/link-status` — Bearer
- `POST /discord/sync-premium`
- `POST /stripe/webhook` — Stripe webhook endpoint
- `GET /cloud-saves?appId=...` — Bearer + premium
- `POST /cloud-saves` — Bearer + premium
- `GET /cloud-saves/:id/download` — Bearer + premium

Retired password-era routes (`/auth/register`, `/auth/login`, `/auth/change-password`, `/auth/recover/*`, `/auth/discord/send-code`, `/auth/discord/confirm-code`) answer `410 password_auth_removed` so old app builds fail with a clear message.

Identity is an internal random id (`user_id`), wrapped in a 7-day HMAC session token (`Authorization: Bearer <token>`). There is no password anywhere: no Firebase, no email delivery at all.

## Signing in

**Provider accounts ARE the login.** Discord and Steam both sign in and sign up directly, and any linked one is a complete login:

| Route | Provider |
|---|---|
| `GET /auth/oauth/:provider/start?port=&nonce=` → `GET /oauth/callback` → `POST /auth/oauth/exchange` | `discord` |
| `POST /auth/steam/login` | Steam |

Discord only redirects to a pre-registered URI, so the browser lands on `/oauth/callback` here and the worker bounces a **single-use ticket** to the desktop app's loopback port. The ticket, not a session token, is what travels through the browser. The redirect echoes back the `nonce` the app generated: without it, any local process could reach the loopback port first and hand the app a ticket for its own account. Tickets are consumed atomically (`UPDATE ... RETURNING`), so concurrent exchanges yield exactly one winner.

Steam accepts an arbitrary `return_to`, so the app takes the OpenID callback directly and posts it here for validation against `steamcommunity.com`. Validation checks `op_endpoint`, matching `claimed_id`/`identity`, a loopback `return_to`, a fresh `response_nonce`, and `check_authentication`. Every successful login or claim consumes the nonce from `steam_openid_nonces`, so a captured assertion cannot be replayed.

A second provider is linked from Settings while signed in (`/auth/oauth/:provider/link`, `/auth/claim-steam`). A valid session is required; there is no separate recent-session credential in provider-only auth. Unlinking bumps `token_version`, signing every other device out while returning a replacement token to the caller.

One provider identity belongs to exactly one GhostBox account. Linking a provider that is attached elsewhere refuses instead of stealing it; contact support if ownership needs to be resolved.

`/auth/claim-steam` migrates a pre-existing Steam-only account's subscription, cloud saves, profile and Discord link onto the new account the first time that Steam ID is connected.

There are no backup codes: **losing every linked provider means losing the account.** Linking is mandatory, so `DELETE /auth/connections/:provider` refuses to remove the last one outright — no client flag can talk past it.

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
```

Firebase is gone: `FIREBASE_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_KEY` are no longer read. Remove them from the deployment after confirming no old worker version is still running.

`CLOUD_SESSION_SECRET` is **required** and has no fallback. It used to fall back to `DISCORD_OAUTH_STATE_SECRET` / `DISCORD_CLIENT_SECRET`, which made the key that forges any user's session the same one handed to Discord. It is also the panic button: **rotating it signs every user out at once**, on every device, immediately.

For signing out one account rather than all of them, bump `accounts.token_version` — every session token carries the version it was minted under, and `requireSession` rejects anything older or any token whose account no longer exists (migration `0016`). Unlinking a provider does this automatically.

Optional variables/secrets:

- `CHECKOUT_RETURN_URL`
- `STRIPE_PORTAL_RETURN_URL` — URL after leaving the Stripe Customer Portal (defaults to checkout return / worker return page)
- `DISCORD_REDIRECT_URI` defaults to `/discord/callback` on the worker origin. Configure the same URL in the Discord OAuth2 app.
- `DISCORD_GUILD_ID` is the server ID where the Premium role exists.
- `DISCORD_PREMIUM_ROLE_ID` is the role ID assigned to active subscribers.
- `ALLOWED_ORIGIN`
- `CLOUD_SAVE_BUCKET` defaults to `cloud-saves` and must exist as a private Supabase Storage bucket.
- `STRIPE_API_VERSION` overrides the version pinned in `src/stripe.ts`. Every Stripe call sends it explicitly, so the account's default version in the dashboard cannot reshape payloads underneath the worker. Bump it deliberately, and only after checking `stripeSubscriptionPeriod` / `stripeInvoiceSubscriptionId` against the new shape — `2025-03-31.basil` moved `current_period_*` onto subscription items and dropped `invoice.subscription` (both readers already handle either shape, and `test/stripe-shape.test.ts` covers them).

The bot must be in the Discord server and have `Manage Roles`. Its highest role must be above the Premium role.

Both Discord flows request the `identify email` scope in the authorize URL the worker builds. Provider-created account rows deliberately store `email = NULL`; provider email is retained only in connection metadata and is never used for sign-in or recovery.

Stripe Customer Portal must be configured in the Stripe dashboard before `/subscription/portal` can open subscription management or payment method update flows.

## D1

Create the database, update `database_id` in `wrangler.toml`, and apply migrations:

```powershell
npx wrangler d1 create ghostbox-subscriptions
npx wrangler d1 migrations apply ghostbox-subscriptions --remote --config workers/subscriptions/wrangler.toml
```

Migration `0021` removes password-only accounts (no Discord, no Steam linked): they were reachable solely through the deleted email/password flow. Financial rows are kept for legal retention.

## Webhook delivery

`POST /stripe/webhook` is the only path that grants Premium. Its contract:

- The event id is recorded before processing, but `processed_at` is written only after the handler succeeds. A redelivery of an event that was recorded and never processed is reprocessed, not skipped.
- A handler failure answers **500** so Stripe redelivers. Never make it answer 200 on failure — that is how a paid checkout gets lost permanently.
- Discord role sync is deliberately non-fatal; the 30-minute cron reconciles it.
- Out-of-order events are dropped by the `stripe_event_created` watermark on `subscriptions`.

To exercise it locally:

```powershell
npx wrangler dev --config workers/subscriptions/wrangler.toml
stripe listen --forward-to localhost:8787/stripe/webhook
stripe trigger checkout.session.completed
```

## Tests

```powershell
npm --prefix workers/subscriptions test
```

## Deploy

```powershell
npx wrangler deploy --config workers/subscriptions/wrangler.toml
```
