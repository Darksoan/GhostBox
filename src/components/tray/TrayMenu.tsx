import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, Grid2X2, Home, Power, Play, User } from "lucide-react";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { useGameIconUrl } from "../../hooks/useGameIconUrl";
import "../../app.scss";

type TrayGameItemProps = {
  game: GhostBoxGame;
  launching: boolean;
  disabled: boolean;
  onLaunch: (game: GhostBoxGame) => void;
};

function TrayGameItem({ game, launching, disabled, onLaunch }: TrayGameItemProps) {
  const iconUrl = useGameIconUrl(game);
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";

  return (
    <button
      type="button"
      className="tray-menu__item tray-menu__game"
      onClick={() => onLaunch(game)}
      disabled={disabled}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="tray-menu__game-icon" aria-hidden="true" />
      ) : (
        <span className="tray-menu__game-icon tray-menu__game-icon--fallback" aria-hidden="true">
          <Play size={11} strokeWidth={2.25} />
        </span>
      )}
      <span className="tray-menu__item-label">{game.title}</span>
      {launching && (
        <span className="tray-menu__item-status">
          {isEnglish ? "starting" : "iniciando"}
        </span>
      )}
    </button>
  );
}

export function TrayMenu() {
  const { appearance } = useSettings();
  const [games, setGames] = useState<GhostBoxGame[]>([]);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const isEnglish = appearance.language === "en";

  useEffect(() => {
    void ghostboxApi.getTrayLibraryGames().then(setGames);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void ghostboxApi.hideTrayMenu();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleLaunch = async (game: GhostBoxGame) => {
    if (launchingAppId) return;

    setLaunchingAppId(game.appId);
    try {
      await ghostboxApi.launchTrayGame(game.appId);
    } finally {
      setLaunchingAppId(null);
    }
  };

  const navItems = [
    {
      page: "home" as const,
      label: isEnglish ? "Home" : "Início",
      icon: Home,
    },
    {
      page: "catalogue" as const,
      label: isEnglish ? "Catalogue" : "Catálogo",
      icon: Grid2X2,
    },
    {
      page: "library" as const,
      label: isEnglish ? "Library" : "Biblioteca",
      icon: BookOpen,
    },
    {
      page: "profile" as const,
      label: isEnglish ? "Profile" : "Perfil",
      icon: User,
    },
  ];

  return (
    <main className="tray-menu-shell" aria-label={isEnglish ? "GhostBox tray menu" : "Menu da bandeja do GhostBox"}>
      <nav className="tray-menu" data-tauri-drag-region>
        {games.length > 0 && (
          <section className="tray-menu__library" aria-label={isEnglish ? "My games" : "Meus jogos"}>
            <div className="tray-menu__section-title">{isEnglish ? "My games" : "Meus jogos"}</div>

            <div className="tray-menu__game-list">
              {games.map((game) => (
                <TrayGameItem
                  key={game.appId}
                  game={game}
                  launching={launchingAppId === game.appId}
                  disabled={Boolean(launchingAppId)}
                  onLaunch={(selectedGame) => void handleLaunch(selectedGame)}
                />
              ))}
            </div>
          </section>
        )}

        {games.length > 0 && <div className="tray-menu__separator" />}

        <button type="button" className="tray-menu__item" onClick={() => void ghostboxApi.showMainWindowFromTray()}>
          <ExternalLink size={14} strokeWidth={2.15} />
          <span className="tray-menu__item-label">{isEnglish ? "Open" : "Abrir"}</span>
        </button>

        {navItems.map(({ page, label, icon: Icon }) => (
          <button
            key={page}
            type="button"
            className="tray-menu__item"
            onClick={() => void ghostboxApi.navigateFromTray(page)}
          >
            <Icon size={14} strokeWidth={2.15} />
            <span className="tray-menu__item-label">{label}</span>
          </button>
        ))}

        <div className="tray-menu__separator" />

        <button type="button" className="tray-menu__item" onClick={() => void ghostboxApi.quitFromTray()}>
          <Power size={14} strokeWidth={2.15} />
          <span className="tray-menu__item-label">{isEnglish ? "Close" : "Fechar"}</span>
        </button>
      </nav>
    </main>
  );
}
