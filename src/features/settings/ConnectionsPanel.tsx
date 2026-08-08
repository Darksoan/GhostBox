import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import { useDiscordLink } from "./useDiscordLink";
import { isSteamConnected } from "../../lib/steamProfile";
import steamIcon from "../../../Icons/steam-glyph.svg";
import discordIcon from "../../../Icons/discord.svg";
import "./ConnectionsPanel.scss";

export function ConnectionsPanel() {
  const { t } = useSettings();
  const { steamProfile, isSteamSigningIn, handleConnectSteam, handleDisconnectSteam } = useAppData();
  const steamConnected = isSteamConnected(steamProfile);
  const discord = useDiscordLink();
  const [confirmingSteamDisconnect, setConfirmingSteamDisconnect] = useState(false);
  const [disconnectingSteam, setDisconnectingSteam] = useState(false);
  const [steamIdCopied, setSteamIdCopied] = useState(false);

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
    } finally {
      setDisconnectingSteam(false);
    }
  }

  return (
    <div className="connections-panel">
      <header className="connections-panel__header">
        <h2>{t("settings.connections.title")}</h2>
        <p>{t("settings.connections.description")}</p>
      </header>

      <div className="connections-panel__list">
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
                onClick={() => void discord.disconnect()}
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
