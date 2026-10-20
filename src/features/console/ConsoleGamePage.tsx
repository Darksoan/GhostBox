import {
  ChevronLeft, Download, Ellipsis, ExternalLink, FolderOpen, Heart, Library, LoaderCircle, Lock, Play, RotateCw, Trash2, Trophy, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { useDownloadTasks } from "../../hooks/useDownloadTasks";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { enqueueDownload, resumeDownloadTask } from "../../lib/downloadManager";
import { useGamesQuery, useGameStoreDetailsQuery } from "../../queries/games";
import { emptyCatalogueFilters } from "../../constants/catalogue";
import { downloadPercent } from "../../pages/DownloadsPage";
import { gameHeroSources, gamePortraitPreviewSources, getGameAppId, layeredImageStyle } from "../../utils/image";
import { isLocallyInstalledGame } from "../../utils/librarySourceFilter";
import { isBlockedSteamDemo, filterOutSteamDemos } from "../../utils/steamAppType";
import {
  ConsoleArt, ConsoleCard, ConsoleHints, ConsoleRail, consoleGameByElement, formatConsoleSize, useConsoleArt, type ConsoleHint,
} from "./ConsoleParts";
import { useConsoleGameFlags } from "./ConsoleViews";
import { focusConsoleElement, requestConsoleFocus, useConsoleInputMode, useConsoleLayer } from "./useConsoleInput";
import { isStoreHeading, storeTextParagraphs } from "./consoleText";

const ARM_MS = 3000;

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="console-game__section" aria-label={title}>
      <div className="console-game__section-head"><h2 className="console-section-title">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

function ShotViewer({ shots, start, onClose }: { shots: string[]; start: number; onClose: (index: number) => void }) {
  const { t } = useSettings();
  const mode = useConsoleInputMode();
  const [index, setIndex] = useState(start);
  const scope = useRef<HTMLDivElement>(null);
  const strip = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (next: number) => {
    const wrapped = (next + shots.length) % shots.length;
    setIndex(wrapped);
    const element = strip.current[wrapped];
    if (element) focusConsoleElement(element);
  };
  useEffect(() => { requestConsoleFocus(strip.current[start]); }, [start]);
  useConsoleLayer(scope, {
    onBack: () => onClose(index),
    onPrevTab: () => go(index - 1),
    onNextTab: () => go(index + 1),
    onFavourite: () => true,
    onDetails: () => true,
  });
  const hints: ConsoleHint[] = [{ glyphs: ["l1", "r1"], label: t("console.previousNext") }, { glyphs: ["circle"], label: t("console.close") }];
  return (
    <div ref={scope} className="console-viewer" role="dialog" aria-modal="true" aria-label={t("console.screenshots")}>
      <span className="console-viewer__image" style={layeredImageStyle([shots[index]], "")} role="img" aria-label={t("console.shotPosition", { index: index + 1, total: shots.length })} />
      <div className="console-viewer__bar">
        <span className="console-viewer__count">{t("console.shotPosition", { index: index + 1, total: shots.length })}</span>
        <div className="console-viewer__strip">
          {shots.map((shot, shotIndex) => (
            <button key={shot} ref={(element) => { strip.current[shotIndex] = element; }} type="button" data-console-focus
              className={`console-shot-thumb${shotIndex === index ? " is-current" : ""}`} style={layeredImageStyle([shot], "")}
              aria-label={t("console.shotPosition", { index: shotIndex + 1, total: shots.length })}
              onFocus={() => setIndex(shotIndex)} onMouseEnter={() => setIndex(shotIndex)} onClick={() => onClose(shotIndex)} />
          ))}
        </div>
        <button type="button" className="console-viewer__close console-button console-button--outline" onClick={() => onClose(index)}>{t("console.close")}</button>
      </div>
      {mode === "controller" && <ConsoleHints hints={hints} />}
    </div>
  );
}

export type ConsoleOption = {
  key: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  onSelect: () => void;
  /** Ação destrutiva: o primeiro toque arma, o segundo confirma. */
  confirm?: { label: string; detail: string };
};

/** Painel lateral à direita, como as folhas de opções do console. */
export function ConsoleSideSheet({ title, subtitle, options, onClose }: { title: string; subtitle?: string; options: ConsoleOption[]; onClose: () => void }) {
  const { t } = useSettings();
  const mode = useConsoleInputMode();
  const scope = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { requestConsoleFocus(first.current); }, []);
  useEffect(() => {
    if (!armed) return undefined;
    const id = window.setTimeout(() => setArmed(null), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armed]);
  useConsoleLayer(scope, { onBack: onClose, onPrevTab: () => true, onNextTab: () => true, onFavourite: () => true, onDetails: () => true });
  return (
    <div ref={scope} className="console-side-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="console-side-sheet__panel" onClick={(event) => event.stopPropagation()}>
        <div className="console-side-sheet__head">
          <h2 className="console-section-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="console-side-sheet__options">
          {options.map((option, index) => {
            const face = armed === option.key && option.confirm ? { ...option, ...option.confirm } : option;
            return (
              <button key={option.key} ref={index === 0 ? first : undefined} type="button" data-console-focus
                className={`console-sheet__row${armed === option.key ? " is-armed" : ""}`} onBlur={() => { if (armed === option.key) setArmed(null); }}
                onClick={() => {
                  if (option.confirm && armed !== option.key) { setArmed(option.key); return; }
                  setArmed(null);
                  onClose();
                  option.onSelect();
                }}>
                <option.icon aria-hidden="true" />
                <span><strong>{face.label}</strong><small>{face.detail}</small></span>
              </button>
            );
          })}
        </div>
      </div>
      {mode === "controller" && <ConsoleHints hints={[{ glyphs: ["cross"], label: t("console.select") }, { glyphs: ["circle"], label: t("console.close") }]} />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="console-fact"><span>{label}</span><span>{value || "—"}</span></div>;
}

export function ConsoleGamePage({ game, backLabel, onBack, onOpenGame, onOpenDownloads }: {
  game: GhostBoxGame;
  backLabel: string;
  onBack: () => void;
  onOpenGame: (game: GhostBoxGame) => void;
  onOpenDownloads: () => void;
}) {
  const appData = useAppData();
  const { showToast } = useOverlay();
  const { appearance, t } = useSettings();
  const flags = useConsoleGameFlags();
  const tasks = useDownloadTasks();
  const { data: details } = useGameStoreDetailsQuery(game.id);
  const resolved = details ?? game;
  const appId = getGameAppId(game);
  const heroSources = useMemo(() => gameHeroSources(resolved), [resolved]);
  const coverSources = useMemo(() => gamePortraitPreviewSources(resolved), [resolved]);
  const shots = useMemo(() => (resolved.screenshots ?? []).filter(Boolean).slice(0, 12), [resolved.screenshots]);
  const about = useMemo(() => storeTextParagraphs(resolved.aboutTheGame || resolved.shortDescription), [resolved.aboutTheGame, resolved.shortDescription]);
  const requirements = resolved.pcRequirements;
  const achievements = resolved.achievementList ?? [];
  const primary = useRef<HTMLButtonElement>(null);
  const [shotIndex, setShotIndex] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingDownload = useRef(false);
  const shotButtons = useRef<(HTMLButtonElement | null)[]>([]);

  const task = tasks.find((entry) => entry.appId === appId);
  const libraryGame = appData.addedLibraryGames.find((entry) => getGameAppId(entry) === appId);
  const playable = appData.playableGameAppIds.has(appId)
    && (isLocallyInstalledGame(libraryGame ?? game) || task?.status === "completed");
  const inLibrary = appData.availableLibraryGameAppIds.has(appId);
  const running = appData.activeSessionAppIds.has(appId);
  const launching = appData.launchingGameId === game.id;
  const favourite = appData.favoriteGameIds.has(game.id);
  const demo = isBlockedSteamDemo(resolved);
  const year = resolved.release?.match(/\d{4}/)?.[0];
  const size = formatConsoleSize(resolved.size);
  const installFolder = resolved.installPath || (task?.status === "completed" ? task.outputDir : "");

  const related = useGamesQuery({
    query: "", limit: 9, offset: 0, sort: "popular",
    filters: { ...emptyCatalogueFilters, genres: resolved.genres?.[0] ? [resolved.genres[0]] : [] },
  }, { enabled: Boolean(resolved.genres?.[0]) });
  const relatedGames = useMemo(() => filterOutSteamDemos(related.data?.games ?? []).filter((other) => getGameAppId(other) !== appId).slice(0, 8),
    [appId, related.data]);

  useEffect(() => {
    if (!primary.current) return;
    consoleGameByElement.set(primary.current, game);
    requestConsoleFocus(primary.current);
  }, [game]);

  const startDownload = async () => {
    if (startingDownload.current || appData.addingGameId || appData.removingGameId || demo) return;
    startingDownload.current = true;
    setStarting(true);
    try {
      // O botão continua sendo Baixar, mas os pacotes precisam estar preparados
      // pelo mesmo fluxo de adição do desktop antes de iniciar o download nativo.
      if (!inLibrary && !await appData.queueGame(resolved)) return;
      if (task?.status === "paused" || task?.status === "error") {
        await resumeDownloadTask(task.id);
      } else if (!await enqueueDownload(resolved)) return;
      showToast(t("console.downloadStarted"), t("console.downloadStartedDetail", { title: resolved.title }), "success");
      onOpenDownloads();
    } catch (error) {
      showToast(t("console.downloads"), String(error), "error");
    } finally {
      startingDownload.current = false;
      setStarting(false);
    }
  };

  const demoAction = { icon: Lock, label: t("console.demoUnavailable"), disabled: true, onPress: () => undefined };
  const downloadAction = { icon: Download, label: t("console.download"), disabled: starting, onPress: startDownload };
  const action = running ? { icon: Play, label: t("console.running"), disabled: true, onPress: () => undefined }
    : playable ? { icon: Play, label: t("console.play"), disabled: launching, onPress: () => void appData.handlePlayGame(game) }
      : !inLibrary
        ? demo ? demoAction
          : downloadAction
        : task && (task.status === "downloading" || task.status === "queued")
          ? { icon: Download, label: t("console.downloadingPercent", { percent: Math.round(downloadPercent(task)) }), disabled: false, onPress: onOpenDownloads }
          : task && (task.status === "paused" || task.status === "error")
            ? { icon: RotateCw, label: t("console.resumeDownload"), disabled: starting, onPress: startDownload }
            : demo ? demoAction
              : downloadAction;
  const busy = launching || starting || appData.addingGameId === game.id || appData.removingGameId === game.id;

  const options: ConsoleOption[] = [
    inLibrary
      ? { key: "remove", icon: Trash2, label: t("console.removeFromLibrary"), detail: t("console.removeFromLibraryDetail"),
        confirm: { label: t("console.removeFromLibrary"), detail: t("console.pressAgain") }, onSelect: () => void appData.removeQueuedGame(game) }
      : { key: "add", icon: Library, label: t("console.addToLibrary"), detail: t("console.addToLibraryDetail"), onSelect: () => void appData.queueGame(resolved) },
    ...(task ? [{ key: "downloads", icon: Download, label: t("console.viewDownloads"), detail: t("console.viewDownloadsDetail"), onSelect: onOpenDownloads }] : []),
    ...(installFolder ? [{ key: "folder", icon: FolderOpen, label: t("console.openFolder"), detail: t("console.openFolderDetail"),
      onSelect: () => void ghostboxApi.revealDownloadFolder(installFolder).catch((error) => showToast(t("console.files"), String(error), "error")) }] : []),
    ...(playable ? [{ key: "uninstall", icon: Trash2, label: t("console.uninstall"), detail: t("console.uninstallDetail"),
      confirm: { label: t("console.uninstall"), detail: t("console.pressAgain") },
      onSelect: () => void ghostboxApi.openExternalUrl(`steam://uninstall/${appId}`) }] : []),
    { key: "steam", icon: ExternalLink, label: t("console.openSteam"), detail: t("console.openSteamDetail"),
      onSelect: () => void ghostboxApi.openExternalUrl(`https://store.steampowered.com/app/${appId}`) },
  ];

  const controller = resolved.controllerSupport;
  const locale = appearance.language === "en" ? "en-US" : "pt-BR";
  const unlockedCount = achievements.filter((entry) => entry.unlocked).length;

  return (
    <div className="console-game">
      <header className="console-game__hero">
        <ConsoleArt key={game.id} sources={shots.length ? [...heroSources, shots[0]] : heroSources} className="console-game__backdrop" />
        <span className="console-game__scrim" aria-hidden="true" />
        <button type="button" className="console-back-link" data-console-focus onClick={onBack}>
          <ChevronLeft aria-hidden="true" />{backLabel}
        </button>
        <div className="console-game__hero-row">
          <ConsoleArt sources={coverSources} className="console-game__cover" />
          <div className="console-game__headline">
            <h1 className="console-logo console-logo--text console-logo--game">{resolved.title}</h1>
            <p className="console-game__meta">
              {resolved.developers?.[0]}
              {resolved.developers?.[0] && resolved.genres?.length ? <span>{"  ·  "}</span> : null}
              {resolved.genres?.join(", ")}
            </p>
            <div className="console-game__scores">
              {resolved.metacriticScore ? <span><span className="console-card__score">{resolved.metacriticScore}</span>{t("console.metacritic")}</span> : null}
              {year && <span>{t("console.released", { year })}</span>}
              {flags.badge(game) && <span>{flags.badge(game)}</span>}
            </div>
            <div className="console-game__actions">
              <button ref={primary} type="button" className="console-button console-button--primary console-button--lg" data-console-focus
                disabled={action.disabled || busy} aria-busy={busy} onClick={action.onPress}>
                {busy ? <LoaderCircle className="console-spin" aria-hidden="true" /> : <action.icon aria-hidden="true" />}
                {action.label}
              </button>
              <button type="button" className="console-button console-button--outline console-button--lg console-button--no-hover-border" data-console-focus aria-pressed={favourite}
                onClick={() => appData.toggleFavoriteGame(game)}>
                <Heart aria-hidden="true" fill={favourite ? "currentColor" : "none"} />
                {t(favourite ? "console.favourited" : "console.addToFavourites")}
              </button>
              <button type="button" className="console-button console-button--outline console-button--lg console-button--icon console-button--no-hover-border" data-console-focus
                aria-label={t("console.moreOptions")} onClick={() => setOptionsOpen(true)}>
                <Ellipsis aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="console-game__body">
        <div className="console-game__main">
          {shots.length > 0 && (
            <Section title={t("console.screenshots")}>
              <div className="console-gallery">
                <span className="console-gallery__main" style={layeredImageStyle([shots[shotIndex]], "")}>
                  <span className="console-gallery__count">{t("console.shotPosition", { index: shotIndex + 1, total: shots.length })}</span>
                </span>
                <div className="console-gallery__strip">
                  {shots.map((shot, index) => (
                    <button key={shot} ref={(element) => { shotButtons.current[index] = element; }} type="button" data-console-focus
                      className={`console-shot-thumb${index === shotIndex ? " is-current" : ""}`} style={layeredImageStyle([shot], "")}
                      aria-label={t("console.shotPosition", { index: index + 1, total: shots.length })}
                      onFocus={() => setShotIndex(index)} onMouseEnter={() => setShotIndex(index)} onClick={() => setViewing(index)} />
                  ))}
                </div>
              </div>
            </Section>
          )}

          {about.length > 0 && (
            <Section title={t("console.about")}>
              <div className={`console-about${aboutOpen ? " is-open" : ""}`}>
                {about.map((line, index) => isStoreHeading(line)
                  ? <h3 key={index} className="console-about__heading">{line}</h3>
                  : <p key={index}>{line}</p>)}
              </div>
              {about.length > 3 && (
                <button type="button" className="console-text-button" data-console-focus onClick={() => setAboutOpen((open) => !open)}>
                  {t(aboutOpen ? "console.showLess" : "console.showMore")}
                </button>
              )}
            </Section>
          )}

          {achievements.length > 0 && (
            <Section title={t("console.achievements")} aside={<span className="console-section-meta">{t("console.achievementsProgress", { unlocked: unlockedCount, total: achievements.length })}</span>}>
              <span className="console-progress is-active"><span style={{ transform: `scaleX(${unlockedCount / achievements.length})` }} /></span>
              <div className="console-achievements">
                {achievements.slice(0, 24).map((entry) => (
                  <div key={entry.name} className={`console-achievement${entry.unlocked ? " is-unlocked" : ""}`} data-console-focus tabIndex={-1}>
                    <AchievementIcon src={entry.unlocked ? entry.icon : entry.iconGray || entry.icon} />
                    <span>
                      <strong>{entry.title || entry.name}</strong>
                      <small>{entry.description || t(entry.unlocked ? "console.unlocked" : "console.locked")}</small>
                    </span>
                    {entry.unlocked ? <Trophy aria-label={t("console.unlocked")} /> : <Lock aria-label={t("console.locked")} />}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(resolved.tags?.length ?? 0) > 0 && (
            <Section title={t("console.features")}>
              <div className="console-chips">
                {controller && controller !== "none" && <span className="console-chip-tag">{t(controller === "full" ? "console.controllerFull" : "console.controllerPartial")}</span>}
                {resolved.tags.slice(0, 14).map((tag) => <span key={tag} className="console-chip-tag">{tag}</span>)}
              </div>
            </Section>
          )}

          {requirements && (requirements.minimum.length > 0 || requirements.recommended.length > 0) && (
            <Section title={t("console.requirements")}>
              <div className="console-requirements">
                {(["minimum", "recommended"] as const).filter((kind) => requirements[kind].length > 0).map((kind) => (
                  <div key={kind}>
                    <h3 className="console-overline">{t(kind === "minimum" ? "console.requirementsMinimum" : "console.requirementsRecommended")}</h3>
                    {requirements[kind].flatMap((entry) => storeTextParagraphs(entry)).slice(0, 10).map((line, index) => <p key={index}>{line}</p>)}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        <aside className="console-game__facts">
          <h2 className="console-section-title">{t("console.detailsTitle")}</h2>
          <div className="console-facts">
            <Fact label={t("console.factPlatform")} value="Windows · Steam" />
            <Fact label={t("console.factAppId")} value={appId} />
            <Fact label={t("console.factDeveloper")} value={resolved.developers?.join(", ")} />
            <Fact label={t("console.factPublisher")} value={resolved.publishers?.join(", ")} />
            <Fact label={t("console.factRelease")} value={resolved.release} />
            <Fact label={t("console.factSize")} value={size} />
            <Fact label={t("console.factController")} value={controller ? t(`console.controller${controller[0].toUpperCase()}${controller.slice(1)}`) : undefined} />
            {resolved.steamPositiveRatio != null && (
              <Fact label={t("console.factReviews")} value={`${t("console.reviewsPositive", { percent: Math.round(resolved.steamPositiveRatio * (resolved.steamPositiveRatio <= 1 ? 100 : 1)) })}${resolved.steamReviewCount ? ` · ${resolved.steamReviewCount.toLocaleString(locale)}` : ""}`} />
            )}
          </div>
        </aside>
      </div>

      {relatedGames.length > 0 && (
        <div className="console-game__related">
          <ConsoleRail title={t("console.moreLikeThis")} seeAllLabel={t("console.seeAll")} previousLabel={t("console.previous")} nextLabel={t("console.next")}>
            {relatedGames.map((other) => (
              <ConsoleCard key={other.id} game={other} onOpen={onOpenGame} favourite={flags.isFavourite(other)} badge={flags.badge(other)} />
            ))}
          </ConsoleRail>
        </div>
      )}

      {viewing !== null && (
        <ShotViewer shots={shots} start={viewing} onClose={(index) => {
          setViewing(null);
          setShotIndex(index);
          requestAnimationFrame(() => requestConsoleFocus(shotButtons.current[index]));
        }} />
      )}
      {optionsOpen && (
        <ConsoleSideSheet title={t("console.optionsTitle")} subtitle={resolved.title} options={options} onClose={() => {
          setOptionsOpen(false);
          requestAnimationFrame(() => requestConsoleFocus(primary.current));
        }} />
      )}
    </div>
  );
}

function AchievementIcon({ src }: { src: string }) {
  const { source, loaded } = useConsoleArt(useMemo(() => (src ? [src] : []), [src]));
  return <span className={`console-achievement__icon${source && loaded ? " is-loaded" : ""}`} style={layeredImageStyle(source && loaded ? [source] : [], "")} aria-hidden="true" />;
}
