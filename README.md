# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Setup

Install the JavaScript dependencies before starting the app:

```powershell
npm install
npm run tauri:dev
```

The desktop app does not require a Steam Web API key for reviews or game
descriptions. It uses the configured proxies first and automatically falls back
to Steam's public Store JSON endpoints when the proxy returns incomplete data.

The Steam Web API key must remain a secret in the `steam-stats` Worker:

```powershell
wrangler secret put STEAM_WEB_API_KEY --config workers/steam-stats/wrangler.toml
wrangler deploy --config workers/steam-stats/wrangler.toml
```

Optional proxy overrides, useful when developing against another deployment:

```powershell
$env:GHOSTBOX_STEAM_STATS_API_URL="https://ghostbox-steam-stats.hella.workers.dev"
$env:GHOSTBOX_STEAM_DETAILS_PROXY_URL="https://piratebox-steam-details.hella.workers.dev"
npm run tauri:dev
```

Do not commit a Steam Web API key or place it in a desktop `.env` file.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
