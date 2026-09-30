# Code Index

## Library Add Flow

`queueGame` -> `src/context/AppDataContext.tsx` (around 1973)
`ghostboxApi.addGameViaLuaTools` -> `src/lib/ghostboxApi.tauri.ts`
`luatools_add_game` -> `src-tauri/src/luatools.rs` (around 321); returns after package setup and spawns depot installation
`install_lua_tools_package` -> `src-tauri/src/luatools.rs` (around 137)
`install_added_game`, `cdndownload_download_game` -> `src-tauri/src/cdndownload.rs` (around 1250-1980); bootstrap limitado por `STEAM_BOOTSTRAP_BYTES` (1 MiB)
`upsert_ghostbox_library_game` -> `src-tauri/src/ghostbox_library.rs`

Relationships:
`GameModal` -> `ContentOverlay` -> `AppDataContext.queueGame` -> `luatools_add_game` -> background `install_added_game` -> `sidecars/steamkit-poc/Program.cs` (`downloadDepot`/`MaxDownloadBytes`) -> `SteamKitPocRunner.DownloadDepotFilesAsync` (chunk budget, `partial-complete`) -> `write_partial_appmanifest` -> Steam conclui o download
`GameModal` / `ModalActions` -> `src/components/modals/GameModal.tsx` (around 706-885: Jogar/Adicionar/Remover/Favoritos/Ajustes); action hover/selected styles -> `src/app.scss` (`.modal__play-button` through `.modal__gear-button`, around 12300-12485).

Background completion:
Rust emits `game-installation-finished` -> `ghostboxApi.onGameInstallationFinished` -> `AppDataContext` updates/removes the game silently on success and notifies only on failure. The immediate `queueGame` result emits the single “Jogo adicionado” success toast.
Pending marker -> `GhostBoxGame.installationPending`; immediate result -> `AddGameResult.installationStarted` in `src/data.ts`.

Steam bootstrap completion:
`finalize_steam_integration` -> `src-tauri/src/cdndownload.rs` (around 1880)
`write_partial_appmanifest` (`StateFlags=2`) / `write_appmanifest` (`StateFlags=4`), `register_library_folder` -> `src-tauri/src/steam_appmanifest.rs`
Steam scan reads partial ACF as `status: queued` -> `parse_app_manifest` in `src-tauri/src/steam.rs`.
Chunk resume/validation state -> `src-tauri/src/chunk_index.rs`

Bootstrap is file-granular, never partial: `ProduceChunksAsync` in `sidecars/steamkit-poc/SteamKitPocRunner.cs` admits whole files (overshoot allowed, capped by `MaxFileOvershootBytes` from `STEAM_BOOTSTRAP_OVERSHOOT_BYTES` 64 MiB in `cdndownload.rs`); oversized files are skipped entirely, never left half-written.
Install-dir reconciliation: `resolve_effective_install_dir` in `cdndownload.rs` (pending ACF vs canonical `resolve_install_dir`); on divergence keeps the folder with more bytes, removes the loser only if safe bootstrap orphan (`is_safe_bootstrap_orphan`: has `.ghostbox-chunks.json`, no `.exe`).
Canonical folder names: `sanitize_install_dir`/`transliterate_to_ascii` in `steam_appinfo.rs` (ASCII-safe, deterministic; mojibake-proof).
UI errors are simple: `simplifyAddGameError` in `src/context/AppDataContext.tsx` (only item-blocked / Steam-missing / already-installed pass through; rest use the generic fallback).

## Steam Libraries

`resolve_steam_path`, `steamapps_path` -> `src-tauri/src/lib.rs` (around 202-325)
`read_steam_library_paths`, `read_steam_library_paths_ordered`, `read_last_install_folder_index`, `resolve_default_install_library`, `steam_scan_library` -> `src-tauri/src/steam.rs` (around 1826-1980)
Default install: `LastInstallFolderIndex` from `userdata/*/config/localconfig.vdf` > first secondary (ex. `E:\SteamLibrary`) > root `0`; `install_library_for_app` -> `src-tauri/src/cdndownload.rs` (around 1249)
`register_library_folder` mirrors `steamapps/libraryfolders.vdf` + `config/libraryfolders.vdf` -> `src-tauri/src/steam_appmanifest.rs` (around 451-540)
`AppInfo` / `resolve_install_dir` -> `src-tauri/src/steam_appinfo.rs`
Public depot/build metadata -> `src-tauri/src/steam_pics.rs`
Manifest package selection -> `src-tauri/src/manifest_sources.rs`

## Abertura de jogos e conquistas locais

Menu da engrenagem `GameBackupOptionsModal` -> `src/components/modals/GameBackupOptionsModal.tsx` (around 18-44, 205-234); aberto por `GameModal` (around 1922). Sem seletor de executável; strings legadas em `src/i18n.ts` (`gameSettings`).
`GameModal.ModalActions` (`src/components/modals/GameModal.tsx`, around 746-883) só exibe Jogar quando `isInstalled && isLocallyInstalled`; `ContentOverlay` (around 181-190) fornece as flags, `AppDataContext.playableGameAppIds` (around 1720) habilita Jogar nos cards/menus. `AppDataContext.queueGame` (around 2004-2032) envia jogo não-possuído para LuaTools; `ghostbox_library_register_steam_game` (`ghostbox_library.rs`, around 132-167) registra sem download.
`list_executables_blocking` -> `src-tauri/src/ghostbox_library.rs` (around 169-374): scan/score privado, sem comando Tauri; `sanitize_ghostbox_library_game` (around 59-75) remove `customExePath`/`launchArguments`; `merge_library_games` / `build_scan_games_with_plugins` (around 484-633) mesclam jogos por AppID e preservam marcadores LuaTools, não overrides.
Play: `AppDataContext.handlePlayGame` -> `ghostboxApi.launchGame` -> `game_launch` / `launch_game_from_value` em `src-tauri/src/lib.rs` (around 705). Abertura padrão usa `steam://rungameid/{appid}`; atalhos passam pelo GhostBox (`game_create_shortcut`, around 900).
Monitor: `playtime::open_game_playtime_session` / `monitor_game_process` (`src-tauri/src/playtime.rs`, around 249-295, 747-782) -> `achievement_monitor::start_local_achievement_monitor` (`src-tauri/src/achievement_monitor.rs`) -> `steam_appcache::read_local_unlocked_achievement_titles` (`src-tauri/src/steam_appcache.rs`, around 535-561), lendo o cache local da Steam por AppID; também lê saves Goldberg. Notificação UI -> `AppDataContext` (around 1495-1545). `steam_get_account_stats` (`src-tauri/src/steam.rs`, around 1398-1529) usa jogos possuídos via Web API/proxy, diferentemente do cache local.
Detecção de stplug-in: `read_plugin_added_steam_app_ids` em `src-tauri/src/ghostbox_library.rs` (around 392-439) lê `config/stplug-in/*.lua`; isso não confirma o estado do OpenSteamTool nem a escrita remota de conquistas.

## Home Steam Wishlist

Top-rated card review count -> `HomeTopRatedCard` in `src/pages/HomePage.tsx` (around 483-555); `.home-top-rated-card__developer` in `src/app.scss` (around 3714).
Wishlist player review/author playtime -> `HomePlayerReview` in `src/pages/HomePage.tsx` (around 1415-1573); `.home-wishlist-card__player-review-author small` in `src/app.scss` (around 4552-4597).
`HomeWishlistRecommendations`, `HomePage.loadWishlistCycle` -> `src/pages/HomePage.tsx` (around 1633-1684, 1845-2080); Steam-linked account gates section, cached daily cycle displays while upstream is unavailable, failed/empty fetch shows retry state.
Daily selection / freshness -> `src/utils/wishlistCycle.ts`; local cache -> `readStoredSteamWishlistCycle` / `writeStoredSteamWishlistCycle` in `src/utils/storage.ts`.
Fetch path -> `src/data.ts` (`loadSteamWishlist`) -> `src/lib/ghostboxApi.tauri.ts` (`getSteamWishlist`) -> `src-tauri/src/steam.rs` (`steam_get_wishlist`) -> `workers/steam-stats/src/index.ts` (`handleWishlist`, `fetchWishlist`).
Linked Steam identity -> `AppDataContext.steamProfile` in `src/context/AppDataContext.tsx` -> `PageRouter` -> `HomePage`.

## Collections

Collection storage/rehydration -> `src/lib/collectionGames.ts` (`rehydrateUserCollectionGames`); keeps stored games and prefers non-placeholder titles.
Sidebar collection tree -> `src/components/layout/Sidebar.tsx`; resolves IDs across favorites, library, and stored collection games.
Sidebar navigation (main/settings/profile tabs and collections) -> `Sidebar.tsx` (around 279-577); tab rows rest transparent on `--text-secondary`, hover/focus on `--sidebar-option-hover` with `--text-primary`; selected uses `--sidebar-option-active` with `--text-primary` -> `src/app.scss` (`.sidebar__menu-item`, around 1237-1319). Maximized settings tabs -> `.settings-page__tab` (around 2697); collection game rows -> `.sidebar__collection-game-button` (around 1437, rest transparent/secondary, hover/selected on `--sidebar-option-selected` with primary).
Premium cloud collection restore -> `AppDataContext.restoreCloudProfileFromRemote` in `src/context/AppDataContext.tsx` (around 997-1157) -> `resolveCloudCollectionGames` / `rehydrateUserCollectionGames` in `src/lib/collectionGames.ts` -> `Sidebar.sidebarCollections` in `src/components/layout/Sidebar.tsx` (around 134-193); unresolvable game IDs stay visible as placeholders and receive a store-details retry. Free accounts load collections from `src/utils/storage.ts` (`readStoredUserCollections`) on this device; cloud snapshot GET/PUT in `workers/subscriptions/src/index.ts` still requires Premium.

## Library UI

`LibraryPage` -> `src/pages/LibraryPage.tsx` (sort/source dropdown triggers around 361-448) -> shared `.settings-dropdown` styles in `src/app.scss` (`.library-toolbar`, around 9701-9787); trigger, chevron and option text use `--text-primary` on hover/focus/open. Cover format controls -> `.library-toolbar__format` (around 9850).

## Profile Editing

`EditProfileTab` -> `src/components/profile/EditProfileTab.tsx`; avatar upload/crop and premium banner editing, saved through `AppDataContext.handleUpdateProfile`.
Styles -> `src/pages/ProfilePage.scss` (`profile-page__edit-*`, around 1880).
Free avatar sync -> `AppDataContext.handleUpdateProfile` / `restoreCloudProfileFromRemote` in `src/context/AppDataContext.tsx` (around 997-1060, 2674): `ghostboxApi.uploadProfileImage` -> `saveCloudAvatar` / `getCloudAvatar` in `src/lib/ghostboxApi.tauri.ts` -> `cloud_upload_profile_image` / `cloud_put_profile_avatar` / `cloud_get_profile_avatar` in `src-tauri/src/cloud_save.rs` (around 557-690) -> `workers/subscriptions/src/index.ts` (`handleCloudProfileImageUpload` around 560; `handleCloudAvatarGet/Put` around 2528-2564). Free restore uses `applyCloudAvatarToLocal` in `src/lib/cloudProfile.ts`; server GET/PUT avatar require a session, update only `user_profile_cloud.avatar_url`.
Premium profile sync -> `AppDataContext.pushCloudProfileSnapshot` / `restoreCloudProfileFromRemote` -> `cloud_get/put_profile_snapshot` -> worker `handleCloudProfileGet/Put` (around 2566-2650; `requirePremiumSession`); includes banner, favorites and collections. Banner image upload/delete stays Premium.

## Profile Sign Out

Sign-out lives in the profile header -> `ProfilePage` in `src/pages/ProfilePage.tsx` (`profile-page__display-name-row`, after `profile-page__level`); icon button `profile-page__signout` (tertiary, primary on hover/focus) opens a `collection-modal profile-page__signout-confirm` dialog, then calls `AuthContext.logout` -> `ghostboxApi.signOutCloud`. Styles -> `src/pages/ProfilePage.scss` (`profile-page__signout`, `profile-page__signout-confirm`); copy -> `src/i18n.ts` (`settings.general.account.signOut*`). No account block in Settings.

Settings option descriptions -> `SettingRow` in `src/pages/SettingsPage.tsx` (around 608-630) -> `.settings-option__copy span` in `src/app.scss` (around 5842; disabled override around 5985). Performance temp-files description -> `TempFilesSection` / `TempFilesSection.scss` in `src/features/settings/`. Both use `--text-tertiary`, also used by the titlebar search placeholder via `--text-placeholder` in `src/app.scss` (around 2177).
Settings subtexts across tabs -> `.settings-page__header p` / `.steam-libraries__heading p` in `src/app.scss` (around 4770/4840); `SteamVisibilitySection`, `ConnectionsPanel`, `HiddenProfileGamesSection` in `src/features/settings/ConnectionsPanel.tsx` -> `.connection-card__steam-option-copy span`, `.hidden-profile-games__copy span`, `.connection-card__body p`, `.connection-card__connected`, `.connections-panel__header p`, `.hidden-profile-games-page__header p` in `ConnectionsPanel.scss`.
Hidden profile games search/filters -> `App` (`src/App.tsx`: `settingsLibraryView`, titlebar query) -> `useAppShellState` (`src/hooks/useAppShellState.ts`: `isHiddenProfileGamesSearch` disables global suggestions) / `Header` (`searchInPage`) -> `PageRouter` -> `SettingsPage` -> `HiddenProfileGamesSection` (`src/features/settings/ConnectionsPanel.tsx`, around 409-610). Titlebar query filters local titles through `filterAndSortHiddenProfileGames` (`src/utils/hiddenProfileGames.ts`); hovering/focusing a letter clears the titlebar query. `activeInitial` drives A–Z reset `aria-pressed`; reset colors -> `.hidden-profile-games-page__alphabet-reset` in `ConnectionsPanel.scss` (around 470-505).
Settings neutral controls -> `.settings-page-dropdown .settings-dropdown__trigger` / `.settings-action` in `src/app.scss` (around 6187-6404): settings dropdown trigger stays on `--settings-dropdown-surface` (`#151515`) at rest and hover/focus; `.settings-action` rests on `--surface-option` (`#101010`) and hovers on `--settings-dropdown-trigger-hover` (`#151515`). Trigger, icon and menu option text use `--text-primary` on hover/focus. Tokens -> `src/styles/_semantic.scss`; temp files action -> `src/features/settings/TempFilesSection.scss`.

## Profile Activity And Achievements

`ProfileActivityCard` -> `src/pages/ProfilePage.tsx` (around 150-305); recent-game activity, progress, and the latest-achievement icons/tooltips.
Achievement tab game cards -> `ProfilePage.tsx` (around 2145-2285); styles in `ProfilePage.scss` (`profile-page__achievement-*`, around 1274-1564).
Activity achievement icons/tooltips -> `ProfilePage.scss` (`profile-page__activity-icon`, around 1068); bitmap edges are cropped to remove embedded decorative borders, and card overflow remains visible so tooltips are not clipped.

## Linked Steam Profile Level

Steam link -> `AuthContext.linkedSteamId` in `src/context/AuthContext.tsx` (boot/account refresh around 51-126) -> `SidebarProfile` in `src/components/layout/Sidebar.tsx` (around 675-800) and `ProfilePage` in `src/pages/ProfilePage.tsx` (around 1760-1790, 1927-1947); level results are scoped to Steam ID so an earlier account's value does not linger.
Fetch -> `ghostboxApi.getSteamPlayerLevel` in `src/lib/ghostboxApi.tauri.ts` -> `steam_get_player_level` in `src-tauri/src/steam.rs` (around 1308-1395) -> `workers/steam-stats/src/index.ts` (`handlePlayerLevel` around 1620-1690; response parser `parseSteamLevelResponse` in `src/pure.mjs`); local Steam Web API key fallback via `settings::load_steam_web_api_key` when proxy fails.

## Tauri Commands

Command registration and shutdown -> `src-tauri/src/lib.rs` (around 970-1134)
Frontend invoke bridge -> `src/lib/ghostboxApi.tauri.ts`
Frontend API types -> `src/lib/ghostboxApi.types.ts`

## Premium Cloud Game Saves

Manual actions -> `GameBackupOptionsModal` in `src/components/modals/GameBackupOptionsModal.tsx` (entitlement + backup/restore); `ghostboxApi.getSubscriptionStatus/backupGameToCloud/restoreCloudSave` -> `src/lib/ghostboxApi.tauri.ts`.
Settings list actions -> `SubscriptionPlans` in `src/components/subscription/SubscriptionPlans.tsx` (backup summary/list, hover/focus actions and handlers around 285-675) -> `BackupConfirmModal` in `src/components/subscription/BackupConfirmModal.tsx` (restore/delete confirmation reuses `collection-modal`) -> `ghostboxApi.restoreCloudSave/deleteCloudGameSaves` in `src/lib/ghostboxApi.tauri.ts` -> `cloud_restore_save/cloud_delete_game_saves` in `src-tauri/src/cloud_save.rs`. Restore accepts `appId`+`title` for cloud-only games; delete removes all saves for the selected game. Action/date motion and modal styling -> `src/app.scss` (`.subscription-account__backup-*` around 5608-5740; `.cloud-backup-confirm-modal` around 15150).
Auto-restore before play/re-add -> `AppDataContext.autoRestoreCloudBackup` / `handlePlayGame` in `src/context/AppDataContext.tsx` (around 1852-1950, 2380-2410).
Automatic backup after game exit -> `window_lifecycle::setup_window_lifecycle` -> `playtime::start_steam_running_app_monitor` / `run_automatic_backup_after_close` in `src-tauri/src/playtime.rs` (around 320-396, 480-619).
Native backup/restore -> `cloud_save::cloud_backup_game` / `cloud_restore_save` in `src-tauri/src/cloud_save.rs`; `subscription::has_premium_access` in `src-tauri/src/subscription.rs` gates before staging; `ludusavi::run_ludusavi` in `src-tauri/src/ludusavi.rs` reads/writes game saves.
Progress export/import -> `export_game_profile_progress` / `import_game_profile_progress` in `src-tauri/src/lib.rs` (around 553-679); transfer staging under `app_cache_dir/cloud-save`, removed after each operation; `storage_audit::startup_temp_sweep` clears stale UUID staging after crashes.
Cloud-only status metadata -> `backup::backup_get_settings` in `src-tauri/src/backup.rs` -> `normalize_backup_settings` / `save_backup_record` in `src-tauri/src/lib.rs` (around 59-160, 687); frontend `AppDataContext.backupSettings` -> `SubscriptionPlans` in `src/components/subscription/SubscriptionPlans.tsx`. No local backup root/details API.
Server authorization -> `workers/subscriptions/src/index.ts` (`requirePremiumSession`, `handleCloudSavesList/Upload/Download/Delete` around 669, 2085-2300).
Single-save retention -> `workers/subscriptions/src/index.ts` (`MAX_CLOUD_SAVES_PER_GAME=1`, `pruneCloudSavesForGame`, scheduled `pruneLegacyCloudSaves`, `handleCloudGameSavesDelete`; `/cloud-saves/game/:appId`). GET remains read-only; legacy cleanup keeps the newest save. `withCloudGameWriteLock` serializes uploads, pin changes, single/bulk deletes and cron cleanup by `user_id` + `app_id` via D1 migration `workers/subscriptions/migrations/0024_cloud_save_write_locks.sql` (apply before deploying Worker). Tests -> `workers/subscriptions/test/cloud-saves-d1.test.ts`.
Delete flow: `SubscriptionPlans.confirmBackupAction` -> `ghostboxApi.deleteCloudGameSaves(appId)` -> `cloud_delete_game_saves` in `src-tauri/src/cloud_save.rs` (DELETE `{base}/cloud-saves/game/{appId}`, errors via `format_cloud_api_error`) -> worker `handleCloudGameSavesDelete` (200 even with 0 rows; 409 `cloud_save_busy` on concurrent writes; `deletedSaves: 0` shows an "already removed" info toast). No CI deploy for this worker — deploy is manual (`wrangler deploy` from `workers/subscriptions`). Incident 2026-09-27: prod ran a build without the bulk-delete route (added in `73ffa46`), so DELETE fell into the `{ error: "Not found" }` 404 fallback; unauthenticated probe distinguishes stale (404) from live (401 `unauthorized`).
Account scope: `SubscriptionPlans` keys subscription status/cloud saves and invalidates in-flight polls on `AuthContext.account.userId`; `cloud_backup_game`/`cloud_restore_save` in `src-tauri/src/cloud_save.rs` compare account before recording a backup or applying a restore after asynchronous transfer.

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
Backend -> `tauri-plugin-updater` in `src-tauri/Cargo.toml`, plugin register in `src-tauri/src/lib.rs` (around 1009), config in `src-tauri/tauri.conf.json` (NSIS `currentUser` + updater `installMode: quiet`, pubkey/endpoints), permission `updater:default` in `src-tauri/capabilities/default.json`
Release flow -> tag `v*` triggers `.github/workflows/release.yml` (NSIS + `.sig`) -> worker serves manifest `workers/feedback/src/index.ts` (`/updates/latest`)
Header has no update UI (removed manual button/hourly polling/splash).

## Design Tokens (Texto / Tipografia)

Primitives -> `src/styles/_primitives.scss` (`--fs-*`, `--lh-*`, `--ls-*`, `--weight-*`, `--font-sans`)
Semantic -> `src/styles/_semantic.scss` (81-175: `--text-*`; hierarchy primary `#f2f2f2`, secondary `#c8c8c8`, tertiary `#8c8c8c`; titlebar `--text-placeholder` aliases tertiary; `--type-size-*`, `--type-line-*`, fluid `--type-size-fluid-*`; status `--caution` -> `--caution-500` `#ffbf00` in `_primitives.scss`)
Mixins -> `src/styles/_mixins.scss` (`type-label/meta/body/body-strong/title/section/page/hero/showcase`, `eyebrow`, `truncate`)
Guard -> `scripts/check-tokens.mjs` (blocks raw hex, `font-size:px`, direct `--n-*/--a-*` in components; use `--text-*` / `--type-*`)

## Titlebar

`Header` -> `src/components/layout/Header.tsx` (premium/subscription button around 407-456; search suggestions dropdown around 458-525, fed by `useAppShellState`)
Premium button appearance -> `src/app.scss` (`.header__premium-indicator`, around 2064; crown and label immediately after); resting label matches `.header__search input::placeholder` via `--text-placeholder`; hover/focus changes only the surface to `--surface-option-hover` (`#151515`).
Search suggestions appearance/scroll -> `src/app.scss` (`.header__search-dropdown`, around 2294-2385; `.header__search-dropdown-thumbnail` 120px small capsule).
Search suggestion thumbnails -> `SearchSuggestionThumbnail` in `Header.tsx` -> `gameSmallCapsuleSources` / `smallCapsuleSourcesForAppId` / `isSmallCapsuleImageSource` in `src/utils/image.ts` (capsule_231x87 CDNs: shared.{akamai,fastly,cloudflare,steamstatic}.steamstatic.com/store_item_assets + cdn.cloudflare/steamcdn-a/cdn.akamai `steam/apps/{id}`); store `tiny_image` exposed as `GhostBoxGame.smallCapsuleUrl` (`src/data.ts`) via `steam_store_search_games` in `src-tauri/src/catalogue.rs` (around 2422).
Header suggestion merging (catalogue + Steam store supplement, limit 8, thumb+title, no prices) -> `useExpandedGameSearch` (`src/hooks/useExpandedGameSearch.ts`, `steamSupplement` option) + `useAppShellState` (`src/hooks/useAppShellState.ts`). Catalogue-only fallback stays in `useCatalogueState`.

## Catalogue UI

`CataloguePage`, `CatalogueFilterSection`, `CatalogueYearRange` -> `src/pages/CataloguePage.tsx` (filter triggers/panels around 98-383; sort/view triggers around 827-976)
Catalogue toolbar, filters, cards and pagination styles -> `src/app.scss` (around 6486-7980); controls use `--surface-secondary` (`#101010`) at rest and `--control-hover` (`#151515`) on interaction. Trigger/button hover text is always `--text-primary`: filter pills (`.catalogue-filter-section__header`, around 7117-7201), sort/view triggers + their options (`.catalogue-page__sort/__view .settings-dropdown__trigger`, around 6906-6924), filter options (`.catalogue-filter-option`, around 7493), clear-filters (6790) and pagination (8118/14046).
Filter checkbox markup -> `CatalogueFilterSection` in `src/pages/CataloguePage.tsx` (around 350); `.catalogue-filter-option` in `src/app.scss` (around 7297, white selected check).
`CatalogueList`, `CatalogueListItem`, `CatalogueGridCard` -> `src/components/ui/CatalogueList.tsx`
Active-filter clear action -> `CataloguePage.clearAllFilters` in `src/pages/CataloguePage.tsx`; floating bottom-right viewport control `.catalogue-page__clear-filters` in `src/app.scss` (around 6595).

Catalogue search: `useAppShellState` -> `src/hooks/useAppShellState.ts` (header suggestions/debounce) / `useCatalogueState` -> `src/hooks/useCatalogueState.ts` (chunking, filters, fallback) -> `useGamesQuery` in `src/queries/games.ts` -> `database_get_games` in `src-tauri/src/catalogue.rs` (around 2270) -> `searchCatalogue` in `workers/catalogue/src/catalogue.ts` (around 580; `searchIndexMatch` around 495, title/AppID ranking around 659). FTS -> `workers/catalogue/migrations/0004_search_index.sql`; backfill -> `workers/catalogue/src/search-index.ts`; response caches -> `src-tauri/src/catalogue_cache.rs`, `workers/catalogue/src/cache.ts`.
Catalogue images: `toGame` in `workers/catalogue/src/catalogue.ts` (around 108; cover/source metadata) -> `gameCatalogueHeaderSources` / `gameCataloguePreviewScreenshotSourceGroups` in `src/utils/image.ts` (around 88-165) -> `CatalogueHeaderImage` in `src/components/ui/CatalogueList.tsx` (around 35-141) / `CatalogueHoverPreview` in `src/components/ui/CatalogueHoverPreview.tsx`; disk/source lookup and post-load cache -> `src/utils/imageCache.ts`. `CatalogueListItem` measures visible tag pills in `src/components/ui/CatalogueList.tsx` (around 183-286).
Modal details: `GameModal` in `src/components/modals/GameModal.tsx` (around 965-1055) -> `loadGameStoreDetailsCached` / `loadGameAchievementDetailsCached` in `src/utils/gameCache.ts` -> `database_get_game_store_details` / `database_get_game_achievement_details` in `src-tauri/src/catalogue.rs` (around 2434-2595; both accept matching base game from modal to skip duplicate catalogue fetch). Achievement loading state is independent of store details.
Modal hero: `manifestHeroSources` in `GameModal.tsx` (via `getSteamAssetUrl` from `steamAssetManifest.ts`) precedes `gameHeroSources` (`src/utils/image.ts`) so migrated games use hashed `library_hero_2x`/`library_hero` before screenshot fallback (Aniimo 4126040).
Achievement icons: legacy `steamcommunity/public/images/apps/...` 404s on new games; normalized to `shared.fastly.steamstatic.com/community_assets/...` in `normalizeCommunityImageUrl` (`workers/steam-stats/src/pure.mjs`), `normalize_achievement_image_url` + in-flight `achievementList` rewrite (`src-tauri/src/catalogue.rs`), `normalizeAchievementImageSource` / `achievementIconFallbackSources` (`src/utils/steamAchievementMerge.ts`) consumed by `GameModal.AchievementIcon`, `GameAchievementsPage`, `ProfilePage.achievementShowcaseIcon`. Locked art uses `grayscale(1) brightness(0.78)` in `src/app.scss` (`modal__achievement-item--locked`).
DRM badge: Steam `drm_notice` -> `drmNotice` (`GhostBoxGame.drmNotice` in `src/data.ts`; normalize in `workers/steam-details/src/pure.ts`, merge in `src-tauri/src/catalogue.rs`; missing field in old proxy triggers direct Steam fallback) -> `GameModal` (`hasDrm`, `Alert` from `reicon-react` in `.modal__showcase-media`, around 1580). Empty notice clears cached DRM; no notice does not prove DRM-free.
Steam appdetails envelope -> `steamAppData` in `workers/steam-details/src/pure.ts` / `steam_app_data` in `src-tauri/src/catalogue.rs`: accept alternate response keys only when embedded `steam_appid` matches (Requiem/Wilds). v4 disk descriptions remain readable during DRM refresh; `loadGameStoreDetailsCached` only pins payloads with description + resolved DRM field.

## Catalogue D1 Diagnostics

Worker `piratebox-catalogue` -> D1 binding `DB`, database `piratebox-games` -> `workers/catalogue/wrangler.toml`.
Legacy FTS backfill -> `workers/catalogue/src/search-index.ts` (`runSearchIndexBackfill`, `validateAndActivate`); cron `*/2 * * * *` suspended in production 2026-09-26. Legacy state in `catalogue_meta.searchIndexBackfillState`; do not run against v2.
Recovery runbook and cutover -> `workers/catalogue/RECOVERY.md`; compact replacement D1 schema -> `schema-v2.sql`; v2 deployment config -> `wrangler.v2.toml` (not active until validation). URL packing/unpacking -> `src/screenshots.ts` -> `toGame` / `ingestSteamApp` in `src/catalogue.ts`. Search fail-closed -> `src/index.ts` (`searchIndexVersion=2`), SQL `games_search.rowid` primary-key join / count fast path -> `src/catalogue.ts`.
Background source-to-target copy -> `src/migrator.ts` + `migrator.wrangler.toml` (Worker `piratebox-catalogue-migrator`, cron every 5 min); CLI dry-run/resume/finalize -> `scripts/migrate-v2.mjs`. State in target `catalogue_meta.v2MigrationCursor`, `v2MigrationWriteBudget`, `v2MigrationPaused`. Each batch checks `D1Result.meta.size_after` (375 MB stop), reserves 220 writes/25 games up to 60k/day; manual finalize requires <300 MB and activates search v2. Do not run CLI `--apply` concurrently with cron.
Ingest capacity limits -> `src/catalogue.ts` (`reserveDailyIngest`, `MAX_CATALOGUE_GAMES`, `MAX_CATALOGUE_DB_BYTES`, `MAX_DAILY_INGESTS`); reads physical `D1Result.meta.size_after` before writing. v2 migrates legacy games as `app_type='unclassified'` (legacy DB has no classification). `storedGames` is the storage cap count, `totalGames` excludes newly classified demos for pagination; `demoExclusionClause` excludes known demos and NULL rows.
Read-cost inspection -> `wrangler d1 insights piratebox-games --time-period 1d --sort-by reads --sort-type sum --limit 10 --json`; storage/24h usage -> `wrangler d1 info piratebox-games` (run from `workers/catalogue`).
Production observation 2026-09-26 (recheck before deployment): 513,740,800 bytes; FTS activation key absent, 99,825 indexed / 113,756 games; migrations through `0004`, no `games.app_type`. Local code expects migration `0005`; deployed SQL differs from local. Insights identified legacy `search_text LIKE` result/count scans (~113k rows/query) as major read consumers. `dbstat` unavailable remotely.

## Subscription / Cloud Backups

`SubscriptionPlans` -> `src/components/subscription/SubscriptionPlans.tsx` (cloud-save summaries around 285-327; active subscription, backup sorting/actions and pagination around 405-680). Receives `cloudBackupGames` from `SettingsPage` (`src/pages/SettingsPage.tsx`, around 315-386); remote saves via `ghostboxApi.listCloudSaves`.
Backup list styles -> `src/app.scss` (`.subscription-account__backup-list` and `.subscription-account__backup-row-actions`, around 5608-5740). Pagination reuses `PaginationControls` -> `src/components/ui/PaginationControls.tsx` (also used by `CataloguePage`).

## Auth

`AuthScreen` -> `src/features/auth/AuthScreen.tsx`; terms checkbox `.auth-form__consent-toggle` in `src/features/auth/AuthScreen.scss` shares the uninstall-modal checkbox language (18px, `--radius-sm`, `--surface-secondary` rest / white checked, stroke-draw motion).

## Confirmation Modals

`useGameContextMenu` -> `src/hooks/useGameContextMenu.ts` (Steam installation check) -> `useCollectionContextMenu` in `src/hooks/useCollectionContextMenu.ts` (single remove entry) -> `AppDataContext.requestRemoveGame` -> `UninstallConfirmModal` in `src/components/modals/UninstallConfirmModal.tsx` (checkbox after installed-game check, styled by `.uninstall-confirm-modal__option` in `src/app.scss`) -> `AppDataContext` (`removeQueuedGame` or `uninstallGame` + Steam wait).
Game context menu items (all in `useCollectionContextMenu`, handlers wired internally in `useGameContextMenu`, no per-page wiring): Ver conquistas (`Trophy`, `OverlayContext.openAchievements`, only if `hasAvailableAchievements`) after Jogar; Ocultar/Mostrar no perfil (`EyeOff`/`Eye`, `AppDataContext.setProfileGameHidden` + toast, same copy as `GameBackupOptionsModal`) before Remover da biblioteca; shown only for owned games (library/playable/favorite/history/Steam-owned via `hideableGameAppIds` from `useGameContextMenu`, mirroring the `HiddenProfileGamesSection` universe in `ConnectionsPanel.tsx`) — catalogue games the user does not own get no item; Abrir na Steam last (`ExternalLink`, `ghostboxApi.openExternalUrl` opening `https://store.steampowered.com/app/{id}` in the browser — `steampowered.com` is on the backend allowlist in `window_lifecycle.rs`, numeric-id only). Hidden/Steam require `game.appId`. Native browser menu is blocked globally in `src/main.tsx` (`contextmenu` capture listener); card handlers always `preventDefault` first. New labels use inline PT/EN `copy()` via `useSettings` (old labels still hardcoded).
Canonical confirmation action styles -> `src/app.scss` (`.confirm-modal` around 8540/10870; `.collection-modal` around 10287; shared confirmation spacing and `.uninstall-confirm-modal` around 14940). Neutral buttons use tertiary text on `--surface-option`, then secondary text on `--surface-option-hover`; danger selectors and the collection primary action remain separate. Account sign-out button hover -> `src/features/settings/AccountSection.scss` (`.account-section__confirm`).
