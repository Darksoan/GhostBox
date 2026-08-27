# GhostBox Subscriptions Worker

Cloudflare Worker responsible for GhostBox Premium subscriptions. Billing is Stripe-only.

## Endpoints

- `GET /health`
- `POST /auth/register` — `{ email, username, password, displayName? }`
- `POST /auth/login` — `{ identifier, password }` (identifier = email or username)
- `POST /auth/password-reset` — `{ identifier }`, always 200
- `POST /auth/change-password` — Bearer, `{ currentPassword, newPassword }`
- `GET /auth/discord/start?port=...` — no auth; returns `{ url }` for the desktop app's Discord sign-in, with the app's loopback port carried in the signed state
- `POST /auth/discord/exchange` — no auth, `{ ticket }`; returns a session, or `{ error: "provider_not_linked" }` when that Discord has no GhostBox account (accounts are born from email + password only)
- `POST /auth/discord/send-code` — Bearer; DMs a 6-digit code from the bot. Two per-IP budgets: 5 delivered codes/hour (anti-spam) and 20 calls/hour (bounds a permanently blocked DM). A blocked DM does not spend the delivered budget, so fixing the privacy setting and retrying works right away.
- `POST /auth/discord/confirm-code` — Bearer, `{ code }`
- `GET /auth/me` — Bearer
- `POST /auth/claim-steam` — Bearer, `{ callbackUrl, displayName?, avatarUrl? }`, absorbs a legacy Steam-only account's data into the caller's account
- `DELETE /auth/connections/steam` / `DELETE /auth/connections/discord` — Bearer
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

Identity is the Firebase uid (`user_id`), wrapped in a 7-day HMAC session token (`Authorization: Bearer <token>`).

## Signing in

**GhostBox sends no email.** Not for verification, not for password resets. Every proof of identity comes from a linked provider, so `user_connections` is not a nice-to-have — it is the account's only way back in.

Four ways in, and any linked one is a complete login:

| Route | Provider |
|---|---|
| `POST /auth/login` | password |
| `GET /auth/oauth/:provider/start?port=&nonce=` → `GET /oauth/callback` → `POST /auth/oauth/exchange` | `discord` |
| `POST /auth/steam/login` | Steam |

Discord only redirects to a pre-registered URI, so the browser lands on `/oauth/callback` here and the worker bounces a **single-use ticket** to the desktop app's loopback port. The ticket, not a session token, is what travels through the browser. The redirect echoes back the `nonce` the app generated: without it, any local process could reach the loopback port first and hand the app a ticket for its own account.

Steam is different on two counts. It accepts an arbitrary `return_to`, so the app takes the OpenID callback directly and posts it here for validation against `steamcommunity.com`. And it **cannot create an account** — it reports a SteamID and no address — so an unlinked SteamID gets `steam_not_linked`. **Accounts are created with email + password only**: a Discord or Steam with no GhostBox account attached gets `provider_not_linked` / `steam_not_linked`, never a signup.

`/auth/claim-steam` migrates a pre-existing Steam-only account's subscription, cloud saves, profile and Discord link onto the new account the first time that Steam ID is connected.

## Recovery

`POST /auth/recover/exchange` (a validated Steam callback) → `POST /auth/recover/password`, **or** `POST /auth/recover/discord/start` → `POST /auth/recover/discord/confirm` → `POST /auth/recover/password`.

- **Steam**: the OpenID callback proves the account the same way login does.
- **Discord**: the worker's bot DMs a one-shot PIN to the Discord linked to the account the identifier names; the PIN trades for the recovery session. `/start` answers the same way whether the identifier exists, has no Discord, or the DM failed — it must not become an account oracle, and a per-account budget stops the DM from being a harassment channel. Unlinked identifiers get a uniform `invalid_code` at `/confirm`.

The exchange returns a **10-minute session scoped to `recovery`**, which `requireSession` rejects on every other route. Setting the password bumps `token_version`, so everything issued before — including the recovery token itself and whatever session prompted the recovery — stops working, and the caller gets a fresh full session back. A Discord DM goes out when one is linked; failing to send it never blocks the recovery.

There is no `/auth/password-reset` and no backup codes: **losing every linked provider means losing the account.** Linking is mandatory, so `DELETE /auth/connections/:provider` refuses to remove the last one outright — no client flag can talk past it.

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
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY --config workers/subscriptions/wrangler.toml
```

`FIREBASE_SERVICE_ACCOUNT_KEY` is the service-account JSON, pasted verbatim (Project settings → Service accounts → Generate new private key). It is used for exactly one thing: minting a Firebase custom token during account recovery, because `accounts:update` needs an idToken and the only other ways to get one are the old password or an emailed reset code — and GhostBox sends no email. Everything else still runs on the public REST API.

`CLOUD_SESSION_SECRET` is **required** and has no fallback. It used to fall back to `DISCORD_OAUTH_STATE_SECRET` / `DISCORD_CLIENT_SECRET`, which made the key that forges any user's session the same one handed to Discord. It is also the panic button: **rotating it signs every user out at once**, on every device, immediately.

For signing out one account rather than all of them, bump `accounts.token_version` — every session token carries the version it was minted under, and `requireSession` rejects anything older (migration `0016`). Changing a password does this automatically.

`FIREBASE_API_KEY` is the Web API key of the Firebase project (Project settings → General → Web API Key). The worker talks to Firebase Auth over its public REST API only (Identity Toolkit + Secure Token) — no service account/Admin SDK key is needed. Email templates (verification, password reset) are configured in the Firebase console under Authentication → Templates.

Optional variables/secrets:

- `CHECKOUT_RETURN_URL`
- `STRIPE_PORTAL_RETURN_URL` — URL after leaving the Stripe Customer Portal (defaults to checkout return / worker return page)
- `DISCORD_REDIRECT_URI` defaults to `/discord/callback` on the worker origin. Configure the same URL in the Discord OAuth2 app.
- `DISCORD_GUILD_ID` is the server ID where the Premium role exists.
- `DISCORD_PREMIUM_ROLE_ID` is the role ID assigned to active subscribers.
- `ALLOWED_ORIGIN`
- `CLOUD_SAVE_BUCKET` defaults to `cloud-saves` and must exist as a private Supabase Storage bucket.
- `STRIPE_API_VERSION` overrides the version pinned in `src/stripe.ts`. Every Stripe call sends it explicitly, so the account's default version in the dashboard cannot reshape payloads underneath the worker. Bump it deliberately, and only after checking `stripeSubscriptionPeriod` / `stripeInvoiceSubscriptionId` against the new shape — `2025-03-31.basil` moved `current_period_*` onto subscription items and dropped `invoice.subscription` (both readers already handle either shape, and `test/stripe-shape.test.ts` covers them).

The bot must be in the Discord server and have `Manage Roles`. Its highest role must be above the Premium role. It also sends the verification DMs, which Discord only allows for someone who shares a server with it and has not closed DMs from server members — both cases answer 403 and surface as `discord_dm_blocked`.

Both Discord flows request the `identify email` scope in the authorize URL the worker builds — scopes are not whitelisted in the Developer Portal, so there is nothing to configure there beyond the redirect URI. The `email` scope is what lets a link double as email verification: when Discord reports the address as verified *and* it matches `accounts.email`, the account is confirmed without any email being sent.

### Account verification

**Discord is the only way an account gets verified.** No verification emails are sent — not on signup, not on request. The endpoint that resent them is gone.

`accounts.verified_via` records how an account proved itself:

- `email` — the address on file is confirmed, because Discord vouched for that same address (`verified: true` on Discord's side and matching `accounts.email`). `email_verified = 1`. Accounts confirmed through Firebase before the switch also carry this.
- `discord` — a DM code proved a real person holds the linked Discord account, but the address on file is still unconfirmed. `email_verified` stays `0`.

Two invariants worth keeping in mind when touching this:

1. **The Firebase sync on login only raises the flag.** Firebase reports `emailVerified: false` for every account now, so writing that back would strip the badge from accounts this worker verified itself.
2. **A Discord vouches for one account at a time.** `writeDiscordLink` lets the link move between accounts, but the account that loses it also loses a `verified_via = 'discord'` proof — otherwise one Discord could stamp unlimited accounts as verified. An `email` proof survives the move: the address did not go anywhere.

Password reset still goes through email, and is the only remaining reason the address has to be real. Doing it over a Discord code would need the Firebase Admin API (service account key + RS256 JWT signed with `crypto.subtle`), since the REST API only changes a password with the current one or an emailed `oobCode`.

Stripe Customer Portal must be configured in the Stripe dashboard before `/subscription/portal` can open subscription management or payment method update flows.

## D1

Create the database, update `database_id` in `wrangler.toml`, and apply migrations:

```powershell
npx wrangler d1 create ghostbox-subscriptions
npx wrangler d1 migrations apply ghostbox-subscriptions --remote --config workers/subscriptions/wrangler.toml
```

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
