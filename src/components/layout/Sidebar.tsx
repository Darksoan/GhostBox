import {
  ChevronLeft,
  ChevronRight,
  Folder,
  Heart,
  Home,
  Layers,
  LayoutGrid,
  LogOut,
  Pencil,
  RefreshCw,
  Settings,
  Trash,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { ContextMenu } from "../ui/ContextMenu";
import { useCollectionContextMenu } from "../../hooks/useCollectionContextMenu";
import { useGameIconUrl } from "../../hooks/useGameIconUrl";
import { settingsNavigationTabs, settingsTabLabelKeys, type SettingsTabId } from "../../features/settings/settingsTabsShared";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadGameModalAssets, preloadProfileImages } from "../../utils/image";

const navigation: { id: Page; icon: LucideIcon; labelKey: string }[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: LayoutGrid },
  { id: "library", labelKey: "nav.library", icon: Layers },
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
  isSteamSigningIn: boolean;
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  userCollections: UserCollection[];
  onNavigate: (page: Page, collectionId?: string) => void;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenGame: (game: GhostBoxGame) => void;
  onSteamSignIn: () => void;
  onSteamSignOut: () => void;
  onRestartSteam: () => void;
  onCreateCollection: () => void;
  onRemoveFavorite: (game: GhostBoxGame) => void;
  onRemoveGame: (game: GhostBoxGame) => void;
  onRemoveGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
  onDeleteCollection?: (collectionId: string) => void;
  favoriteGameIds?: Set<string>;
  libraryGameAppIds?: Set<string>;
  removableGameAppIds?: Set<string>;
  playableGameAppIds?: Set<string>;
  addingGameId?: string | null;
  launchingGameId?: string | null;
  onAddGame?: (game: GhostBoxGame) => void;
  onPlayGame?: (game: GhostBoxGame) => void;
  onAddGameToCollection?: (game: GhostBoxGame, collectionId: string) => void;
  onToggleFavorite?: (game: GhostBoxGame) => void;
  activeSettingsTabId: SettingsTabId;
  onSettingsTabChange: (tabId: SettingsTabId) => void;
}

const FAVORITES_COLLECTION_ID = "__favorites__";
const SIDEBAR_CURSOR_LOCK_MS = 700;
const SIDEBAR_COLLECTION_VISIBLE_GAME_LIMIT = 30;

let sidebarCursorLockTimeout: number | undefined;

function lockSidebarPointerCursor() {
  document.documentElement.classList.add("sidebar-cursor-lock");

  if (sidebarCursorLockTimeout) {
    window.clearTimeout(sidebarCursorLockTimeout);
  }

  sidebarCursorLockTimeout = window.setTimeout(() => {
    document.documentElement.classList.remove("sidebar-cursor-lock");
    sidebarCursorLockTimeout = undefined;
  }, SIDEBAR_CURSOR_LOCK_MS);
}

type SidebarCollection = {
  id: string;
  name: string;
  games: GhostBoxGame[];
};

export const Sidebar = memo(function Sidebar({
  activePage,
  activeCollectionId,
  steamProfile,
  isSteamSigningIn,
  favoriteGames,
  addedLibraryGames,
  userCollections,
  onNavigate,
  onBack,
  onOpenProfile,
  onOpenGame,
  onSteamSignIn,
  onSteamSignOut,
  onRestartSteam,
  onCreateCollection,
  onRemoveFavorite: _onRemoveFavorite,
  onRemoveGame,
  onRemoveGameFromCollection,
  onDeleteCollection,
  favoriteGameIds = new Set(),
  libraryGameAppIds = new Set(),
  removableGameAppIds = new Set(),
  playableGameAppIds = new Set(),
  addingGameId = null,
  launchingGameId = null,
  onAddGame,
  onPlayGame,
  onAddGameToCollection,
  onToggleFavorite,
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

  const collectionGameContextMenuItems = useCollectionContextMenu({
    game: collectionGameContextMenu.game,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onOpenGame,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onToggleFavorite,
    directFavoriteAction: true,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  });

  const sidebarCollections = useMemo<SidebarCollection[]>(() => {
    const gamesById = new Map(
      [
        ...userCollections.flatMap((collection) => collection.games ?? []),
        ...favoriteGames,
        ...addedLibraryGames,
      ].map((game) => [game.id, game])
    );

    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("profile.favorites"),
        games: favoriteGames,
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
  }, [addedLibraryGames, favoriteGames, userCollections, t]);

  const toggleCollectionExpanded = (collectionId: string) => {
    setExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  };

  const handleCollectionClick = (collection: SidebarCollection) => {
    if (collection.id === FAVORITES_COLLECTION_ID) {
      onNavigate("favorites", "favorites");
    } else {
      onNavigate("favorites", collection.id);
    }
  };

  return (
    <aside className="sidebar" onPointerDown={lockSidebarPointerCursor}>
      <div className="sidebar__content">
        <SidebarProfile
          profile={steamProfile}
          isSigningIn={isSteamSigningIn}
          isActive={activePage === "profile"}
          onOpenProfile={onOpenProfile}
          onSignIn={onSteamSignIn}
          onSignOut={onSteamSignOut}
        />

        {!isSettingsPage && (
          <nav className="sidebar__section sidebar__mode-panel">
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
                    <Icon size={18} strokeWidth={2.0} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
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
                    <Icon size={18} strokeWidth={2.0} />
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
                    <Icon size={18} strokeWidth={2.0} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {isSettingsPage && (
          <nav className="sidebar__section sidebar__mode-panel" aria-label="Tópicos de ajustes">
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
                    <Icon size={18} strokeWidth={2.0} />
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
              <ul className="sidebar__menu">
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
                      }`}
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
                            className={`sidebar__collection-chevron${isExpanded ? " sidebar__collection-chevron--expanded" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          className="sidebar__menu-item-button"
                          onClick={() => handleCollectionClick(collection)}
                        >
                          {isFavoritesCollection ? (
                            <Heart size={16} className="sidebar__collection-icon" />
                          ) : (
                            <Folder size={16} className="sidebar__collection-icon" />
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
                                    onFocus={() => preloadGameModalAssets(game)}
                                    onMouseEnter={() => preloadGameModalAssets(game)}
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
                  <ChevronLeft size={18} strokeWidth={2.0} />
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

function SidebarGameItem({ game }: SidebarGameItemProps) {
  const iconUrl = useGameIconUrl(game);
  return (
    <>
      {iconUrl && <img src={iconUrl} alt="" className="sidebar__game-icon" aria-hidden="true" />}
      <span>{game.title}</span>
    </>
  );
}

interface SidebarProfileProps {
  profile: SteamProfile | null;
  isSigningIn: boolean;
  isActive: boolean;
  onOpenProfile: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

const SidebarProfile = memo(function SidebarProfile({
  profile,
  isSigningIn,
  isActive,
  onOpenProfile,
  onSignIn,
  onSignOut,
}: SidebarProfileProps) {
  const avatarSources = useCachedImageSources(
    profile?.avatarUrl ? [profile.avatarUrl] : []
  );
  const avatarSource = useLoadableImageSource(avatarSources);

  const handleClick = () => {
    if (profile) {
      onOpenProfile();
      return;
    }

    onSignIn();
  };

  return (
    <div className="sidebar-profile">
      <button
        type="button"
        className={`sidebar-profile__button ${isActive ? "sidebar-profile__button--active" : ""}`}
        onClick={handleClick}
        onMouseEnter={() => profile && preloadProfileImages(profile)}
        onFocus={() => profile && preloadProfileImages(profile)}
        disabled={isSigningIn}
      >
        <div className="sidebar-profile__button-content">
          <span className="sidebar-profile__avatar" aria-hidden="true">
            {avatarSource ? (
              <img
                src={avatarSource}
                alt=""
                width={35}
                height={35}
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserRound size={24} />
            )}
          </span>

          <span className="sidebar-profile__button-information">
            <span className="sidebar-profile__button-title">
              {profile ? profile.displayName : isSigningIn ? "Entrando..." : "Entrar com Steam"}
            </span>
          </span>
        </div>
      </button>

      {profile && (
        <button
          type="button"
          className="sidebar-profile__sign-out"
          onClick={onSignOut}
          aria-label="Sair da conta Steam"
          title="Sair"
        >
          <LogOut size={15} />
        </button>
      )}
    </div>
  );
});
