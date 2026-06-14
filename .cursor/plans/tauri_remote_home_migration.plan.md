# Tauri Remote Home Migration

## Goal

Render the Tauri app's Home page from the remote catalogue API without using a local runtime database.

## Scope

- Use the existing Cloudflare Worker `GET /home` endpoint.
- Keep the Electron app unchanged and use it only as a UI/reference source.
- Keep Catalogue secondary in this phase.
- Avoid SQLite, `games.sqlite`, or local catalogue fallbacks in the Tauri runtime.

## Remote Contract

`GET /home` returns:

```json
{
  "popular": [],
  "recentlyAdded": [],
  "total": 103406,
  "updatedAt": "2026-05-19T00:00:00.000Z",
  "facets": {},
  "source": "cloudflare-d1"
}
```

The frontend passes `VITE_GHOSTBOX_GAMES_API_URL` when defined. Rust falls back to the current Worker deployment and performs the HTTP request outside WebView CORS restrictions.

## Implementation Steps

1. Add typed Home data structures.
2. Add a remote catalogue client that invokes a Tauri command for `/home`.
3. Add a TanStack Query hook for Home.
4. Add a small Home page using copied Home CSS classes.
5. Make Tauri render Home as the entry page.
6. Validate with build, Cargo check, and Electron/local-DB coupling searches.

## Validation

- `npm run build`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `rg 'window\.ghostbox|ipcRenderer|contextBridge|BrowserWindow|sqlite|games\.sqlite' src src-tauri`
