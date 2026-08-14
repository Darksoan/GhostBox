import { memo, useMemo, useState } from "react";
import { ChevronRight, Folder, Heart, Plus, Trash2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";

export const FAVORITES_GROUP_ID = "favorites";
export const UNCATEGORIZED_GROUP_ID = "__uncategorized__";

interface LibraryPanelProps {
  collections: UserCollection[];
  favoriteGames: GhostBoxGame[];
  uncategorizedCount: number;
  activeCollectionId: string | null;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (collectionId: string) => void;
  onOpenGame: (game: GhostBoxGame) => void;
}

interface PanelGroup {
  id: string;
  name: string;
  count: number;
  games: GhostBoxGame[];
  removable: boolean;
}

export const LibraryPanel = memo(function LibraryPanel({
  collections,
  favoriteGames,
  uncategorizedCount,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  onOpenGame,
}: LibraryPanelProps) {
  const { t, appearance } = useSettings();
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [search, setSearch] = useState("");

  const language = appearance.language;

  // Favoritos primeiro, coleções do usuário no meio, "sem categoria" por
  // último — os dois das pontas são derivados e não podem ser excluídos.
  const groups = useMemo<PanelGroup[]>(() => {
    const list: PanelGroup[] = [
      {
        id: FAVORITES_GROUP_ID,
        name: t("profile.favorites"),
        count: favoriteGames.length,
        games: favoriteGames,
        removable: false,
      },
      ...collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: collection.gameIds.length,
        games: collection.games ?? [],
        removable: true,
      })),
      {
        id: UNCATEGORIZED_GROUP_ID,
        name: language === "en" ? "Uncategorized" : "Sem categoria",
        count: uncategorizedCount,
        games: [],
        removable: false,
      },
    ];

    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((group) => group.name.toLowerCase().includes(term));
  }, [collections, favoriteGames, language, search, t, uncategorizedCount]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const sortGames = (games: GhostBoxGame[]) =>
    [...games].sort((a, b) => a.title.localeCompare(b.title, language));

  return (
    <aside className="library-panel" aria-label={t("nav.library")}>
      <header className="library-panel__header">
        <button
          type="button"
          className={`library-panel__home${
            activeCollectionId === null ? " library-panel__home--active" : ""
          }`}
          onClick={() => onSelectCollection(null)}
        >
          {language === "en" ? "Home" : "Página inicial"}
        </button>
      </header>

      <input
        type="search"
        className="library-panel__search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={language === "en" ? "Search" : "Buscar"}
        aria-label={language === "en" ? "Search collections" : "Buscar coleções"}
      />

      <div className="library-panel__groups">
        {groups.map((group) => {
          const isExpanded = expandedGroupIds.has(group.id);
          const isActive = activeCollectionId === group.id;

          return (
            <section key={group.id} className="library-panel__group">
              <div className="library-panel__group-row">
                <button
                  type="button"
                  className="library-panel__group-toggle"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isExpanded}
                  aria-label={group.name}
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={`library-panel__chevron${
                      isExpanded ? " library-panel__chevron--expanded" : ""
                    }`}
                  />
                </button>

                <button
                  type="button"
                  className={`library-panel__group-button${
                    isActive ? " library-panel__group-button--active" : ""
                  }`}
                  onClick={() => onSelectCollection(isActive ? null : group.id)}
                  aria-current={isActive ? "true" : undefined}
                >
                  {group.id === FAVORITES_GROUP_ID ? (
                    <Heart size={16} strokeWidth={2} />
                  ) : (
                    <Folder size={16} strokeWidth={2} />
                  )}
                  <span className="library-panel__group-name">{group.name}</span>
                  <span className="library-panel__group-count">
                    ({group.count})
                  </span>
                </button>

                {group.removable && (
                  <button
                    type="button"
                    className="library-panel__group-remove"
                    onClick={() => onDeleteCollection(group.id)}
                    aria-label={`${
                      language === "en" ? "Delete" : "Excluir"
                    } ${group.name}`}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                )}
              </div>

              {isExpanded && group.games.length > 0 && (
                <ul className="library-panel__games">
                  {sortGames(group.games).map((game) => (
                    <li key={game.id}>
                      <button
                        type="button"
                        className="library-panel__game"
                        onClick={() => onOpenGame(game)}
                        title={game.title}
                      >
                        {game.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <button
        type="button"
        className="library-panel__create"
        onClick={onCreateCollection}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        <span>{language === "en" ? "New collection" : "Criar coleção"}</span>
      </button>
    </aside>
  );
});
