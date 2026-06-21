# GhostBox Subscriptions Worker

Cloudflare Worker responsible for GhostBox Premium subscriptions.

## Endpoints

- `GET /health`
- `POST /subscription/checkouts`
- `GET /subscription/status?steamId=...`
- `POST /subscription/refresh?checkoutId=...`
- `POST /sumup/webhook`

## Secrets

```powershell
npx wrangler secret put SUMUP_API_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put SUMUP_MERCHANT_CODE --config workers/subscriptions/wrangler.toml
```

Optional variables/secrets:

- `SUMUP_BASE_URL`
- `CHECKOUT_RETURN_URL`
- `ALLOWED_ORIGIN`

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
