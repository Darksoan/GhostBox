import { Download, Folder, Heart, Languages, LogOut, Search, Settings, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { useDownloadTasks } from "../../hooks/useDownloadTasks";
import type { DownloadTask } from "../../lib/downloadManager";
import { ConsoleGlyph, ConsoleHints, consoleGameFromElement, type ConsoleHint } from "./ConsoleParts";
import { ConsoleBrowse, ConsoleCollection, ConsoleDiscover } from "./ConsoleViews";
import { ConsoleDownloads, consoleTaskFromElement, toggleConsoleTask } from "./ConsoleDownloads";
import { ConsoleGamePage, ConsoleSideSheet } from "./ConsoleGamePage";
import { ConsoleSearch } from "./ConsoleSearch";
import { ConsoleFiles } from "./ConsoleFiles";
import { useConsoleFullscreen } from "./useConsoleFullscreen";
import { focusConsoleElement, requestConsoleFocus, useConsoleGamepadConnected, useConsoleInput, useConsoleInputMode, useConsoleLayer } from "./useConsoleInput";
import "./console.scss";

const tabs = ["search", "discover", "browse", "library", "favourites", "downloads", "files"] as const;
type ConsoleTab = (typeof tabs)[number];
type GamePage = { game: GhostBoxGame; from: string };

function NavItem({ id, current, icon, label, ariaLabel, onPress, children, register }: {
  id: string;
  current: boolean;
  icon?: ReactNode;
  label?: string;
  ariaLabel?: string;
  onPress: () => void;
  children?: ReactNode;
  register: (id: string, element: HTMLButtonElement | null) => void;
}) {
  return (
    <button ref={(element) => register(id, element)} type="button" className={`console-nav-item${current ? " is-current" : ""}`}
      data-console-focus aria-current={current ? "page" : undefined} aria-label={ariaLabel} onClick={onPress}>
      {icon}{label && <span>{label}</span>}{children}
    </button>
  );
}

function gameForTask(task: DownloadTask, lists: GhostBoxGame[][]): GhostBoxGame {
  for (const list of lists) {
    const found = list.find((game) => game.appId === task.appId || game.id === task.appId);
    if (found) return found;
  }
  // Jogo baixado que não está em nenhuma lista local: os detalhes completos vêm da loja pelo AppID.
  return {
    id: task.appId, appId: task.appId, title: task.title, subtitle: "", status: "installed", hours: 0, rating: 0, size: "", release: "",
    progress: 0, accent: "", cover: "", hero: "", coverUrl: "", heroUrl: "", coverFallbacks: [], heroFallbacks: [], logo: "",
    tags: [], genres: [], screenshots: [], achievements: { unlocked: 0, total: 0, progress: 0 }, achievementList: [],
  };
}

/** A página do jogo prende o foco nela (o topo volta a ser alcançável ao sair), como no console. */
function GamePageLayer({ page, backLabel, onBack, onOpenGame, onOpenDownloads }: {
  page: GamePage;
  backLabel: string;
  onBack: () => void;
  onOpenGame: (game: GhostBoxGame) => void;
  onOpenDownloads: () => void;
}) {
  const appData = useAppData();
  const scope = useRef<HTMLDivElement>(null);
  useConsoleLayer(scope, {
    onBack,
    onFavourite: (focused) => { appData.toggleFavoriteGame(consoleGameFromElement(focused) ?? page.game); },
    onDetails: (focused) => {
      const other = consoleGameFromElement(focused);
      if (other && other.id !== page.game.id) onOpenGame(other);
      else scope.current?.querySelector<HTMLButtonElement>(".console-game__actions .console-button--icon")?.click();
    },
    onPrevTab: () => false,
    onNextTab: () => false,
  });
  return <div ref={scope} className="console-page-layer"><ConsoleGamePage key={page.game.id} game={page.game} backLabel={backLabel} onBack={onBack} onOpenGame={onOpenGame} onOpenDownloads={onOpenDownloads} /></div>;
}

export function ConsoleShell({ onOpenFullSettings }: { onOpenFullSettings: () => void }) {
  useConsoleFullscreen();
  const { appearance, updateAppearance, t } = useSettings();
  const appData = useAppData();
  const downloads = useDownloadTasks();
  const inputMode = useConsoleInputMode();
  const gamepadConnected = useConsoleGamepadConnected();
  const [tab, setTab] = useState<ConsoleTab>("discover");
  const [pages, setPages] = useState<GamePage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [browseGenre, setBrowseGenre] = useState<{ genre: string; request: number } | null>(null);
  const [pill, setPill] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navItems = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement[]>([]);
  const page = pages[pages.length - 1];
  const activeDownloads = downloads.filter((task) => task.status === "downloading" || task.status === "queued").length;
  const favourites = appData.favoriteGames.length;
  const tabLabel = useCallback((id: ConsoleTab) => t(`console.${id === "search" ? "search" : id}`), [t]);

  const registerNav = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) navItems.current.set(id, element); else navItems.current.delete(id);
  }, []);

  // Indicador deslizante sob a aba atual, medido a partir do próprio botão.
  useLayoutEffect(() => {
    const measure = () => {
      const item = navItems.current.get(tab);
      const header = headerRef.current;
      if (!item || !header) return;
      const itemBox = item.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      setPill({ width: itemBox.width, transform: `translateX(${itemBox.left - headerBox.left}px)` });
    };
    measure();
    // Qualquer mudança de tamanho no topo re-mede o indicador.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (headerRef.current) observer?.observe(headerRef.current);
    navItems.current.forEach((item) => observer?.observe(item));
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tab, favourites, activeDownloads, gamepadConnected]);

  const openGame = useCallback((game: GhostBoxGame) => {
    if (document.activeElement instanceof HTMLElement) returnFocus.current.push(document.activeElement);
    setPages((current) => [...current, { game, from: current.length ? current[current.length - 1].game.title : "" }]);
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  const closeGame = useCallback(() => {
    setPages((current) => current.slice(0, -1));
    const target = returnFocus.current.pop();
    requestAnimationFrame(() => { if (target?.isConnected) requestConsoleFocus(target); });
  }, []);

  const selectTab = useCallback((next: ConsoleTab) => {
    setPages([]);
    returnFocus.current = [];
    setSettingsOpen(false);
    setTab(next);
  }, []);

  const openTaskGame = useCallback((task: DownloadTask) => {
    openGame(gameForTask(task, [appData.addedLibraryGames, appData.favoriteGames, appData.profileHistoryGames]));
  }, [appData.addedLibraryGames, appData.favoriteGames, appData.profileHistoryGames, openGame]);

  // Cada aba nova começa com foco no conteúdo: o botão principal do destaque, o primeiro card ou a primeira linha.
  useEffect(() => {
    if (tab === "downloads") return undefined;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      content?.scrollTo({ top: 0 });
      const first = content?.querySelector<HTMLElement>("[data-console-cta], .console-card, .console-key, .console-rail-item")
        ?? content?.querySelector<HTMLElement>("button[data-console-focus]");
      requestConsoleFocus(first);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  const cycleTab = (step: 1 | -1) => selectTab(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]);

  useConsoleInput(rootRef, {
    onBack: () => {
      if (tab !== "discover") { selectTab("discover"); return; }
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      const cta = contentRef.current?.querySelector<HTMLElement>("[data-console-cta]");
      if (cta) focusConsoleElement(cta);
    },
    onPrevTab: () => cycleTab(-1),
    onNextTab: () => cycleTab(1),
    onFavourite: (focused) => {
      const task = tab === "downloads" ? consoleTaskFromElement(focused) : undefined;
      if (task) { void toggleConsoleTask(task); return; }
      const game = consoleGameFromElement(focused);
      if (game) appData.toggleFavoriteGame(game);
    },
    onDetails: (focused) => {
      const task = tab === "downloads" || tab === "files" ? consoleTaskFromElement(focused) : undefined;
      if (task) { openTaskGame(task); return; }
      const game = consoleGameFromElement(focused);
      if (game) openGame(game);
    },
  });

  const hints = useMemo<ConsoleHint[]>(() => {
    const select = { glyphs: ["cross"], label: t("console.select") } as ConsoleHint;
    const back = { glyphs: ["circle"], label: t("console.back") } as ConsoleHint;
    const sections = { glyphs: ["l1", "r1"], label: t("console.sections") } as ConsoleHint;
    if (page) return [select, { glyphs: ["square"], label: t("console.favourite") }, { glyphs: ["triangle"], label: t("console.optionsTitle") }, back, sections];
    if (tab === "downloads") return [select, { glyphs: ["square"], label: t("console.pauseResume") }, { glyphs: ["triangle"], label: t("console.gamePage") }, back];
    if (tab === "files") return [select, { glyphs: ["triangle"], label: t("console.gamePage") }, back, sections];
    if (tab === "search") return [{ glyphs: ["cross"], label: t("console.type") }, back, sections];
    if (tab === "discover") return [select, { glyphs: ["circle"], label: t("console.top") }, sections];
    return [select, { glyphs: ["triangle"], label: t("console.details") }, { glyphs: ["square"], label: t("console.favourite") }, back, sections];
  }, [page, t, tab]);

  const settingsOptions = [
    { key: "language", icon: Languages, label: t("console.language"), detail: appearance.language === "en" ? "English" : "Português",
      onSelect: () => updateAppearance({ language: appearance.language === "en" ? "pt" : "en" }) },
    { key: "full", icon: SlidersHorizontal, label: t("console.fullSettings"), detail: t("console.fullSettingsDescription"), onSelect: onOpenFullSettings },
    { key: "exit", icon: LogOut, label: t("console.exitConsole"), detail: t("console.exitConsoleDescription"), onSelect: () => updateAppearance({ consoleMode: false }) },
  ];

  return (
    <div ref={rootRef} className={`console-shell console-shell--${page ? "game" : tab}`} data-input={inputMode}>
      <div className="console-stage" aria-hidden={settingsOpen || undefined}>
        <header ref={headerRef} className="console-header">
          {pill && <span className="console-header__pill" style={pill} aria-hidden="true" />}
          <div className="console-header__side">
            <NavItem id="search" current={tab === "search"} register={registerNav} icon={<Search aria-hidden="true" />} label={t("console.search")}
              onPress={() => selectTab("search")} />
            <div className="console-header__group">
              {gamepadConnected && <ConsoleGlyph name="l1" />}
              <NavItem id="discover" current={tab === "discover"} register={registerNav} label={t("console.discover")} onPress={() => selectTab("discover")} />
              <NavItem id="browse" current={tab === "browse"} register={registerNav} label={t("console.browse")} onPress={() => selectTab("browse")} />
            </div>
          </div>
          <div className="console-header__side">
            <div className="console-header__group">
              <NavItem id="library" current={tab === "library"} register={registerNav} label={t("console.library")} onPress={() => selectTab("library")} />
            </div>
            <div className="console-header__group">
              <NavItem id="favourites" current={tab === "favourites"} register={registerNav} ariaLabel={t("console.favourites")}
                icon={<Heart aria-hidden="true" />} label={favourites ? String(favourites) : undefined} onPress={() => selectTab("favourites")} />
              <NavItem id="downloads" current={tab === "downloads"} register={registerNav} ariaLabel={t("console.downloads")}
                icon={<Download aria-hidden="true" />} onPress={() => selectTab("downloads")}>
                {activeDownloads > 0 && <span className="console-nav-item__badge">{activeDownloads}</span>}
              </NavItem>
              <NavItem id="files" current={tab === "files"} register={registerNav} ariaLabel={t("console.files")}
                icon={<Folder aria-hidden="true" />} onPress={() => selectTab("files")} />
              <NavItem id="settings" current={false} register={registerNav} ariaLabel={t("console.settings")}
                icon={<Settings aria-hidden="true" />} onPress={() => setSettingsOpen(true)} />
              {gamepadConnected && <ConsoleGlyph name="r1" />}
            </div>
          </div>
        </header>

        <div ref={contentRef} className="console-content">
          {page ? (
            <GamePageLayer page={page} backLabel={page.from || tabLabel(tab)} onBack={closeGame} onOpenGame={openGame}
              onOpenDownloads={() => selectTab("downloads")} />
          ) : <>
            {tab === "search" && <ConsoleSearch onOpen={openGame} onBrowseGenre={(genre) => { setBrowseGenre({ genre, request: Date.now() }); setTab("browse"); }} />}
            {tab === "discover" && <ConsoleDiscover onOpen={openGame} onSeeAll={() => selectTab("browse")} />}
            {tab === "browse" && <ConsoleBrowse key={browseGenre?.request ?? "browse"} onOpen={openGame} initialGenre={browseGenre?.genre} />}
            {(tab === "library" || tab === "favourites") && <ConsoleCollection key={tab} kind={tab} onOpen={openGame} />}
            {tab === "downloads" && <ConsoleDownloads onBrowse={() => selectTab("browse")} onGamePage={openTaskGame} />}
            {tab === "files" && <ConsoleFiles onGamePage={openTaskGame} />}
          </>}
        </div>
      </div>

      {/* As dicas de botão só fazem sentido para quem está no controle ou no teclado. */}
      {inputMode === "controller" && <ConsoleHints hints={hints} />}

      {settingsOpen && (
        <ConsoleSideSheet title={t("console.settingsTitle")} subtitle="GhostBox" options={settingsOptions} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
