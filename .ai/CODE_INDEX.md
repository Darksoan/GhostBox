# Code Index

## Library Add Flow

`queueGame` -> `src/context/AppDataContext.tsx` (around 1894)
`ghostboxApi.addGameViaLuaTools` -> `src/lib/ghostboxApi.tauri.ts`
`luatools_add_game` -> `src-tauri/src/luatools.rs` (around 321); returns after package setup and spawns depot installation
`install_lua_tools_package` -> `src-tauri/src/luatools.rs` (around 137)
`install_added_game`, `cdndownload_download_game` -> `src-tauri/src/cdndownload.rs` (around 1250-1980); bootstrap limitado por `STEAM_BOOTSTRAP_BYTES` (10 MiB)
`upsert_ghostbox_library_game` -> `src-tauri/src/ghostbox_library.rs`

Relationships:
`GameModal` -> `ContentOverlay` -> `AppDataContext.queueGame` -> `luatools_add_game` -> background `install_added_game` -> SteamKit worker (`MaxDownloadBytes`) -> `write_partial_appmanifest` -> Steam conclui o download

Background completion:
Rust emits `game-installation-finished` -> `ghostboxApi.onGameInstallationFinished` -> `AppDataContext` updates/removes the game silently on success and notifies only on failure. The immediate `queueGame` result emits the single “Jogo adicionado” success toast.
Pending marker -> `GhostBoxGame.installationPending`; immediate result -> `AddGameResult.installationStarted` in `src/data.ts`.

Steam bootstrap completion:
`finalize_steam_integration` -> `src-tauri/src/cdndownload.rs` (around 1880)
`write_partial_appmanifest` (`StateFlags=2`) / `write_appmanifest` (`StateFlags=4`), `register_library_folder` -> `src-tauri/src/steam_appmanifest.rs`
Steam scan reads partial ACF as `status: queued` -> `parse_app_manifest` in `src-tauri/src/steam.rs`.
Chunk resume/validation state -> `src-tauri/src/chunk_index.rs`

## Steam Libraries

`resolve_steam_path`, `steamapps_path` -> `src-tauri/src/lib.rs` (around 310-460)
`read_steam_library_paths`, `steam_scan_library` -> `src-tauri/src/steam.rs` (around 1824-2050)
`AppInfo` / `resolve_install_dir` -> `src-tauri/src/steam_appinfo.rs`
Public depot/build metadata -> `src-tauri/src/steam_pics.rs`
Manifest package selection -> `src-tauri/src/manifest_sources.rs`

## Collections

Collection storage/rehydration -> `src/lib/collectionGames.ts` (`rehydrateUserCollectionGames`); keeps stored games and prefers non-placeholder titles.
Sidebar collection tree -> `src/components/layout/Sidebar.tsx`; resolves IDs across favorites, library, and stored collection games.
Cloud collection restore -> `AppDataContext.restoreCloudProfileFromRemote` -> `resolveCloudGames` -> `rehydrateCollectionGames`; placeholder titles receive one store-details retry after restore.

## Profile Editing

`EditProfileTab` -> `src/components/profile/EditProfileTab.tsx`; avatar upload/crop and premium banner editing, saved through `AppDataContext.handleUpdateProfile`.
Styles -> `src/pages/ProfilePage.scss` (`profile-page__edit-*`, around 1880).

## Tauri Commands

Command registration and shutdown -> `src-tauri/src/lib.rs` (around 1806-1913)
Frontend invoke bridge -> `src/lib/ghostboxApi.tauri.ts`
Frontend API types -> `src/lib/ghostboxApi.types.ts`

## Windows Startup

`StartupSettings` -> `src/types/index.ts`; settings UI -> `src/pages/SettingsPage.tsx`
`app_get_startup_settings`, `app_set_startup_settings`, `apply_autostart_settings` -> `src-tauri/src/settings.rs` (around 238-303)
Window/tray startup and persisted setting application -> `setup_window_lifecycle` in `src-tauri/src/window_lifecycle.rs` (around 513-567)
Release startup entry -> `tauri-plugin-autostart` writes `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`; `quote_windows_autostart_executable` preserves quotes around paths with spaces.
Development builds deliberately never manage that entry: they require Vite at `devUrl` in `src-tauri/tauri.conf.json`; release serves `frontendDist`.

## Packaging

Tauri bundle configuration -> `src-tauri/tauri.conf.json`
Windows release workflow -> `.github/workflows/release.yml`
CI workflow -> `.github/workflows/ci.yml` (root token/type/test checks, then subscriptions and catalogue worker typechecks/tests)
SteamKit worker source/protocol -> `sidecars/steamkit-poc/`, `sidecars/README.md`
Self-contained worker publish -> `package.json` (`sidecar:build`), output `sidecars/steamkit-worker/`

## Silent Boot Updates

`useSilentBootUpdate` -> `src/hooks/useSilentBootUpdate.ts` (single `checkForUpdates` on mount, 15s timeout; browser/dev and tray `?tray=1` skipped; failure/offline opens old version)
Boot splash -> `BootUpdateSplash` in `src/App.tsx` (`Atualizando GhostBox` + `baixando… {percent}%` / `instalando…`); styles `.update-splash` in `src/app.scss` (around 458-521, `--app-splash-progress`)
Install path -> `ghostboxApi.checkForUpdates/installUpdate` in `src/lib/ghostboxApi.tauri.ts` (plugin-updater `downloadAndInstall` + `relaunch`); types in `src/lib/ghostboxApi.types.ts`
Backend -> `tauri-plugin-updater` in `src-tauri/Cargo.toml`, plugin register in `src-tauri/src/lib.rs` (around 1791), config in `src-tauri/tauri.conf.json` (NSIS `currentUser` + updater `installMode: quiet`, pubkey/endpoints), permission `updater:default` in `src-tauri/capabilities/default.json`
Release flow -> tag `v*` triggers `.github/workflows/release.yml` (NSIS + `.sig`) -> worker serves manifest `workers/feedback/src/index.ts` (`/updates/latest`)
Header has no update UI (removed manual button/hourly polling/splash).

## Design Tokens (Texto / Tipografia)

Primitives -> `src/styles/_primitives.scss` (`--fs-*`, `--lh-*`, `--ls-*`, `--weight-*`, `--font-sans`)
Semantic -> `src/styles/_semantic.scss` (81-175: `--text-*`; hierarchy primary `#f2f2f2`, secondary `#c8c8c8`, tertiary `#b8b8b8`; `--type-size-*`, `--type-line-*`, fluid `--type-size-fluid-*`)
Mixins -> `src/styles/_mixins.scss` (`type-label/meta/body/body-strong/title/section/page/hero/showcase`, `eyebrow`, `truncate`)
Guard -> `scripts/check-tokens.mjs` (blocks raw hex, `font-size:px`, direct `--n-*/--a-*` in components; use `--text-*` / `--type-*`)

## Catalogue UI

`CataloguePage`, `CatalogueFilterSection`, `CatalogueYearRange` -> `src/pages/CataloguePage.tsx` (filter triggers/panels around 98-383; sort/view triggers around 827-976)
Catalogue toolbar, filters, cards and pagination styles -> `src/app.scss` (around 6486-7980); controls use `--surface-secondary` (`#101010`) at rest and `--control-hover` (`#151515`) on interaction, with tertiary -> secondary -> primary text hierarchy.
`CatalogueList`, `CatalogueListItem`, `CatalogueGridCard` -> `src/components/ui/CatalogueList.tsx`

## Confirmation Modals

`UninstallConfirmModal` -> `src/components/modals/UninstallConfirmModal.tsx`; active remove/uninstall confirmation rendered by `AppDataContext`.
Canonical confirmation action styles -> `src/app.scss` (`.confirm-modal` around 8505/10815; `collection-modal` around 10234; final neutral-action overrides and `.uninstall-confirm-modal` around 14850). Neutral buttons use tertiary text on `--surface-option`, then secondary text on `--surface-option-hover`; danger selectors and the collection primary action remain separate.
