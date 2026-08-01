import { ChevronLeft, Folder, Heart } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { UserCollection } from "../types";
import { GameGrid, GameGridLoadingState } from "../components/ui/GameCard";
import { EmptyState } from "../components/ui/LoadingStates";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { useSettings } from "../context/settings";
import { preloadGameListAssets } from "../utils/image";
import { sortLibraryGames } from "../utils/librarySort";
import {
  readStoredLibrarySortBy,
  writeStoredLibrarySortBy,
  type LibrarySortBy,
} from "../utils/storage";

const sortOptions: Array<{ value: LibrarySortBy; pt: string; en: string }> = [
  { value: "title", pt: "Título (A-Z)", en: "Title (A-Z)" },
  { value: "recent", pt: "Jogados Recentemente", en: "Recently Played" },
  { value: "playtime", pt: "Mais jogados", en: "Most Played" },
];

function addLibraryGameKey(
  keys: Set<string>,
  value: string | null | undefined,
) {
  const key = value?.trim();
  if (!key) return;

  keys.add(key);

  const appId = key.replace(/^steam-/, "");
  if (/^\d+$/.test(appId)) {
    keys.add(appId);
    keys.add(`steam-${appId}`);
  }
}

function getLibraryGameKeys(game: GhostBoxGame) {
  const keys = new Set<string>();
  addLibraryGameKey(keys, game.id);
  addLibraryGameKey(keys, game.appId);
  return keys;
}

function gameMatchesLibraryKeys(game: GhostBoxGame, keys: Set<string>) {
  for (const key of getLibraryGameKeys(game)) {
    if (keys.has(key)) return true;
  }

  return false;
}

interface LibraryPageProps {
  games: GhostBoxGame[];
  favoriteGames?: GhostBoxGame[];
  loading: boolean;
  query: string;
  onOpenGame: (game: GhostBoxGame) => void;
  favoriteGameIds?: Set<string>;
  userCollections?: UserCollection[];
  activeCollectionId?: string | null;
  onActiveCollectionChange?: (collectionId: string | null) => void;
  activeSessionAppIds?: Set<string>;
  isActive?: boolean;
}

export function LibraryPage({
  games: visibleGames,
  favoriteGames = [],
  loading,
  query,
  onOpenGame,
  favoriteGameIds = new Set(),
  userCollections = [],
  activeCollectionId: propActiveCollectionId,
  onActiveCollectionChange,
  activeSessionAppIds = new Set(),
  isActive = true,
}: LibraryPageProps) {
  const { appearance } = useSettings();
  const [sortBy, setSortBy] = useState<LibrarySortBy>(() =>
    readStoredLibrarySortBy(),
  );
  const [internalActiveCollectionId, setInternalActiveCollectionId] = useState<
    string | null
  >(null);
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);
  const language = appearance.language;
  const selectedCollectionId =
    propActiveCollectionId === undefined
      ? internalActiveCollectionId
      : propActiveCollectionId === "library"
        ? null
        : propActiveCollectionId;
  const favoritesOnly = selectedCollectionId === "favorites";
  const activeCollectionId =
    selectedCollectionId &&
    selectedCollectionId !== "favorites" &&
    userCollections.some((collection) => collection.id === selectedCollectionId)
      ? selectedCollectionId
      : null;
  const changeActiveCollection = (collectionId: string | null) => {
    setInternalActiveCollectionId(collectionId);
    onActiveCollectionChange?.(collectionId);
  };

  const baseLibraryGames = useMemo(() => {
    const gamesByKey = new Map<string, GhostBoxGame>();
    const addGames = (games: GhostBoxGame[]) => {
      games.forEach((game) => {
        const key = game.appId || game.id;
        const current = gamesByKey.get(key);
        gamesByKey.set(key, current ? { ...game, ...current } : game);
      });
    };
    addGames(visibleGames);

    let filteredGames = visibleGames;

    if (favoritesOnly) {
      addGames(favoriteGames);
      const favoriteKeys = new Set<string>();
      favoriteGameIds.forEach((gameId) =>
        addLibraryGameKey(favoriteKeys, gameId),
      );
      favoriteGames.forEach((game) => {
        for (const key of getLibraryGameKeys(game)) favoriteKeys.add(key);
      });
      filteredGames = [...gamesByKey.values()].filter((game) =>
        gameMatchesLibraryKeys(game, favoriteKeys),
      );
    } else if (activeCollectionId) {
      const collection = userCollections.find(
        (c) => c.id === activeCollectionId,
      );
      if (collection) {
        const collectionGames = collection.games ?? [];
        addGames(collectionGames);
        const collectionKeys = new Set<string>();
        collection.gameIds.forEach((gameId) =>
          addLibraryGameKey(collectionKeys, gameId),
        );
        collectionGames.forEach((game) => {
          for (const key of getLibraryGameKeys(game)) collectionKeys.add(key);
        });
        filteredGames = [...gamesByKey.values()].filter((game) =>
          gameMatchesLibraryKeys(game, collectionKeys),
        );
      }
    }

    return sortLibraryGames(filteredGames, sortBy, language);
  }, [
    activeCollectionId,
    favoriteGameIds,
    favoriteGames,
    favoritesOnly,
    language,
    sortBy,
    userCollections,
    visibleGames,
  ]);
  const libraryGames = useEnrichedGameCards(baseLibraryGames, 80, isActive);
  const sortLabel = useMemo(() => {
    const option = sortOptions.find((o) => o.value === sortBy);
    return option ? option[language] : option!.en;
  }, [language, sortBy]);

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setSortDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortDropdownOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortDropdownOpen]);

  const handleGameContextMenu = useCallback((game: GhostBoxGame, x: number, y: number) => {
    setContextMenu({ game, x, y });
  }, []);

  const collectionContextMenuItems = useGameContextMenu({
    game: contextMenu?.game ?? null,
    onOpenGame,
    directFavoriteAction: true,
  });

  useEffect(() => {
    writeStoredLibrarySortBy(sortBy);
  }, [sortBy]);

  useEffect(() => {
    if (isActive && !loading)
      preloadGameListAssets(libraryGames, {
        variant: "portrait",
        limit: 12,
        details: true,
        detailsLimit: 8,
      });
  }, [isActive, libraryGames, loading]);

  return (
    <section className="content-section content-section--full content-section--library">
      <div
        className="library-toolbar"
        aria-label={
          language === "en" ? "Library filters" : "Filtros da biblioteca"
        }
      >
        <div className="library-toolbar__row">
          <div
            className={`settings-dropdown ${sortDropdownOpen ? "settings-dropdown--open" : ""}`}
            ref={sortDropdownRef}
          >
            <button
              type="button"
              className="settings-dropdown__trigger"
              aria-haspopup="listbox"
              aria-expanded={sortDropdownOpen}
              onClick={() => setSortDropdownOpen((current) => !current)}
            >
              <span>{sortLabel}</span>
              <ChevronLeft size={14} />
            </button>
            {sortDropdownOpen && (
              <div
                className="settings-dropdown__menu"
                role="listbox"
                aria-label={language === "en" ? "Sort by" : "Ordenar por"}
              >
                {sortOptions
                  .filter((option) => option.value !== sortBy)
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`settings-dropdown__option ${option.value === sortBy ? "settings-dropdown__option--active" : ""}`}
                      onClick={() => {
                        setSortBy(option.value);
                        setSortDropdownOpen(false);
                      }}
                    >
                      <span>{option[language]}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="library-toolbar__chips">
            <button
              type="button"
              className={
                favoritesOnly
                  ? "library-chip library-chip--active"
                  : "library-chip"
              }
              aria-pressed={favoritesOnly}
              onClick={() => {
                changeActiveCollection(
                  selectedCollectionId === "favorites" ? null : "favorites"
                );
              }}
            >
              <Heart size={15} strokeWidth={2.0} fill="none" />
              <span>{language === "en" ? "Favorites" : "Favoritos"}</span>
            </button>

            {userCollections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={
                  activeCollectionId === collection.id
                    ? "library-chip library-chip--active"
                    : "library-chip"
                }
                aria-pressed={activeCollectionId === collection.id}
                onClick={() => {
                  changeActiveCollection(
                    selectedCollectionId === collection.id
                      ? null
                      : collection.id,
                  );
                }}
              >
                <Folder size={15} strokeWidth={2.0} />
                <span>{collection.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <GameGridLoadingState dense count={8} portrait showAchievements libraryCoverFade />
      ) : libraryGames.length > 0 ? (
        <GameGrid
          games={libraryGames}
          onOpenGame={onOpenGame}
          onGameContextMenu={handleGameContextMenu}
          dense
          portrait
          showAchievements
          activeSessionAppIds={activeSessionAppIds}
          libraryCoverFade
          animateLayout
        />
      ) : (
        <EmptyState query={query} />
      )}

      {contextMenu && collectionContextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={collectionContextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}
