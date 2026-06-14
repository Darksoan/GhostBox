import { ChevronLeft, Bell, Heart, Search } from "lucide-react";
import { memo, useState, useCallback } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page } from "../../types";
import { useSettings } from "../../context/settings";
import { preloadGameModalAssets } from "../../utils/image";

const HighlightedSearchText = memo(function HighlightedSearchText({
  text,
}: {
  text: string;
}) {
  return <>{text}</>;
});

interface HeaderProps {
  page: Page;
  title?: string;
  canGoBack?: boolean;
  query: string;
  isSearching: boolean;
  suggestions: GhostBoxGame[];
  allowSearchDropdown?: boolean;
  favoriteGameIds?: Set<string>;
  addedGameAppIds?: Set<string>;
  onQueryChange: (query: string) => void;
  onSelectSuggestion: (game: GhostBoxGame) => void;
  onBack: () => void;
  onNavigateToNotifications?: () => void;
}

export const Header = memo(function Header({
  page,
  title,
  canGoBack,
  query,
  isSearching,
  suggestions,
  allowSearchDropdown = false,
  favoriteGameIds = new Set(),
  addedGameAppIds = new Set(),
  onQueryChange,
  onSelectSuggestion,
  onBack,
  onNavigateToNotifications,
}: HeaderProps) {
  const { t } = useSettings();
  const [focused, setFocused] = useState(false);
  const hasBackButton = canGoBack ?? page !== "home";
  const showDropdown =
    (page !== "catalogue" || allowSearchDropdown) &&
    focused &&
    Boolean(query.trim()) &&
    (suggestions.length > 0 || isSearching);

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !event.currentTarget.contains(nextTarget))
        setFocused(false);
    },
    []
  );

  const handleFocus = useCallback(() => setFocused(true), []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onQueryChange(event.target.value),
    [onQueryChange]
  );

  return (
    <header className="header">
      <div className="header__section header__section--left">
        <button
          type="button"
          className={`header__back-button ${hasBackButton ? "header__back-button--enabled" : ""}`}
          onClick={onBack}
          aria-label={t("header.back")}
        >
          <ChevronLeft size={18} />
        </button>
        <h2
          className={`header__title ${hasBackButton ? "header__title--has-back-button" : ""}`}
        >
          {title ?? t(`header.${page}`)}
        </h2>
      </div>

      <div className="header__section">
        <button
          type="button"
          className="header__notification-button"
          aria-label={t("header.notifications")}
          onClick={onNavigateToNotifications}
        >
          <Bell size={18} />
        </button>
        <div
          className="header__search-shell"
          onBlur={handleBlur}
        >
          <label
            className={`header__search ${focused ? "header__search--focused" : ""} ${isSearching ? "header__search--loading" : ""}`}
          >
            <Search size={16} />
            <input
              value={query}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder={t("header.searchPlaceholder")}
            />
            {isSearching && (
              <span className="header__search-loader" aria-hidden="true" />
            )}
          </label>

          {showDropdown && (
            <div className="header__search-dropdown">
              {suggestions.length > 0 ? (
                <ul className="header__search-dropdown-list">
                  {suggestions.map((game) => {
                    const isFavorite = favoriteGameIds.has(game.id);
                    const isAdded = addedGameAppIds.has(game.appId);
                    return (
                      <li key={game.id}>
                        <button
                          type="button"
                          className="header__search-dropdown-item"
                          onMouseDown={(event) => event.preventDefault()}
                          onFocus={() => preloadGameModalAssets(game)}
                          onMouseEnter={() => preloadGameModalAssets(game)}
                          onClick={() => {
                            setFocused(false);
                            onSelectSuggestion(game);
                          }}
                        >
                          <span>
                            <HighlightedSearchText
                              text={game.title}
                            />
                          </span>
                          <div className="header__search-dropdown-item__icons">
                            {isAdded && (
                              <Heart
                                size={14}
                                fill={isFavorite ? "#d3d3d3" : "none"}
                                stroke={isFavorite ? "#d3d3d3" : "currentColor"}
                              />
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="header__search-dropdown-loading">
                  {t("header.searching")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
});
