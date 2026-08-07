import {
  ChevronRight,
  Download,
  Folder,
  Heart,
  Home,
  Layers,
  Pencil,
  RefreshCw,
  Settings,
  Trash,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useDeferredValue, useMemo, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { ContextMenu } from "../ui/ContextMenu";
import { useGameContextMenu } from "../../hooks/useGameContextMenu";
import { preloadGameIconUrls, useGameIconUrl } from "../../hooks/useGameIconUrl";
import { settingsNavigationTabs, settingsTabLabelKeys, type SettingsTabId } from "../../features/settings/settingsTabsShared";
import { useSettings } from "../../context/settings";
import { useAuth } from "../../context/AuthContext";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadGameModalAssetsThrottled, preloadProfileImages } from "../../utils/image";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { isSteamConnected } from "../../lib/steamProfile";
import { downloadTasksChangedEvent, getActiveDownloadCount } from "../../lib/downloadManager";
import { Grid } from "reicon-react";

type SidebarNavIcon = LucideIcon | typeof Grid;

const navigation: { id: Page; icon: SidebarNavIcon; labelKey: string }[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Layers },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
];

const sidebarFooterNavigation: { id: Page; icon: LucideIcon; labelKey: string }[] = [
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];

const sidebarExtraNavigation: { id: string; icon: LucideIcon; labelKey: string }[] = [
  { id: "restart-steam", labelKey: "sidebar.restartSteam", icon: RefreshCw },
];

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
  onRestartSteam: () => void;
  onCreateCollection: () => void;
  onRemoveFavorite: (game: GhostBoxGame) => void;
  onDeleteCollection?: (collectionId: string) => void;
  activeSessionAppIds?: Set<string>;
  activeSettingsTabId: SettingsTabId;
  onSettingsTabChange: (tabId: SettingsTabId) => void;
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
  onRestartSteam,
  onCreateCollection,
  onRemoveFavorite: _onRemoveFavorite,
  onDeleteCollection,
  activeSessionAppIds = new Set(),
  activeSettingsTabId,
  onSettingsTabChange,
}: SidebarProps) {
  const isSettingsPage = activePage === "settings";
  const [isCollectionsCollapsed, setIsCollectionsCollapsed] = useState(false);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(
    () => new Set([FAVORITES_COLLECTION_ID])
  );
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
    const gamesById = new Map(
      [
        ...userCollections.flatMap((collection) => collection.games ?? []),
        ...deferredFavoriteGames,
        ...deferredAddedLibraryGames,
      ].map((game) => [game.id, game])
    );

    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("profile.favorites"),
        games: deferredFavoriteGames,
      },
      ...userCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        games: collection.gameIds.flatMap((gameId) => {
          const game = gamesById.get(gameId);
          return game ? [game] : [];
        }),
      })),
    ];
  }, [deferredAddedLibraryGames, deferredFavoriteGames, userCollections, t]);

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
    const games = sidebarCollections.flatMap((collection) => {
      if (!expandedCollectionIds.has(collection.id)) return [];
      return collection.games.slice(0, SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT);
    });

    if (activeSessionGame) games.push(activeSessionGame);
    return games;
  }, [activeSessionGame, expandedCollectionIds, sidebarCollections]);

  useEffect(() => {
    preloadGameIconUrls(visibleSidebarIconGames);
  }, [visibleSidebarIconGames]);

  const [activeDownloadCount, setActiveDownloadCount] = useState(() => getActiveDownloadCount());

  useEffect(() => {
    const refresh = () => setActiveDownloadCount(getActiveDownloadCount());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, []);

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

  return (
    <aside className="sidebar">
      <div className="sidebar__content">
        <SidebarProfile
          profile={steamProfile}
          isCloudProfileRestoring={isCloudProfileRestoring}
          isActive={activePage === "profile"}
          onOpenProfile={onOpenProfile}
        />

        {!isSettingsPage && (
          <nav className="sidebar__section sidebar__mode-panel" >
            <ul className="sidebar__menu">
              {navigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                    {id === "downloads" && activeDownloadCount > 0 && (
                      <strong>{activeDownloadCount > 99 ? "99+" : activeDownloadCount}</strong>
                    )}
                  </button>
                </li>
              ))}
              {sidebarExtraNavigation.map(({ id, labelKey, icon: Icon }) => (
                <li key={id} className="sidebar__menu-item sidebar__mode-panel">
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onRestartSteam()}
                  >
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
              {sidebarFooterNavigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {isSettingsPage && (
          <nav className="sidebar__section sidebar__mode-panel" aria-label="Tópicos de ajustes" >
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
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(settingsTabLabelKeys[id])}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {!isSettingsPage && (
          <section className="sidebar__collapsible-section sidebar__mode-panel sidebar__mode-panel--delayed">
            <div className="sidebar__section-header">
              <button
                type="button"
                className="sidebar__section-toggle"
                aria-expanded={!isCollectionsCollapsed}
                onClick={() => setIsCollectionsCollapsed((c) => !c)}
                aria-label={isCollectionsCollapsed ? "Expandir coleções" : "Minimizar coleções"}
              >
                <ChevronRight
                  size={14}
                  strokeWidth={2.15}
                  className={`sidebar__section-toggle-chevron${!isCollectionsCollapsed ? " sidebar__section-toggle-chevron--expanded" : ""}`}
                />
                <small className="sidebar__section-title">{t("sidebar.collections")}</small>
              </button>
              <button
                type="button"
                className="sidebar__add-button"
                onClick={onCreateCollection}
                aria-label={t("profile.createCollection")}
              >
                <span className="sidebar__add-icon" aria-hidden="true" />
              </button>
            </div>
            {!isCollectionsCollapsed && (
              <ul className="sidebar__menu" >
                {sidebarCollections.map((collection) => {
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
                      activeCollectionId === collection.id) ||
                    (activePage === "profile" && activeCollectionId === collection.id);

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
                            size={14}
                            strokeWidth={2.15}
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
                })}
              </ul>
            )}
          </section>
        )}

        {!isSettingsPage && collectionContextMenu.visible && (
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
                  if (collectionId && collectionId !== FAVORITES_COLLECTION_ID) {
                    onDeleteCollection?.(collectionId);
                  }
                  setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
                },
              },
            ]}
            onClose={() => setCollectionContextMenu((prev) => ({ ...prev, visible: false }))}
          />
        )}

        {!isSettingsPage && collectionGameContextMenu.visible && collectionGameContextMenuItems.length > 0 && (
          <ContextMenu
            x={collectionGameContextMenu.position.x}
            y={collectionGameContextMenu.position.y}
            items={collectionGameContextMenuItems}
            onClose={() => setCollectionGameContextMenu((prev) => ({ ...prev, visible: false }))}
          />
        )}

        {isSettingsPage && (
          <nav className="sidebar__section sidebar__section--footer">
            <ul className="sidebar__menu">
              <li className="sidebar__menu-item sidebar__mode-panel">
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
      <span className="sidebar__collection-game-title" title={game.title}>
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
  const { appearance } = useSettings();
  const { account } = useAuth();
  const avatarSources = useCachedImageSources(
    profile?.avatarUrl ? [profile.avatarUrl] : []
  );
  const avatarSource = useLoadableImageSource(avatarSources);
  const shouldHoldSteamAvatar = Boolean(
    isCloudProfileRestoring &&
      profile?.avatarUrl &&
      !profile.avatarUrl.startsWith("data:") &&
      !profile.avatarUrl.includes("/storage/v1/object/public/profile-images/")
  );
  const [steamLevel, setSteamLevel] = useState<number | null>(null);

  useEffect(() => {
    preloadProfileImages(profile);
  }, [profile?.avatarUrl, profile?.bannerUrl]);

  useEffect(() => {
    let cancelled = false;
    const steamId = profile?.steamId?.trim();
    if (!steamId) {
      setSteamLevel(null);
      return;
    }

    void (async () => {
      try {
        const level = await ghostboxApi.getSteamPlayerLevel(steamId);
        if (
          !cancelled &&
          typeof level === "number" &&
          Number.isFinite(level) &&
          level >= 0
        ) {
          setSteamLevel(Math.floor(level));
        }
      } catch {
        if (!cancelled) setSteamLevel(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.steamId]);

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
        onMouseEnter={() => profile && preloadProfileImages(profile)}
        onFocus={() => profile && preloadProfileImages(profile)}
      >
        <div className="sidebar-profile__button-content">
          <span className="sidebar-profile__avatar" aria-hidden="true">
            {shouldHoldSteamAvatar || (isCloudProfileRestoring && !avatarSource) ? (
              <span className="sidebar-profile__avatar-skeleton" />
            ) : avatarSource ? (
              <img
                src={avatarSource}
                alt=""
                width={52}
                height={52}
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserRound size={24} />
            )}
          </span>

          <span className="sidebar-profile__button-information">
            <span className="sidebar-profile__title-row">
              <span className="sidebar-profile__button-title">
                {profile?.displayName || account?.displayName || account?.username || ""}
              </span>
              {isSteamConnected(profile) ? (
                <span
                  className="sidebar-profile__level"
                  title={levelLabel}
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
