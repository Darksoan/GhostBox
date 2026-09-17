import { ChevronDown, Folder, Heart } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { UserCollection } from "../types";
import { GameGrid, GameGridLoadingState } from "../components/ui/GameCard";
import { EmptyState } from "../components/ui/LoadingStates";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { useAppData } from "../context/AppDataContext";
import { useSettings } from "../context/settings";
import { preloadGameListAssets } from "../utils/image";
import { normalizeGameSearchText } from "../utils/gameSearch";
import { sortLibraryGames } from "../utils/librarySort";
import {
  filterByLibrarySource,
  gameMatchesLibrarySourceFilter,
  type LibrarySourceFilter,
} from "../utils/librarySourceFilter";
import {
  readStoredLibrarySortBy,
  readStoredLibrarySourceFilter,
  writeStoredLibrarySortBy,
  writeStoredLibrarySourceFilter,
  type LibrarySortBy,
} from "../utils/storage";

const sortOptions: Array<{ value: LibrarySortBy; pt: string; en: string }> = [
  { value: "title", pt: "Título (A-Z)", en: "Title (A-Z)" },
  { value: "recent", pt: "Jogados Recentemente", en: "Recently Played" },
  { value: "playtime", pt: "Mais jogados", en: "Most Played" },
];

const sourceFilterOptions: Array<{
  value: LibrarySourceFilter;
  pt: string;
  en: string;
}> = [
  { value: "all", pt: "Todos", en: "All" },
  { value: "installed", pt: "Instalados", en: "Installed" },
  { value: "steam", pt: "Steam", en: "Steam" },
  { value: "ghostbox", pt: "Ghostbox", en: "Ghostbox" },
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
  const { refreshGameAchievements } = useAppData();
  const [sortBy, setSortBy] = useState<LibrarySortBy>(() =>
    readStoredLibrarySortBy(),
  );
  const [sourceFilter, setSourceFilter] = useState<LibrarySourceFilter>(() =>
    readStoredLibrarySourceFilter(),
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
  const hasFavorites = favoriteGames.length > 0 || favoriteGameIds.size > 0;
  const favoritesOnly = hasFavorites && selectedCollectionId === "favorites";
  const activeCollectionId =
    selectedCollectionId &&
    selectedCollectionId !== "favorites" &&
    userCollections.some((collection) => collection.id === selectedCollectionId)
      ? selectedCollectionId
      : null;
  const changeActiveCollection = useCallback(
    (collectionId: string | null) => {
      setInternalActiveCollectionId(collectionId);
      onActiveCollectionChange?.(collectionId);
    },
    [onActiveCollectionChange],
  );

  // Coleção apagada enquanto filtrava: o id sobrevive no estado do shell, que
  // também alimenta o perfil e o destaque da sidebar. Filtrar ignorando o id
  // morto não bastava — a seleção precisa ser desfeita de fato.
  useEffect(() => {
    if (!selectedCollectionId || selectedCollectionId === "favorites") return;
    if (!userCollections.length) return;
    if (userCollections.some((c) => c.id === selectedCollectionId)) return;
    changeActiveCollection(null);
  }, [changeActiveCollection, selectedCollectionId, userCollections]);

  const baseLibraryGames = useMemo(() => {
    // O filtro de origem (Todos/Instalados/Steam/Ghostbox) aplica primeiro e
    // compõe com favoritos/coleções via AND: quem filtra por coleção vê só os
    // jogos daquela coleção que também passam na origem selecionada.
    const sourceFilteredGames = filterByLibrarySource(
      visibleGames,
      sourceFilter,
    );
    // Favoritos FILTRAM o que já está na biblioteca. Coleções personalizadas,
    // por outro lado, exibem o jogo mesmo quando ele não está na biblioteca
    // (opção A): os jogos da coleção ausentes aqui são somados abaixo.
    const gamesByKey = new Map<string, GhostBoxGame>();
    sourceFilteredGames.forEach((game) => {
      gamesByKey.set(game.appId || game.id, game);
    });

    // A cópia guardada na coleção/favoritos só completa campos ausentes da
    // entrada da biblioteca; nunca cria entrada nova.
    const mergeDetails = (games: GhostBoxGame[]) => {
      games.forEach((game) => {
        const key = game.appId || game.id;
        const current = gamesByKey.get(key);
        if (current) gamesByKey.set(key, { ...game, ...current });
      });
    };

    let filteredGames = sourceFilteredGames;

    if (favoritesOnly) {
      mergeDetails(favoriteGames);
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
        mergeDetails(collectionGames);
        const collectionKeys = new Set<string>();
        collection.gameIds.forEach((gameId) =>
          addLibraryGameKey(collectionKeys, gameId),
        );
        collectionGames.forEach((game) => {
          for (const key of getLibraryGameKeys(game)) collectionKeys.add(key);
        });
        const libraryMatches = [...gamesByKey.values()].filter((game) =>
          gameMatchesLibraryKeys(game, collectionKeys),
        );
        // Opção A: a coleção exibe o jogo mesmo quando ele não está na
        // biblioteca. Antes a coleção só FILTRAVA a biblioteca, então um jogo
        // fora dela "sumia" ao ligar o chip da coleção.
        const seenKeys = new Set<string>();
        libraryMatches.forEach((game) => {
          for (const key of getLibraryGameKeys(game)) seenKeys.add(key);
        });
        const collectionOnlyGames = collectionGames.filter((game) => {
          if (!gameMatchesLibraryKeys(game, collectionKeys)) return false;
          for (const key of getLibraryGameKeys(game)) {
            if (seenKeys.has(key)) return false;
          }
          if (!gameMatchesLibrarySourceFilter(game, sourceFilter)) return false;
          for (const key of getLibraryGameKeys(game)) seenKeys.add(key);
          return true;
        });
        filteredGames = [...libraryMatches, ...collectionOnlyGames];
      }
    }

    // Busca da searchbar: filtra pelo que está sendo digitado (título,
    // sem acento/caixa/pontuação) e compõe via AND com origem + coleção.
    const normalizedQuery = normalizeGameSearchText(query ?? "");
    if (normalizedQuery) {
      const tokens = normalizedQuery.split(" ");
      filteredGames = filteredGames.filter((game) => {
        const title = normalizeGameSearchText(game.title ?? "");
        if (title.includes(normalizedQuery)) return true;
        if (title && tokens.every((token) => title.includes(token)))
          return true;
        const appId = game.appId?.trim() ?? "";
        if (appId && normalizedQuery.replace(/\s+/g, "") && appId.includes(normalizedQuery.replace(/\s+/g, "")))
          return true;
        return false;
      });
    }

    return sortLibraryGames(filteredGames, sortBy, language);
  }, [
    activeCollectionId,
    favoriteGameIds,
    favoriteGames,
    favoritesOnly,
    language,
    query,
    sortBy,
    sourceFilter,
    userCollections,
    visibleGames,
  ]);
  const libraryGames = useEnrichedGameCards(baseLibraryGames, 80, isActive);
  const sortLabel = useMemo(() => {
    const option = sortOptions.find((o) => o.value === sortBy);
    return option ? option[language] : option!.en;
  }, [language, sortBy]);
  const sourceLabel = useMemo(() => {
    const option = sourceFilterOptions.find((o) => o.value === sourceFilter);
    return option ? option[language] : option!.en;
  }, [language, sourceFilter]);

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortDropdownOpen && !sourceDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(target)
      ) {
        setSortDropdownOpen(false);
      }
      if (
        sourceDropdownRef.current &&
        !sourceDropdownRef.current.contains(target)
      ) {
        setSourceDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortDropdownOpen(false);
        setSourceDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortDropdownOpen, sourceDropdownOpen]);

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
    writeStoredLibrarySourceFilter(sourceFilter);
  }, [sourceFilter]);

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
              <ChevronDown size={16} />
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

          <div
            className={`settings-dropdown ${sourceDropdownOpen ? "settings-dropdown--open" : ""}`}
            ref={sourceDropdownRef}
          >
            <button
              type="button"
              className="settings-dropdown__trigger"
              aria-haspopup="listbox"
              aria-expanded={sourceDropdownOpen}
              onClick={() => setSourceDropdownOpen((current) => !current)}
            >
              <span>{sourceLabel}</span>
              <ChevronDown size={16} />
            </button>
            {sourceDropdownOpen && (
              <div
                className="settings-dropdown__menu"
                role="listbox"
                aria-label={language === "en" ? "Source" : "Origem"}
              >
                {sourceFilterOptions
                  .filter((option) => option.value !== sourceFilter)
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`settings-dropdown__option ${option.value === sourceFilter ? "settings-dropdown__option--active" : ""}`}
                      onClick={() => {
                        setSourceFilter(option.value);
                        setSourceDropdownOpen(false);
                      }}
                    >
                      <span>{option[language]}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="library-toolbar__chips">
            {hasFavorites && (
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
                <Heart size={16} strokeWidth={2.0} fill="none" />
                <span>{language === "en" ? "Favorites" : "Favoritos"}</span>
              </button>
            )}

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
                <Folder size={16} strokeWidth={2.0} />
                <span>{collection.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <GameGridLoadingState dense count={8} portrait libraryCoverFade />
      ) : libraryGames.length > 0 ? (
        <GameGrid
          games={libraryGames}
          onOpenGame={onOpenGame}
          onGameContextMenu={handleGameContextMenu}
          onHoverGame={refreshGameAchievements}
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
