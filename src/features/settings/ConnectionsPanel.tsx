import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Link2, Loader2 } from "lucide-react";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import { useDiscordLink } from "./useDiscordLink";
import { isSteamConnected } from "../../lib/steamProfile";
import { buildSteamOwnedGamesFromPlaytimes } from "../../utils/steamLibraryMerge";
import steamIcon from "../../../Icons/steam-glyph.svg";
import discordIcon from "../../../Icons/discord.svg";
import "./ConnectionsPanel.scss";

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
   * The worker refuses to unlink the account's last provider outright — no
   * recovery emails, no backup codes, so that link is the only way back into a
   * forgotten password. The refusal is final; the warning explains it.
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
                    title={
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

export function SteamVisibilitySection() {
  const { t } = useSettings();
  const {
    steamProfile,
    showSteamGames,
    setShowSteamGames,
    showSteamLibraryGames,
    setShowSteamLibraryGames,
    hiddenProfileGameIds,
    setProfileGameHidden,
    profileAddedLibraryGames,
    profileFavoriteGames,
    profileHistoryGames,
    steamAccountStats,
  } = useAppData();
  const steamConnected = isSteamConnected(steamProfile);
  const steamVisibilityLabelId = useId();
  const steamVisibilityDescId = useId();
  const steamLibraryLabelId = useId();
  const steamLibraryDescId = useId();
  const hiddenGames = useMemo(() => {
    const games = new Map<string, string>();
    const candidates = [
      ...profileAddedLibraryGames,
      ...profileFavoriteGames,
      ...profileHistoryGames,
      ...buildSteamOwnedGamesFromPlaytimes(steamAccountStats?.ownedPlaytimes ?? [], {}),
    ];
    for (const game of candidates) {
      const appId = game.appId.trim();
      const title = game.title.trim();
      if (appId && title && title !== appId) games.set(appId, title);
    }
    return [...games]
      .map(([appId, title]) => ({ appId, title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [
    profileAddedLibraryGames,
    profileFavoriteGames,
    profileHistoryGames,
    steamAccountStats?.ownedPlaytimes,
  ]);

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
          disabled={!steamConnected}
          className={`settings-switch${showSteamLibraryGames ? " settings-switch--on" : ""}${
            !steamConnected ? " settings-switch--disabled" : ""
          }`}
          onClick={() => {
            if (!steamConnected) return;
            setShowSteamLibraryGames(!showSteamLibraryGames);
          }}
        >
          <span />
        </button>
        </div>
      </div>

      <details className="hidden-profile-games">
        <summary>
          <span className="hidden-profile-games__copy">
            <strong>{t("settings.library.hiddenProfileGames.label")}</strong>
            <span>{t("settings.library.hiddenProfileGames.description")}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div
          className="hidden-profile-games__list"
          role="group"
          aria-label={t("settings.library.hiddenProfileGames.label")}
        >
          {hiddenGames.map((game) => {
            const hidden = hiddenProfileGameIds.has(game.appId);
            return (
              <button
                key={game.appId}
                type="button"
                role="checkbox"
                aria-checked={hidden}
                className={`hidden-profile-games__item${hidden ? " hidden-profile-games__item--selected" : ""}`}
                onClick={() => setProfileGameHidden(game.appId, !hidden)}
              >
                <span>{game.title}</span>
                <Check size={14} aria-hidden="true" />
              </button>
            );
          })}
          {hiddenGames.length === 0 && (
            <p>{t("settings.library.hiddenProfileGames.empty")}</p>
          )}
        </div>
      </details>
    </div>
  );
}
