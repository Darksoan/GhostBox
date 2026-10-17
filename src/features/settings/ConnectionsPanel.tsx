import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownAZ,
  Check,
  Copy,
  EyeOff,
  Link2,
  Loader2,
} from "lucide-react";
import { AngleRight2 as AngleRight } from "reicon-react";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import {
  useCachedImageSources,
  useLoadableImageState,
} from "../../hooks/useCachedImageSources";
import { useDiscordLink } from "./useDiscordLink";
import { isSteamConnected } from "../../lib/steamProfile";
import {
  filterAndSortHiddenProfileGames,
  getHiddenProfileGameInitial,
} from "../../utils/hiddenProfileGames";
import { gameCatalogueHeaderSources } from "../../utils/image";
import { buildSteamOwnedGamesFromPlaytimes } from "../../utils/steamLibraryMerge";
import { applySteamAppTypes, filterOutSteamDemos } from "../../utils/steamAppType";
import { useSteamAppTypes } from "../../hooks/useSteamAppTypes";
import steamIcon from "../../../Icons/steam-glyph.svg";
import discordIcon from "../../../Icons/discord.svg";
import "./ConnectionsPanel.scss";

const PROFILE_GAME_ALPHABET = Array.from(
  { length: 26 },
  (_, index) => String.fromCharCode(65 + index),
);

function HiddenProfileGameHeader({
  sources,
  title,
  hidden,
  onToggle,
}: {
  sources: string[];
  title: string;
  hidden: boolean;
  onToggle: () => void;
}) {
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoadImage, setShouldLoadImage] = useState(false);
  const cachedSources = useCachedImageSources(shouldLoadImage ? sources : []);
  const image = useLoadableImageState(cachedSources);

  useEffect(() => {
    if (shouldLoadImage) return;
    const item = itemRef.current;
    if (!item) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoadImage(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadImage(true);
          observer.disconnect();
        }
      },
      { rootMargin: "360px 0px", threshold: 0.01 },
    );

    observer.observe(item);
    return () => observer.disconnect();
  }, [shouldLoadImage]);

  return (
    <button
      ref={itemRef}
      type="button"
      role="checkbox"
      aria-checked={hidden}
      aria-label={title}
      className={`hidden-profile-games__item${hidden ? " hidden-profile-games__item--selected" : ""}`}
      onClick={onToggle}
    >
      {image.loaded && image.source && (
        <img
          src={image.source}
          alt=""
          decoding="async"
          draggable={false}
        />
      )}
      <EyeOff size={24} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

export function ConnectionsPanel() {
  const { t } = useSettings();
  const {
    steamProfile,
    isSteamSigningIn,
    handleConnectSteam,
    handleDisconnectSteam,
  } = useAppData();
  const steamConnected = isSteamConnected(steamProfile);
  const discord = useDiscordLink();
  const [confirmingSteamDisconnect, setConfirmingSteamDisconnect] = useState(false);
  const [disconnectingSteam, setDisconnectingSteam] = useState(false);
  const [steamIdCopied, setSteamIdCopied] = useState(false);
  /** Set when the worker refuses an unlink because it is the account's last
   * connection. Linking is mandatory server-side, so the refusal is final —
   * the warning just explains why. */
  const [lastConnectionBlocked, setLastConnectionBlocked] = useState(false);

  useEffect(() => {
    if (!confirmingSteamDisconnect) return;
    const timeout = window.setTimeout(() => setConfirmingSteamDisconnect(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [confirmingSteamDisconnect]);

  useEffect(() => {
    if (!steamIdCopied) return;
    const timeout = window.setTimeout(() => setSteamIdCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [steamIdCopied]);

  async function onCopySteamIdClick(steamId: string) {
    await navigator.clipboard.writeText(steamId);
    setSteamIdCopied(true);
  }

  async function onDisconnectSteamClick() {
    if (!confirmingSteamDisconnect) {
      setConfirmingSteamDisconnect(true);
      return;
    }
    setConfirmingSteamDisconnect(false);
    setDisconnectingSteam(true);
    try {
      await handleDisconnectSteam();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("last_connection")) {
        setLastConnectionBlocked(true);
        return;
      }
      throw error;
    } finally {
      setDisconnectingSteam(false);
    }
  }

  /**
   * The worker refuses to unlink the account's last provider outright — that
   * link IS the sign-in now. The refusal is final; the warning explains it.
   */
  async function onDisconnectDiscordClick() {
    try {
      await discord.disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("last_connection")) {
        setLastConnectionBlocked(true);
        return;
      }
      throw error;
    }
  }

  return (
    <div className="connections-panel">
      <header className="connections-panel__header">
        <h2>{t("settings.connections.title")}</h2>
        <p>{t("settings.connections.description")}</p>
      </header>

      <div className="connections-panel__list">
        {lastConnectionBlocked && (
          <p className="connection-card__warning" role="alert">
            {t("settings.connections.lastConnectionWarning")}
          </p>
        )}
        <div className="connections-panel__steam-group">
          <section className="connection-card">
            <img className="connection-card__icon" src={steamIcon} alt="" aria-hidden="true" />
            <div className="connection-card__body">
              <h3>{t("settings.connections.steam.title")}</h3>
              {!steamConnected && <p>{t("settings.connections.steam.description")}</p>}
              {steamConnected && steamProfile ? (
                <div className="connection-card__connected">
                  <span>
                    {t("settings.connections.steam.connectedAsPrefix")}
                    <span className="connection-card__connected-name">{steamProfile.displayName}</span>
                    {t("settings.connections.steam.connectedAsSuffix")}
                  </span>
                  <button
                    type="button"
                    className={`connection-card__copy${steamIdCopied ? " connection-card__copy--copied" : ""}`}
                    onClick={() => void onCopySteamIdClick(steamProfile.steamId)}
                    aria-label={
                      steamIdCopied
                        ? t("settings.connections.steam.copiedId")
                        : t("settings.connections.steam.copyId")
                    }
                  >
                    <span className="connection-card__copy-icon connection-card__copy-icon--copy">
                      <Copy size={14} aria-hidden="true" />
                    </span>
                    <span className="connection-card__copy-icon connection-card__copy-icon--check">
                      <Check size={14} aria-hidden="true" />
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="connection-card__actions">
              {steamConnected ? (
                <button
                  type="button"
                  className={`connection-card__button connection-card__button--danger${
                    confirmingSteamDisconnect ? " connection-card__button--confirming" : ""
                  }`}
                  onClick={() => void onDisconnectSteamClick()}
                  disabled={disconnectingSteam}
                >
                  {disconnectingSteam ? (
                    <Loader2 size={14} className="connection-card__spinner" aria-hidden="true" />
                  ) : null}
                  {disconnectingSteam
                    ? t("settings.connections.steam.disconnecting")
                    : confirmingSteamDisconnect
                      ? t("settings.connections.steam.disconnectConfirm")
                      : t("settings.connections.steam.disconnect")}
                </button>
              ) : (
                <button
                  type="button"
                  className="connection-card__button connection-card__button--primary"
                  onClick={() => void handleConnectSteam()}
                  disabled={isSteamSigningIn}
                >
                  {isSteamSigningIn ? (
                    <Loader2 size={14} className="connection-card__spinner" aria-hidden="true" />
                  ) : (
                    <Link2 size={14} aria-hidden="true" />
                  )}
                  {isSteamSigningIn
                    ? t("settings.connections.steam.connecting")
                    : t("settings.connections.steam.connect")}
                </button>
              )}
            </div>
          </section>

        </div>

        <section className="connection-card">
          <img className="connection-card__icon" src={discordIcon} alt="" aria-hidden="true" />
          <div className="connection-card__body">
            <h3>{t("settings.connections.discord.title")}</h3>
            {!discord.status?.linked && <p>{t("settings.connections.discord.description")}</p>}
            {discord.status?.linked ? (
              <div className="connection-card__connected">
                <span>
                  {t("settings.connections.discord.connectedAsPrefix")}
                  <span className="connection-card__connected-name">
                    {discord.status.discordGlobalName || discord.status.discordUsername}
                  </span>
                  {t("settings.connections.discord.connectedAsSuffix")}
                </span>
              </div>
            ) : null}
          </div>
          <div className="connection-card__actions">
            {discord.status?.linked ? (
              <button
                type="button"
                className="connection-card__button connection-card__button--danger"
                onClick={() => void onDisconnectDiscordClick()}
                disabled={discord.busy}
              >
                {discord.busy ? (
                  <Loader2 size={14} className="connection-card__spinner" aria-hidden="true" />
                ) : null}
                {discord.busy
                  ? t("settings.connections.discord.disconnecting")
                  : t("settings.connections.discord.disconnect")}
              </button>
            ) : (
              <button
                type="button"
                className="connection-card__button connection-card__button--primary"
                onClick={() => void discord.connect()}
                disabled={discord.busy}
              >
                {discord.busy ? (
                  <Loader2 size={14} className="connection-card__spinner" aria-hidden="true" />
                ) : (
                  <Link2 size={14} aria-hidden="true" />
                )}
                {discord.busy
                  ? t("settings.connections.discord.connecting")
                  : t("settings.connections.discord.connect")}
              </button>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

export function SteamVisibilitySection({
  onOpenHiddenGames,
}: {
  onOpenHiddenGames: () => void;
}) {
  const { t } = useSettings();
  const {
    steamProfile,
    showSteamGames,
    setShowSteamGames,
    showSteamLibraryGames,
    setShowSteamLibraryGames,
  } = useAppData();
  const steamConnected = isSteamConnected(steamProfile);
  const steamVisibilityLabelId = useId();
  const steamVisibilityDescId = useId();
  const steamLibraryLabelId = useId();
  const steamLibraryDescId = useId();

  return (
    <div className="steam-library-profile-options">
      <div
        className={`connection-card__steam-options${
          steamConnected ? "" : " connection-card__steam-options--disabled"
        }`}
      >
        <div className="connection-card__steam-option">
        <div className="connection-card__steam-option-copy">
          <strong id={steamVisibilityLabelId}>{t("settings.connections.steam.showOnProfile")}</strong>
          <span id={steamVisibilityDescId}>{t("settings.connections.steam.showOnProfileDescription")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showSteamGames}
          aria-labelledby={steamVisibilityLabelId}
          aria-describedby={steamVisibilityDescId}
          disabled={!steamConnected}
          className={`settings-switch${showSteamGames ? " settings-switch--on" : ""}${
            !steamConnected ? " settings-switch--disabled" : ""
          }`}
          onClick={() => {
            if (!steamConnected) return;
            setShowSteamGames(!showSteamGames);
          }}
        >
          <span />
        </button>
        </div>

        <div className="connection-card__steam-option">
        <div className="connection-card__steam-option-copy">
          <strong id={steamLibraryLabelId}>{t("settings.connections.steam.showInLibrary")}</strong>
          <span id={steamLibraryDescId}>{t("settings.connections.steam.showInLibraryDescription")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showSteamLibraryGames}
          aria-labelledby={steamLibraryLabelId}
          aria-describedby={steamLibraryDescId}
          className={`settings-switch${showSteamLibraryGames ? " settings-switch--on" : ""}`}
          onClick={() => {
            setShowSteamLibraryGames(!showSteamLibraryGames);
          }}
        >
          <span />
        </button>
        </div>
      </div>

      <button
        type="button"
        className="hidden-profile-games-link"
        onClick={onOpenHiddenGames}
      >
        <span className="hidden-profile-games__copy">
          <strong>{t("settings.library.hiddenProfileGames.label")}</strong>
          <span>{t("settings.library.hiddenProfileGames.description")}</span>
        </span>
        <AngleRight size={22} className="ui-icon--22" weight="Outline" aria-hidden="true" />
      </button>
    </div>
  );
}

export function HiddenProfileGamesSection({
  searchQuery,
  onClearSearchQuery,
}: {
  searchQuery: string;
  onClearSearchQuery: () => void;
}) {
  const { t } = useSettings();
  const {
    hiddenProfileGameIds,
    setProfileGameHidden,
    profileAddedLibraryGames,
    profileFavoriteGames,
    profileHistoryGames,
    steamAccountStats,
  } = useAppData();
  const [selectedInitial, setSelectedInitial] = useState("");
  const [hoveredAlphabetIndex, setHoveredAlphabetIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!searchQuery.trim()) return;
    setSelectedInitial("");
    setHoveredAlphabetIndex(null);
  }, [searchQuery]);
  // A ordem é uma fotografia do momento em que a subaba foi aberta. Alterar a
  // visibilidade atualiza o card imediatamente, mas só reagrupa na próxima entrada.
  const entryHiddenGameIdsRef = useRef(new Set(hiddenProfileGameIds));
  const titleId = useId();
  const rawOwnedGames = useMemo(
    () => buildSteamOwnedGamesFromPlaytimes(steamAccountStats?.ownedPlaytimes ?? [], {}),
    [steamAccountStats?.ownedPlaytimes],
  );
  const ownedAppTypes = useSteamAppTypes(rawOwnedGames, true);
  const visibleOwnedGames = useMemo(
    () => filterOutSteamDemos(applySteamAppTypes(rawOwnedGames, ownedAppTypes)),
    [ownedAppTypes, rawOwnedGames],
  );
  const allGames = useMemo(() => {
    // Espelha o Perfil>Geral (que espelha a Biblioteca): todo owned + GhostBox,
    // sem exigir evidência (playtime/conquista/backup) e sem pular títulos
    // placeholder — jogos 0/X ou nunca jogados continuam ocultáveis.
    const uniqueGames = new Map<
      string,
      { appId: string; title: string; sources: string[] }
    >();
    const candidates = [
      ...profileAddedLibraryGames,
      ...profileFavoriteGames,
      ...profileHistoryGames,
      ...visibleOwnedGames,
    ];

    for (const game of candidates) {
      const appId = game.appId.trim();
      if (!appId) continue;
      const rawTitle = game.title.trim();
      const title = rawTitle || `Steam App ${appId}`;

      const sources = gameCatalogueHeaderSources(game);
      const current = uniqueGames.get(appId);
      if (current) {
        current.sources = [...new Set([...current.sources, ...sources])];
        if (current.title.startsWith("Steam App ") && !title.startsWith("Steam App ")) {
          current.title = title;
        }
      } else {
        uniqueGames.set(appId, { appId, title, sources });
      }
    }

    return [...uniqueGames.values()].map((game) => ({
      appId: game.appId,
      title: game.title,
      sources: game.sources,
    }));
  }, [
    profileAddedLibraryGames,
    profileFavoriteGames,
    profileHistoryGames,
    visibleOwnedGames,
  ]);
  const availableInitials = useMemo(
    () => new Set(allGames.map((game) => getHiddenProfileGameInitial(game.title))),
    [allGames],
  );
  const activeInitial = searchQuery.trim()
    ? ""
    : hoveredAlphabetIndex === null
      ? selectedInitial
      : PROFILE_GAME_ALPHABET[hoveredAlphabetIndex];
  const games = useMemo(
    () => filterAndSortHiddenProfileGames(
      allGames,
      entryHiddenGameIdsRef.current,
      searchQuery,
      activeInitial,
    ),
    [activeInitial, allGames, searchQuery],
  );
  return (
    <section className="hidden-profile-games-page" aria-labelledby={titleId}>
      <div className="hidden-profile-games-page__header">
        <div>
          <h3 id={titleId}>{t("settings.library.hiddenProfileGames.label")}</h3>
          <p>{t("settings.library.hiddenProfileGames.description")}</p>
        </div>
      </div>

      <div className="hidden-profile-games-page__browser">
        <nav
          className={`hidden-profile-games-page__alphabet${hoveredAlphabetIndex !== null ? " is-previewing" : ""}`}
          aria-label={t("settings.library.hiddenProfileGames.alphabetLabel")}
        >
          <button
            type="button"
            className="hidden-profile-games-page__alphabet-reset"
            aria-pressed={!activeInitial}
            aria-label={t("settings.library.hiddenProfileGames.clearAlphabetFilter")}
            onClick={() => {
              setSelectedInitial("");
              setHoveredAlphabetIndex(null);
            }}
          >
            <ArrowDownAZ size={24} aria-hidden="true" />
          </button>
          {PROFILE_GAME_ALPHABET.map((letter, index) => {
            const selected = selectedInitial === letter;
            const available = availableInitials.has(letter);
            const hovered = hoveredAlphabetIndex === index;
            const hoverDistance = hoveredAlphabetIndex === null
              ? 0
              : Math.abs(hoveredAlphabetIndex - index);
            const proximityClass = hoverDistance >= 1 && hoverDistance <= 3
              ? ` is-nearby-${hoverDistance}`
              : "";
            return (
              <button
                key={letter}
                type="button"
                className={`${hovered ? "is-hovered" : ""}${proximityClass}`}
                aria-pressed={selected}
                aria-label={t(
                  selected
                    ? "settings.library.hiddenProfileGames.clearLetterFilter"
                    : "settings.library.hiddenProfileGames.filterByLetter",
                  { letter },
                )}
                disabled={!available}
                onMouseEnter={() => {
                  setHoveredAlphabetIndex(index);
                  setSelectedInitial(letter);
                  onClearSearchQuery();
                }}
                onFocus={() => {
                  setHoveredAlphabetIndex(index);
                  setSelectedInitial(letter);
                  onClearSearchQuery();
                }}
              >
                <span aria-hidden="true" />
                <strong>{letter}</strong>
              </button>
            );
          })}
        </nav>

        <div
          className="hidden-profile-games__list"
          role="group"
          aria-label={t("settings.library.hiddenProfileGames.label")}
        >
          {games.map((game) => {
            const hidden = hiddenProfileGameIds.has(game.appId);
            return (
              <HiddenProfileGameHeader
                key={game.appId}
                sources={game.sources}
                title={game.title}
                hidden={hidden}
                onToggle={() => setProfileGameHidden(game.appId, !hidden)}
              />
            );
          })}
          {games.length === 0 && (
            <p>
              {searchQuery.trim() || activeInitial
                ? t("settings.library.hiddenProfileGames.noResults")
                : t("settings.library.hiddenProfileGames.empty")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
