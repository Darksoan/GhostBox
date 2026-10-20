import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n";
import type { DownloadTask } from "../src/lib/downloadManager";
import { ConsoleDownloads } from "../src/features/console/ConsoleDownloads";

const state = vi.hoisted(() => ({ tasks: [] as DownloadTask[] }));

vi.mock("../src/context/settings", () => ({
  useSettings: () => ({ appearance: { language: "pt" }, t: (key: string, params?: Record<string, string | number>) => translate("pt", key, params) }),
}));
vi.mock("../src/context/OverlayContext", () => ({ useOverlay: () => ({ showToast: vi.fn() }) }));
vi.mock("../src/hooks/useDownloadTasks", () => ({ useDownloadTasks: () => state.tasks }));
vi.mock("../src/hooks/useDownloadSpeedHistory", () => ({ useDownloadSpeedHistory: () => ({ taskId: null, queuedAt: 0, title: "", download: [], write: [] }) }));
vi.mock("../src/hooks/useDownloadsDirectory", () => ({ useDownloadsDirectory: () => "E:\\Games" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isError: false }) }));
vi.mock("../src/hooks/useCachedImageSources", () => ({
  useCachedImageSources: (sources: string[]) => sources,
  useLoadableImageCover: () => ({ source: null, loaded: false }),
}));
vi.mock("../src/lib/downloadManager", () => ({ pauseDownloadTask: vi.fn(), resumeDownloadTask: vi.fn(), deleteDownloadTask: vi.fn() }));
vi.mock("../src/pages/DownloadsPage", () => ({
  downloadPercent: (task: DownloadTask) => (task.bytesTotal > 0 ? task.bytesDownloaded / task.bytesTotal * 100 : 0),
}));

const gb = 1024 ** 3;
const task = (id: string, status: DownloadTask["status"], extra: Partial<DownloadTask> = {}): DownloadTask => ({
  id, appId: id, title: `Game ${id}`, headerSources: [], downloadsRoot: "E:\\Games", outputDir: `E:\\Games\\${id}`,
  status, queuedAt: 1, startedAt: 1, bytesDownloaded: 2 * gb, bytesTotal: 8 * gb, speedBytesPerSecond: 0, depotIndex: 1, depotTotal: 1, ...extra,
});
const render = () => renderToStaticMarkup(createElement(ConsoleDownloads, { onBrowse: vi.fn(), onGamePage: vi.fn() }));

beforeEach(() => { state.tasks = []; });

describe("console downloads", () => {
  it("shows the empty state with a way back to browsing and the activity panel idle", () => {
    const markup = render();
    expect(markup).toContain("Nenhum download por aqui");
    expect(markup).toContain("Explorar jogos");
    expect(markup).toContain('<p class="console-dl-panel__headline">Ocioso</p>');
  });

  it("groups rows into in-progress, stopped and completed sections with a summary", () => {
    state.tasks = [task("1", "completed", { bytesDownloaded: 8 * gb, steamIntegration: { status: "ok" } }), task("2", "paused"), task("3", "error", { errorMessage: "CDN fora do ar" }), task("4", "queued")];
    const markup = render();
    expect(markup).toContain("1 em andamento · 1 pausados · 1 com falha · 1 concluídos");
    const order = ["Em andamento", "Pausados e com falha", "Concluídos"].map((title) => markup.indexOf(`aria-label="${title}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toContain("CDN fora do ar");
  });

  it("picks the primary action from each row's state", () => {
    state.tasks = [
      task("p", "paused"),
      task("e", "error"),
      task("c", "completed", { steamIntegration: { status: "ok" } }),
      task("q", "queued", { startedAt: undefined, bytesDownloaded: 0 }),
    ];
    const primaries = [...render().matchAll(/console-dl-row__primary"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)].map((match) => match[1]);
    expect(primaries).toEqual(["Baixar", "Retomar", "Tentar novamente", "Jogar"]);
  });

  it("shows time left and both throughput strips only while a download is running", () => {
    state.tasks = [task("d", "downloading", { speedBytesPerSecond: 1024 * 1024, writeSpeedBytesPerSecond: 512 * 1024 })];
    const markup = render();
    expect(markup).toContain('class="console-dl-stats"');
    expect(markup).toContain("Escrita em disco");
    expect(markup).toContain("1.00 MB/s");
    state.tasks = [task("p", "paused")];
    expect(render()).not.toContain('class="console-dl-stats"');
  });
});
