import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n";
import type { DownloadTask } from "../src/lib/downloadManager";
import type { GhostBoxGame } from "../src/data";
import { enqueueDownload, resumeDownloadTask } from "../src/lib/downloadManager";

const state = vi.hoisted(() => ({
  library: new Set<string>(),
  libraryGames: [] as GhostBoxGame[],
  playable: new Set<string>(),
  tasks: [] as DownloadTask[],
  queueGame: vi.fn(),
  showToast: vi.fn(),
  language: "pt" as "pt" | "en",
}));

vi.mock("../src/context/AppDataContext", () => ({
  useAppData: () => ({
    playableGameAppIds: state.playable,
    availableLibraryGameAppIds: state.library,
    addedLibraryGames: state.libraryGames,
    activeSessionAppIds: new Set<string>(),
    favoriteGameIds: new Set<string>(),
    launchingGameId: null,
    addingGameId: null,
    removingGameId: null,
    handlePlayGame: vi.fn(),
    queueGame: state.queueGame,
    toggleFavoriteGame: vi.fn(),
    removeQueuedGame: vi.fn(),
  }),
}));
vi.mock("../src/context/settings", () => ({
  useSettings: () => ({
    appearance: { language: state.language },
    t: (key: string, params?: Record<string, string | number>) => translate(state.language, key, params),
  }),
}));
vi.mock("../src/context/OverlayContext", () => ({ useOverlay: () => ({ showToast: state.showToast }) }));
vi.mock("../src/hooks/useDownloadTasks", () => ({ useDownloadTasks: () => state.tasks }));
vi.mock("../src/hooks/useCachedImageSources", () => ({
  useCachedImageSources: (sources: string[]) => sources,
  useLoadableImageCover: () => ({ source: null, loaded: false }),
}));
vi.mock("../src/lib/downloadManager", () => ({
  enqueueDownload: vi.fn(), resumeDownloadTask: vi.fn(),
}));
vi.mock("../src/queries/games", () => ({
  useGamesQuery: () => ({ data: undefined }),
  useGameStoreDetailsQuery: () => ({ data: undefined }),
}));
vi.mock("../src/pages/DownloadsPage", () => ({
  downloadPercent: (task: DownloadTask) => (task.bytesTotal > 0 ? task.bytesDownloaded / task.bytesTotal * 100 : 0),
}));
vi.mock("../src/lib/ghostboxApi", () => ({
  ghostboxApi: { revealDownloadFolder: vi.fn(), openExternalUrl: vi.fn() },
}));

import { ConsoleGamePage } from "../src/features/console/ConsoleGamePage";

const game = {
  id: "10", appId: "10", title: "Hollow Test", subtitle: "", status: "discover", hours: 0, rating: 0,
  size: "10 GB", release: "2020", progress: 0, accent: "", cover: "", hero: "", coverUrl: "", heroUrl: "",
  coverFallbacks: [], heroFallbacks: [], logo: "", tags: [], genres: [], screenshots: [],
  achievements: { unlocked: 0, total: 0, progress: 0 }, achievementList: [],
} as GhostBoxGame;

type Element = ReactElement<{ children?: ReactNode; className?: string; onClick?: () => void | Promise<void>; disabled?: boolean }>;
function elements(node: ReactNode): Element[] {
  return isValidElement<Element["props"]>(node)
    ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
}

function render(selectedGame = game) {
  const onOpenDownloads = vi.fn();
  let primary: Element;
  function Page() {
    const tree = ConsoleGamePage({
      game: selectedGame, backLabel: "Descobrir", onBack: vi.fn(), onOpenGame: vi.fn(), onOpenDownloads,
    });
    primary = elements(tree).find((element) => element.type === "button"
      && element.props.className === "console-button console-button--primary console-button--lg")!;
    return tree;
  }
  const markup = renderToStaticMarkup(createElement(Page));
  return { markup, onOpenDownloads, click: () => primary.props.onClick!() };
}

function primaryLabel(markup: string) {
  return markup.split('console-button console-button--primary console-button--lg')[1]?.split("</button>")[0] ?? "";
}

beforeEach(() => {
  vi.resetAllMocks();
  state.library.clear();
  state.playable.clear();
  state.libraryGames = [];
  state.tasks = [];
  state.language = "pt";
  state.queueGame.mockResolvedValue(true);
  vi.mocked(enqueueDownload).mockResolvedValue(true);
  vi.mocked(resumeDownloadTask).mockResolvedValue(undefined);
});

describe("console game primary action", () => {
  it("shows the game name instead of a second cover or logo above the actions", () => {
    const page = render({ ...game, logo: "https://example.com/library_logo.png" });
    expect(page.markup).toContain('<h1 class="console-logo console-logo--text console-logo--game">Hollow Test</h1>');
    expect(page.markup).not.toContain("console-logo--image");
    expect(page.markup).toContain("console-game__cover");
  });

  it("keeps Download as the label before and after library addition", () => {
    expect(primaryLabel(render().markup)).toContain("Baixar");

    state.library.add("10");
    expect(primaryLabel(render().markup)).toContain("Baixar");

    state.language = "en";
    expect(primaryLabel(render().markup)).toContain("Download");
  });

  it("waits for successful addition before starting a native download and opening console downloads", async () => {
    let finishAdding!: (success: boolean) => void;
    state.queueGame.mockReturnValue(new Promise<boolean>((resolve) => { finishAdding = resolve; }));
    const page = render();
    const starting = page.click();
    expect(state.queueGame).toHaveBeenCalledExactlyOnceWith(game);
    expect(enqueueDownload).not.toHaveBeenCalled();
    expect(page.onOpenDownloads).not.toHaveBeenCalled();

    finishAdding(true);
    await starting;
    expect(enqueueDownload).toHaveBeenCalledExactlyOnceWith(game);
    expect(page.onOpenDownloads).toHaveBeenCalledOnce();
    expect(vi.mocked(enqueueDownload).mock.invocationCallOrder[0]).toBeLessThan(page.onOpenDownloads.mock.invocationCallOrder[0]);
  });

  it("does not download or change tabs when addition fails", async () => {
    state.queueGame.mockResolvedValue(false);
    const page = render();
    await page.click();
    expect(enqueueDownload).not.toHaveBeenCalled();
    expect(resumeDownloadTask).not.toHaveBeenCalled();
    expect(page.onOpenDownloads).not.toHaveBeenCalled();
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("skips adding a game that is already in the library", async () => {
    state.library.add("10");
    state.playable.add("10");
    state.libraryGames = [{ ...game, librarySource: "ghostbox" }];
    const page = render();
    expect(primaryLabel(page.markup)).toContain("Baixar");
    await page.click();
    expect(state.queueGame).not.toHaveBeenCalled();
    expect(enqueueDownload).toHaveBeenCalledExactlyOnceWith(game);
    expect(page.onOpenDownloads).toHaveBeenCalledOnce();
  });

  it("does not announce success or change tabs when the download directory picker is cancelled", async () => {
    vi.mocked(enqueueDownload).mockResolvedValue(false);
    const page = render();
    await page.click();
    expect(state.queueGame).toHaveBeenCalledOnce();
    expect(page.onOpenDownloads).not.toHaveBeenCalled();
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("opens downloads only after the native queue accepts the game", async () => {
    let finishEnqueue!: (queued: boolean) => void;
    vi.mocked(enqueueDownload).mockReturnValue(new Promise<boolean>((resolve) => { finishEnqueue = resolve; }));
    const page = render();
    const starting = page.click();
    await vi.waitFor(() => expect(enqueueDownload).toHaveBeenCalledOnce());
    expect(page.onOpenDownloads).not.toHaveBeenCalled();
    finishEnqueue(true);
    await starting;
    expect(page.onOpenDownloads).toHaveBeenCalledOnce();
  });

  it("reports download errors without leaving the game page", async () => {
    vi.mocked(enqueueDownload).mockRejectedValue(new Error("Download indisponível"));
    const page = render();
    await page.click();
    expect(page.onOpenDownloads).not.toHaveBeenCalled();
    expect(state.showToast).toHaveBeenCalledWith("Downloads", "Error: Download indisponível", "error");
  });

  it("ignores duplicate clicks while preparing the game", async () => {
    let finishAdding!: (success: boolean) => void;
    state.queueGame.mockReturnValue(new Promise<boolean>((resolve) => { finishAdding = resolve; }));
    const page = render();
    const starting = page.click();
    await page.click();
    expect(state.queueGame).toHaveBeenCalledOnce();
    finishAdding(true);
    await starting;
    expect(enqueueDownload).toHaveBeenCalledOnce();
    expect(page.onOpenDownloads).toHaveBeenCalledOnce();
  });

  it.each(["paused", "error"] as const)("prepares the game before resuming an existing %s download", async (status) => {
    state.tasks = [{
      id: "10", appId: "10", title: "Hollow Test", headerSources: [], downloadsRoot: "E:\\Games",
      outputDir: "", status, queuedAt: 1, bytesDownloaded: 0, bytesTotal: 0,
      speedBytesPerSecond: 0, depotIndex: 0, depotTotal: 0, errorMessage: "sem depósitos",
    }];
    const page = render();
    expect(primaryLabel(page.markup)).toContain("Baixar");
    await page.click();
    expect(state.queueGame).toHaveBeenCalledOnce();
    expect(resumeDownloadTask).toHaveBeenCalledExactlyOnceWith("10");
    expect(state.queueGame.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(resumeDownloadTask).mock.invocationCallOrder[0]);
    expect(enqueueDownload).not.toHaveBeenCalled();
    expect(page.onOpenDownloads).toHaveBeenCalledOnce();
  });

  it("keeps Play for games already installed locally", () => {
    state.library.add("10");
    state.playable.add("10");
    state.libraryGames = [{ ...game, status: "installed" }];
    expect(primaryLabel(render().markup)).toContain("Jogar");
  });
});
