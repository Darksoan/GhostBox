# GhostBox Steam Stats Proxy

Secure proxy for Steam profile stats. The desktop app calls this worker instead of shipping a Steam Web API key.

## Secrets

Set the Steam key as a Worker secret:

```powershell
wrangler secret put STEAM_WEB_API_KEY
```

## Deploy

Create a KV namespace, update `wrangler.toml`, then deploy:

```powershell
wrangler kv namespace create STATS_CACHE
wrangler deploy
```

The worker uses KV for long-lived account and schema data. A Durable Object
(`SCAN_COORDINATOR`) serializes achievement scans per Steam ID, preventing
duplicate upstream scans when requests arrive at different Cloudflare POPs.

The account cache is retained for 180 days, while freshness is decided by the
logical TTLs in the worker. Existing `steam-stats:v8:*` entries are migrated
lazily to the `steam:v9:*` keys to avoid a cold-cache request spike.

Steam 429, authentication, transport, and server failures feed endpoint-level
circuit breakers coordinated by Durable Objects. Transient failures preserve
stale account data and expose `nextPollAfter` so clients retry without polling
continuously.

Achievement scans continue autonomously via Durable Object alarms, so clients
only need occasional UI polls. Short-lived Cache API responses reduce KV reads
for hot account-stats, owned-games, player-level, wishlist, and recommended-tags
routes.

## Routes

| Route | Upstream | Cache |
|---|---|---|
| `GET /steam/account-stats?steamId=` | GetOwnedGames + achievement scan | KV 180d / edge 30s |
| `GET /steam/owned-games?steamId=` | GetOwnedGames | shared account KV |
| `GET /steam/player-level?steamId=` | GetSteamLevel | KV 24h / fresh 6h |
| `GET /steam/wishlist?steamId=` | GetWishlist + store titles | KV 6h / fresh 30m |
| `GET /steam/recommended-tags?steamId=` | GetRecommendedTagsForUser | KV 24h / fresh 12h |
| `GET /steam/game-reviews?appId=&language=&reviewType=` | Store appreviews + histogram | KV 6h / fresh 20m |
| `GET /steam/game-schema?appId=&language=` | GetSchemaForGame | KV 365d global |
| `GET /steam/similar?appId=` | Store morelike HTML | KV 30d / fresh 14d |
| `GET /steam/player-summary?steamId=` | GetPlayerSummaries | KV 24h / fresh 6h |
| `GET /steam/metrics` | Aggregate counters (Bearer token) | no-store |

Metrics track request volume, cache HIT/KV/MISS/STALE, rate limits, and Steam
429/5xx/upstream errors. Counter deltas flush to a single-writer Durable Object
every ~25 requests. Set `METRICS_TOKEN` as a Worker secret and send it as a
Bearer token when reading `/steam/metrics`.

```powershell
node --test workers/steam-stats/test/pure.test.mjs
```

## Desktop release checklist

Steam traffic from the desktop should go through this worker (or the separate
details proxy). After merging desktop changes:

1. `node --test workers/steam-stats/test/pure.test.mjs`
2. `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml`
3. Merge to `master` (or run **Release Windows Installer** workflow manually)
4. Confirm GitHub Release publishes NSIS + `.sig` (needs `TAURI_SIGNING_PRIVATE_KEY`)

Store appdetails stay on `piratebox-steam-details` / `GHOSTBOX_STEAM_DETAILS_PROXY_URL`.
The desktop client falls back to Steam's public `appdetails` JSON endpoint only
when the proxy response does not contain the description required by the UI.
Reviews use the same proxy-first strategy and fall back to the public
`appreviews` endpoint when the proxy returns an unsuccessful response.

Build the desktop app with the proxy URL:

```powershell
$env:GHOSTBOX_STEAM_STATS_API_URL="https://ghostbox-steam-stats.hella.workers.dev"
npm run tauri build
```
