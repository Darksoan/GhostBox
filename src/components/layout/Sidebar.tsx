import {
  ChevronRight,
  Folder,
  Heart,
  Pencil,
  Search,
  Trash,
} from "lucide-react";
import { memo, useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { ContextMenu } from "../ui/ContextMenu";
import { useGameContextMenu } from "../../hooks/useGameContextMenu";
import { preloadGameIconUrls, useGameIconUrl } from "../../hooks/useGameIconUrl";
import { settingsNavigationTabs, settingsTabLabelKeys, type SettingsTabId } from "../../features/settings/settingsTabsShared";
import {
  defaultProfileTabId,
  profileNavigationTabs,
  profileTabLabelKeys,
} from "../../features/profile/profileTabsShared";
import { useSettings } from "../../context/settings";
import { useAuth } from "../../context/AuthContext";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadGameModalAssetsThrottled, preloadProfileImages } from "../../utils/image";
import { searchCollectionGames } from "../../utils/collectionSearch";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { resolveSidebarIdentity } from "../../lib/sidebarIdentity";
import { isSteamTitlePlaceholder } from "../../utils/steamTitles";
import { getSteamLevelColorTier } from "../../utils/steamLevel";
import {
  readSidebarExpandedCollections,
  writeSidebarExpandedCollections,
} from "../../utils/storage";
import { primaryNavigation, secondaryNavigation } from "./navigationItems";
import { SidebarNavigationIcon } from "./SidebarNavigationIcon";
import { useWindowMaximized } from "../../hooks/useWindowMaximized";
import avatarPlaceholder from "../../../Icons/userplaceholder.jpg";

interface SidebarProps {
  activePage: Page;
  activeCollectionId?: string;
  steamProfile: SteamProfile | null;
  isCloudProfileRestoring?: boolean;
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  userCollections: UserCollection[];
  onNavigate: (page: Page, collectionId?: string) => void;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenGame: (game: GhostBoxGame) => void;
  onCreateCollection: () => void;
  onRemoveFavorite: (game: GhostBoxGame) => void;
  onDeleteCollection?: (collectionId: string) => void;
  activeSessionAppIds?: Set<string>;
  activeSettingsTabId: SettingsTabId;
  onSettingsTabChange: (tabId: SettingsTabId) => void;
  onProfileTabChange: (tabId: string) => void;
}

const FAVORITES_COLLECTION_ID = "__favorites__";
const SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT = 10;

type SidebarCollection = {
  id: string;
  name: string;
  games: GhostBoxGame[];
};

export const Sidebar = memo(function Sidebar({
  activePage,
  activeCollectionId,
  steamProfile,
  isCloudProfileRestoring = false,
  favoriteGames,
  addedLibraryGames,
  userCollections,
  onNavigate,
  onBack,
  onOpenProfile,
  onOpenGame,
  onCreateCollection,
  onRemoveFavorite: _onRemoveFavorite,
  onDeleteCollection,
  activeSessionAppIds = new Set(),
  activeSettingsTabId,
  onSettingsTabChange,
  onProfileTabChange,
}: SidebarProps) {
  const isSettingsPage = activePage === "settings";
  const isProfilePage = activePage === "profile";
  // Perfil e ajustes trocam o menu principal pelo próprio painel de abas, com a
  // mesma coreografia de entrada (`sidebar__mode-panel--forward`).
  const isModePage = isSettingsPage || isProfilePage;
  const activeProfileTabId = activeCollectionId ?? defaultProfileTabId;
  const isMaximized = useWindowMaximized();
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(() => readSidebarExpandedCollections());
  const [isCollectionSearchOpen, setIsCollectionSearchOpen] = useState(false);
  const [collectionSearchQuery, setCollectionSearchQuery] = useState("");
  const collectionSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    writeSidebarExpandedCollections(expandedCollectionIds);
  }, [expandedCollectionIds]);

  const [collectionContextMenu, setCollectionContextMenu] = useState<{
    collection: SidebarCollection | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ collection: null, visible: false, position: { x: 0, y: 0 } });
  const [collectionGameContextMenu, setCollectionGameContextMenu] = useState<{
    collection: SidebarCollection | null;
    game: GhostBoxGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ collection: null, game: null, visible: false, position: { x: 0, y: 0 } });
  const [, setShowRenameCollectionModal] = useState(false);
  const [, setCollectionName] = useState("");
  const { t } = useSettings();
  const collectionGameContextMenuItems = useGameContextMenu({
    game: collectionGameContextMenu.game,
    onOpenGame,
    directFavoriteAction: true,
  });

  const deferredFavoriteGames = useDeferredValue(favoriteGames);
  const deferredAddedLibraryGames = useDeferredValue(addedLibraryGames);

  const sidebarCollections = useMemo<SidebarCollection[]>(() => {
    // Chaves normalizadas (`id`, `appId`, `steam-<appId>`): o jogo pode ter
    // sido guardado com um formato e a biblioteca referenciá-lo em outro.
    const addGameKeys = (map: Map<string, GhostBoxGame>, game: GhostBoxGame) => {
      const keys = new Set<string>();
      const id = game.id?.trim();
      const appId = game.appId?.trim();
      if (id) keys.add(id);
      if (appId) {
        keys.add(appId);
        if (/^\d+$/.test(appId)) keys.add(`steam-${appId}`);
      }
      const steamId = id?.match(/^steam-(\d+)$/i)?.[1];
      if (steamId) keys.add(steamId);
      for (const key of keys) {
        const current = map.get(key);
        // Cloud restoration can briefly supply a fallback title while a local
        // library scan already knows the real name. Never let that placeholder
        // win simply because its list happens to be traversed first.
        if (
          !current ||
          (isSteamTitlePlaceholder(current.title, current.appId) &&
            !isSteamTitlePlaceholder(game.title, game.appId))
        ) {
          map.set(key, game);
        }
      }
    };
    const gamesByKey = new Map<string, GhostBoxGame>();
    [
      ...deferredFavoriteGames,
      ...deferredAddedLibraryGames,
      ...userCollections.flatMap((collection) => collection.games ?? []),
    ].forEach((game) => addGameKeys(gamesByKey, game));

    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("profile.favorites"),
        games: deferredFavoriteGames,
      },
      ...userCollections.map((collection) => {
        // Opção A: a cópia guardada na coleção é o fallback — mesmo que o jogo
        // não esteja na biblioteca/favoritos, o dropdown da sidebar o exibe.
        const storedByKey = new Map<string, GhostBoxGame>();
        for (const game of collection.games ?? []) {
          addGameKeys(storedByKey, game);
        }
        return {
          id: collection.id,
          name: collection.name,
          games: collection.gameIds.flatMap((gameId) => {
            const key = gameId.trim();
            const game = gamesByKey.get(key) ?? storedByKey.get(key);
            return game ? [game] : [];
          }),
        };
      }),
    ];
  }, [deferredAddedLibraryGames, deferredFavoriteGames, userCollections, t]);

  const hasCollectionSearchQuery = collectionSearchQuery.trim().length > 0;
  const matchingCollectionGames = useMemo(() => {
    return searchCollectionGames(sidebarCollections, collectionSearchQuery);
  }, [collectionSearchQuery, sidebarCollections]);

  const activeSessionGame = useMemo(() => {
    if (activeSessionAppIds.size === 0) return null;

    const games = [
      ...deferredAddedLibraryGames,
      ...deferredFavoriteGames,
      ...userCollections.flatMap((collection) => collection.games ?? []),
    ];

    return games.find((game) => activeSessionAppIds.has(game.appId)) ?? null;
  }, [
    activeSessionAppIds,
    deferredAddedLibraryGames,
    deferredFavoriteGames,
    userCollections,
  ]);

  const visibleSidebarIconGames = useMemo(() => {
    if (hasCollectionSearchQuery) return matchingCollectionGames;

    const games = sidebarCollections.flatMap((collection) => {
      if (!expandedCollectionIds.has(collection.id)) return [];
      return collection.games.slice(0, SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT);
    });

    if (activeSessionGame) games.push(activeSessionGame);
    return games;
  }, [
    activeSessionGame,
    expandedCollectionIds,
    hasCollectionSearchQuery,
    matchingCollectionGames,
    sidebarCollections,
  ]);

  useEffect(() => {
    preloadGameIconUrls(visibleSidebarIconGames);
  }, [visibleSidebarIconGames]);

  const toggleCollectionExpanded = useCallback((collectionId: string) => {
    setExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  }, []);

  const handleCollectionClick = useCallback(
    (collection: SidebarCollection) => {
      if (collection.id === FAVORITES_COLLECTION_ID) {
        onNavigate("favorites", "favorites");
      } else {
        onNavigate("favorites", collection.id);
      }
    },
    [onNavigate]
  );

  const openCollectionSearch = useCallback(() => {
    setIsCollectionSearchOpen(true);
  }, []);

  const closeCollectionSearch = useCallback(() => {
    setIsCollectionSearchOpen(false);
    setCollectionSearchQuery("");
  }, []);

  useEffect(() => {
    if (!isCollectionSearchOpen) return;

    const frame = window.requestAnimationFrame(() => collectionSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isCollectionSearchOpen]);

  return (
    <aside className={`sidebar${isMaximized ? " sidebar--maximized" : ""}`}>
      <div className="sidebar__content">
        <SidebarProfile
          profile={steamProfile}
          isCloudProfileRestoring={isCloudProfileRestoring}
          isActive={activePage === "profile"}
          onOpenProfile={onOpenProfile}
        />

        {!isModePage && (
          <nav className="sidebar__section sidebar__mode-panel sidebar__mode-panel--back" >
            <ul className="sidebar__menu">
              {primaryNavigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <SidebarNavigationIcon icon={Icon} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
              {secondaryNavigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <SidebarNavigationIcon icon={Icon} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {isSettingsPage && (
          <nav className="sidebar__section sidebar__mode-panel sidebar__mode-panel--forward" aria-label="Tópicos de ajustes" >
            <ul className="sidebar__menu">
              {settingsNavigationTabs.map(({ id, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activeSettingsTabId === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onSettingsTabChange(id)}
                  >
                    <SidebarNavigationIcon icon={Icon} />
                    <span className="sidebar__menu-item-label">{t(settingsTabLabelKeys[id])}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {isProfilePage && (
          <nav
            className="sidebar__section sidebar__mode-panel sidebar__mode-panel--forward"
            aria-label="Seções do perfil"
          >
            <ul className="sidebar__menu">
              {profileNavigationTabs.map(({ id, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activeProfileTabId === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onProfileTabChange(id)}
                  >
                    <SidebarNavigationIcon icon={Icon} />
                    <span className="sidebar__menu-item-label">{t(profileTabLabelKeys[id])}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {!isModePage && (
          <section className="sidebar__collapsible-section sidebar__mode-panel sidebar__mode-panel--back sidebar__mode-panel--delayed">
            <div className={`sidebar__section-header${isCollectionSearchOpen ? " sidebar__section-header--searching" : ""}`}>
              <div className="sidebar__section-header-main">
                <h2
                  className="sidebar__section-title"
                  aria-hidden={isCollectionSearchOpen}
                >
                  {t("sidebar.collections")}
                </h2>
                <label
                  className={`sidebar__collection-search${isCollectionSearchOpen ? " sidebar__collection-search--open" : ""}`}
                  aria-hidden={!isCollectionSearchOpen}
                  onBlur={closeCollectionSearch}
                >
                  <Search size={16} aria-hidden="true" />
                  <input
                    ref={collectionSearchInputRef}
                    type="search"
                    value={collectionSearchQuery}
                    onChange={(event) => setCollectionSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") closeCollectionSearch();
                    }}
                    placeholder={t("sidebar.collectionSearchPlaceholder")}
                    tabIndex={isCollectionSearchOpen ? 0 : -1}
                    aria-label={t("sidebar.collectionSearchPlaceholder")}
                  />
                </label>
              </div>
              <div className="sidebar__section-actions">
                {!isCollectionSearchOpen && (
                  <button
                    type="button"
                    className="sidebar__collection-search-button"
                    onClick={openCollectionSearch}
                    aria-label={t("sidebar.searchCollections")}
                  >
                    <Search size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
                {!isCollectionSearchOpen && (
                  <button
                    type="button"
                    className="sidebar__add-button"
                    onClick={onCreateCollection}
                    aria-label={t("profile.createCollection")}
                  >
                    <span className="sidebar__add-icon" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
              <ul className="sidebar__menu" >
                {hasCollectionSearchQuery ? (
                  matchingCollectionGames.map((game) => (
                    <li key={game.id} className="sidebar__collection-game">
                      <button
                        type="button"
                        className="sidebar__collection-game-button"
                        onClick={() => onOpenGame(game)}
                        onFocus={() => preloadGameModalAssetsThrottled(game)}
                        onMouseEnter={() => preloadGameModalAssetsThrottled(game)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setCollectionGameContextMenu({
                            collection: null,
                            game,
                            visible: true,
                            position: { x: event.clientX, y: event.clientY },
                          });
                        }}
                      >
                        <SidebarGameItem game={game} />
                      </button>
                    </li>
                  ))
                ) : (
                  sidebarCollections.map((collection) => {
                  const isFavoritesCollection = collection.id === FAVORITES_COLLECTION_ID;
                  const isExpanded = expandedCollectionIds.has(collection.id);
                  const isActive =
                    (activePage === "favorites" &&
                      isFavoritesCollection &&
                      activeCollectionId === "favorites") ||
                    (activePage === "favorites" &&
                      !isFavoritesCollection &&
                      activeCollectionId === collection.id) ||
                    (activePage === "library" &&
                      isFavoritesCollection &&
                      activeCollectionId === "favorites") ||
                    (activePage === "library" &&
                      !isFavoritesCollection &&
                      activeCollectionId === collection.id);

                  return (
                    <li
                      key={collection.id}
                      className={`sidebar__menu-item sidebar__collection-item ${
                        isActive ? "sidebar__menu-item--active" : ""
                      } ${isExpanded ? "sidebar__collection-item--expanded" : ""}`}
                      onContextMenu={(e) => {
                        if (!isFavoritesCollection) {
                          e.preventDefault();
                          setCollectionContextMenu({
                            collection,
                            visible: true,
                            position: { x: e.clientX, y: e.clientY },
                          });
                        }
                      }}
                    >
                      <div className="sidebar__collection-row">
                        <button
                          type="button"
                          className="sidebar__collection-toggle-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollectionExpanded(collection.id);
                          }}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? "Recolher" : "Expandir"}
                        >
                          <ChevronRight
                            size={16}
                            strokeWidth={2}
                            className={`sidebar__collection-chevron${isExpanded ? " sidebar__collection-chevron--expanded" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          className="sidebar__menu-item-button"
                          onClick={() => handleCollectionClick(collection)}
                        >
                          {isFavoritesCollection ? (
                            <Heart size={16} strokeWidth={2} className="sidebar__collection-icon" />
                          ) : (
                            <Folder size={16} strokeWidth={2} className="sidebar__collection-icon" />
                          )}
                          <span className="sidebar__menu-item-label">{collection.name}</span>
                        </button>
                      </div>
                      {isExpanded && (
                        <ul className="sidebar__collection-games" aria-label={`Jogos em ${collection.name}`}>
                          {collection.games.length > 0 ? (
                            <>
                              {collection.games.slice(0, SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT).map((game) => (
                                <li key={game.id} className="sidebar__collection-game">
                                  <button
                                    type="button"
                                    className="sidebar__collection-game-button"
                                    onClick={() => onOpenGame(game)}
                                    onFocus={() => preloadGameModalAssetsThrottled(game)}
                                    onMouseEnter={() => preloadGameModalAssetsThrottled(game)}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setCollectionGameContextMenu({
                                        collection,
                                        game,
                                        visible: true,
                                        position: { x: event.clientX, y: event.clientY },
                                      });
                                    }}
                                  >
                                    <SidebarGameItem game={game} />
                                  </button>
                                </li>
                              ))}
                              {collection.games.length > SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT && (
                                <li className="sidebar__collection-more">
                                  +{collection.games.length - SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT}
                                </li>
                              )}
                            </>
                          ) : (
                            <li className="sidebar__collection-empty">
                              {t("sidebar.noGames")}
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                  })
                )}
                {hasCollectionSearchQuery && matchingCollectionGames.length === 0 && (
                  <li className="sidebar__collection-empty sidebar__collection-empty--search" role="status">
                    {t("sidebar.noMatchingGames")}
                  </li>
                )}
              </ul>
          </section>
        )}

        {!isModePage && collectionContextMenu.visible && (
          <ContextMenu
            x={collectionContextMenu.position.x}
            y={collectionContextMenu.position.y}
            items={[
              {
                label: "Renomear",
                icon: Pencil,
                onClick: () => {
                  setCollectionName(collectionContextMenu.collection?.name || "");
                  setShowRenameCollectionModal(true);
                  setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
                },
              },
              {
                label: "Excluir",
                icon: Trash,
                danger: true,
                onClick: () => {
                  const collectionId = collectionContextMenu.collection?.id;
                  const collectionName = collectionContextMenu.collection?.name ?? "";
                  if (
                    collectionId &&
                    collectionId !== FAVORITES_COLLECTION_ID &&
                    window.confirm(t("sidebar.deleteCollectionConfirm", { name: collectionName }))
                  ) {
                    onDeleteCollection?.(collectionId);
                  }
                  setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
                },
              },
            ]}
            onClose={() => setCollectionContextMenu((prev) => ({ ...prev, visible: false }))}
          />
        )}

        {!isModePage && collectionGameContextMenu.visible && collectionGameContextMenuItems.length > 0 && (
          <ContextMenu
            x={collectionGameContextMenu.position.x}
            y={collectionGameContextMenu.position.y}
            items={collectionGameContextMenuItems}
            onClose={() => setCollectionGameContextMenu((prev) => ({ ...prev, visible: false }))}
          />
        )}

        {isModePage && (
          <nav className="sidebar__section sidebar__section--footer">
            <ul className="sidebar__menu">
              <li className="sidebar__menu-item sidebar__mode-panel sidebar__mode-panel--forward sidebar__mode-panel--delayed">
                <button
                  type="button"
                  className="sidebar__menu-item-button sidebar__menu-item-button--back"
                  onClick={() => onBack()}
                >
                  <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true">
                    <path d="M13 4L7 10l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="sidebar__menu-item-label">{t("header.back")}</span>
                </button>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </aside>
  );
});

interface SidebarGameItemProps {
  game: GhostBoxGame;
}

const SidebarGameItem = memo(function SidebarGameItem({ game }: SidebarGameItemProps) {
  const { url: iconUrl, loading: iconLoading } = useGameIconUrl(game);
  return (
    <>
      {iconUrl ? (
        <img src={iconUrl} alt="" className="sidebar__game-icon" aria-hidden="true" />
      ) : iconLoading ? (
        <span className="sidebar__game-icon sidebar__game-icon--skeleton" aria-hidden="true" />
      ) : null}
      <span className="sidebar__collection-game-title">
        {game.title}
      </span>
    </>
  );
});

interface SidebarProfileProps {
  profile: SteamProfile | null;
  isCloudProfileRestoring: boolean;
  isActive: boolean;
  onOpenProfile: () => void;
}

const SidebarProfile = memo(function SidebarProfile({
  profile,
  isCloudProfileRestoring,
  isActive,
  onOpenProfile,
}: SidebarProfileProps) {
  const { appearance, t } = useSettings();
  const { account, connections, authenticatedVia, linkedSteamId, status } = useAuth();
  // The app stays mounted behind the login modal, and a Steam profile can
  // briefly outlive a sign-out (in-flight restores, leftover disk cache).
  // While anonymous the sidebar must never paint a profile.
  const visibleProfile = status === "anonymous" ? null : profile;
  const identity = resolveSidebarIdentity({
    status,
    account,
    connections,
    authenticatedVia,
    profile: visibleProfile,
    anonymousLabel: t("sidebar.profile.signIn"),
    loadingLabel: t("sidebar.profile.loading"),
    accountLabel: t("sidebar.profile.account"),
  });
  const avatarSources = useCachedImageSources(
    identity.avatarUrl ? [identity.avatarUrl] : []
  );
  const avatarSource = useLoadableImageSource(avatarSources);
  // Reopening the app paints the Steam summary (avatar + name) before the
  // account's cloud profile lands. While the cloud sync is in flight, hold
  // the placeholder avatar and no username instead of the provisional Steam
  // data — for any URL kind, not just non-custom ones.
  const isHoldingForCloudSync = Boolean(isCloudProfileRestoring);
  const [steamLevelResult, setSteamLevelResult] = useState<{
    steamId: string;
    level: number | null;
  } | null>(null);
  const connectedSteamId = status === "authenticated"
    ? linkedSteamId?.trim() || ""
    : "";
  const steamLevel = steamLevelResult?.steamId === connectedSteamId
    ? steamLevelResult.level
    : null;

  useEffect(() => {
    preloadProfileImages(visibleProfile);
  }, [visibleProfile?.avatarUrl, visibleProfile?.bannerUrl]);

  useEffect(() => {
    let cancelled = false;
    const steamId = connectedSteamId;
    if (!steamId) {
      setSteamLevelResult(null);
      return;
    }

    void (async () => {
      try {
        const level = await ghostboxApi.getSteamPlayerLevel(steamId);
        if (!cancelled) {
          setSteamLevelResult({
            steamId,
            level: typeof level === "number" && Number.isFinite(level) && level >= 0
              ? Math.floor(level)
              : null,
          });
        }
      } catch {
        if (!cancelled) setSteamLevelResult({ steamId, level: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectedSteamId]);

  const levelLabel =
    steamLevel === null
      ? appearance.language === "en"
        ? "Steam level unavailable"
        : "Nível Steam indisponível"
      : appearance.language === "en"
        ? `Level ${steamLevel}`
        : `Nível ${steamLevel}`;

  return (
    <div className="sidebar-profile">
      <button
        type="button"
        className={`sidebar-profile__button ${isActive ? "sidebar-profile__button--active" : ""}`}
        onClick={onOpenProfile}
        onMouseEnter={() => visibleProfile && preloadProfileImages(visibleProfile)}
        onFocus={() => visibleProfile && preloadProfileImages(visibleProfile)}
      >
        <div className="sidebar-profile__button-content">
          <span className="sidebar-profile__avatar" aria-hidden="true">
            {identity.loading || isHoldingForCloudSync ? (
              <span className="sidebar-profile__avatar-skeleton" />
            ) : (
              <img
                src={avatarSource || avatarPlaceholder}
                alt=""
                width={52}
                height={52}
                decoding="async"
                referrerPolicy="no-referrer"
              />
            )}
          </span>

          <span className="sidebar-profile__button-information">
            <span className="sidebar-profile__title-row">
              <span className="sidebar-profile__button-title">
                {isHoldingForCloudSync ? "" : identity.title}
              </span>
              {connectedSteamId ? (
                <span
                  className="sidebar-profile__level"
                  data-steam-level-tier={getSteamLevelColorTier(steamLevel)}
                  aria-label={levelLabel}
                >
                  <span className="sidebar-profile__level-value">
                    {steamLevel ?? ""}
                  </span>
                </span>
              ) : null}
            </span>
          </span>
        </div>
      </button>
    </div>
  );
});
