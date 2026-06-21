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

Build the desktop app with the proxy URL:

```powershell
$env:GHOSTBOX_STEAM_STATS_API_URL="https://ghostbox-steam-stats.hella.workers.dev"
npm run tauri build
```
