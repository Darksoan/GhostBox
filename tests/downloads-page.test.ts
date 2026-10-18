import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n";
import type { DownloadTask } from "../src/lib/downloadManager";
import type { DownloadActivity } from "../src/lib/downloadActivity";
import type { DownloadDestination } from "../src/lib/ghostboxApi.types";
import { DownloadsPage, downloadPercent } from "../src/pages/DownloadsPage";
import { steamLibraryHeroSources } from "../src/utils/image";

const state = vi.hoisted(() => ({ tasks: [] as DownloadTask[], activity: { taskId: null, queuedAt: 0, title: "", download: [], write: [] } as DownloadActivity,
  directory: "E:\\Games", destinations: [] as DownloadDestination[], storageError: false }));

vi.mock("../src/context/settings", () => ({
  useSettings: () => ({ appearance: { language: "pt" }, t: (key: string, params?: Record<string, string | number>) => translate("pt", key, params) }),
}));
vi.mock("../src/context/OverlayContext", () => ({ useOverlay: () => ({ showToast: vi.fn() }) }));
vi.mock("../src/hooks/useDownloadTasks", () => ({ useDownloadTasks: () => state.tasks }));
vi.mock("../src/hooks/useDownloadSpeedHistory", () => ({ useDownloadSpeedHistory: () => state.activity }));
vi.mock("../src/hooks/useDownloadsDirectory", () => ({ useDownloadsDirectory: () => state.directory }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.destinations, isPending: false, isFetching: false, isError: state.storageError, refetch: vi.fn() }) }));
vi.mock("../src/hooks/useCachedImageSources", () => ({
  useCachedImageSources: (sources: string[]) => sources,
  useLoadableImageCover: () => ({ source: "https://example.com/library_hero.jpg", loaded: true }),
}));
vi.mock("../src/lib/downloadManager", () => ({
  pauseDownloadTask: vi.fn(), resumeDownloadTask: vi.fn(), prioritizeDownloadTask: vi.fn(), writeStoredDownloadsDir: vi.fn(),
}));
vi.mock("../src/components/modals/DownloadDetailsModal", () => ({ DownloadDetailsModal: () => null }));

const task = (id: string, status: DownloadTask["status"], extra: Partial<DownloadTask> = {}): DownloadTask => ({
  id, appId: id, title: `Game ${id}`, headerSources: [], downloadsRoot: "E:\\Games", outputDir: "E:\\Games\\Game",
  status, queuedAt: 1_780_000_000_000, bytesDownloaded: 1024, bytesTotal: 4096, speedBytesPerSecond: 1024,
  depotIndex: 1, depotTotal: 1, ...extra,
});
const render = () => renderToStaticMarkup(createElement(DownloadsPage));
const stylesheet = postcss.parse(compile("src/pages/DownloadsPage.scss").css);
function declarations(selector: string, condition?: string) {
  const values: Record<string, string> = {};
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    if (condition ? rule.parent.type !== "atrule" || rule.parent.params !== condition : rule.parent.type !== "root") return;
    rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
  });
  return values;
}
beforeEach(() => {
  state.tasks = []; state.activity = { taskId: null, queuedAt: 0, title: "", download: [], write: [] };
  state.directory = "E:\\Games"; state.destinations = []; state.storageError = false;
});

describe("Downloads and selected storage", () => {
  it("keeps transfer information and controls in compact download rows", () => {
    state.tasks = [task("10", "downloading")];
    const markup = render();
    expect(markup).toContain('class="downloads-page__layout"');
    expect(markup).toContain('class="downloads-hero__percent">25%</span>');
    expect(markup).toContain("1.00 KB / 4.00 KB");
    expect(markup).toContain("1.00 KB/s");
    expect(markup).toContain('aria-valuenow="25"');
    expect(markup).toContain("transform:scaleX(0.25)");
    for (const label of ["Pausar", "Remover", "Detalhes: Game 10"]) expect(markup).toContain(`aria-label="${label}"`);
  });

  it("places the active card first, then queue, paused cards and history without duplicates", () => {
    state.tasks = [task("30", "paused"), task("50", "error"), task("20", "queued"),
      task("40", "completed", { finishedAt: 1_780_000_001_000 }), task("10", "downloading"), task("21", "queued")];
    const markup = render();
    expect(Array.from(markup.matchAll(/data-download-id="([^"]+)"/g), (match) => match[1])).toEqual(["10", "20", "21", "30", "40", "50"]);
    expect(markup.match(/class="downloads-page__list"/g)).toHaveLength(3);
    expect(markup).not.toContain("downloads-page__header");
    expect(markup).not.toContain("downloads-page__hint");
  });

  it("shows queue positions and an upward priority action only on games below the first", () => {
    state.tasks = [task("20", "queued"), task("21", "queued")];
    const markup = render();
    expect(markup).toContain("Na fila posição 1");
    expect(markup).toContain("Na fila posição 2");
    const up = markup.match(/<button[^>]*aria-label="Priorizar download"[^>]*>/g)!;
    expect(up).toHaveLength(1);
    expect(up[0]).not.toContain("disabled");
    expect(markup.indexOf('aria-label="Priorizar download"')).toBeGreaterThan(markup.indexOf('data-download-id="21"'));
    expect(markup).not.toContain("lucide-arrow-down\"");
  });

  it("lets paused games below the first take download focus, but does not offer priority for a single game", () => {
    state.tasks = [task("10", "paused"), task("20", "paused")];
    const markup = render();
    expect(markup.match(/aria-label="Priorizar download"/g)).toHaveLength(1);
    expect(markup.indexOf('aria-label="Priorizar download"')).toBeGreaterThan(markup.indexOf('data-download-id="20"'));
    state.tasks = [task("20", "paused")];
    expect(render()).not.toContain('aria-label="Priorizar download"');
  });

  it("offers resume on paused downloads without showing a stale speed", () => {
    state.tasks = [task("30", "paused")];
    const markup = render();
    expect(markup).toContain('aria-label="Retomar"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain("1.00 KB/s");
  });

  it("shows the downloaded amount and complete game size in localized gigabytes when paused", () => {
    state.tasks = [task("10", "paused", { bytesDownloaded: 4.2 * 1024 ** 3, bytesTotal: 13.3 * 1024 ** 3 })];
    expect(render()).toContain("4,20 GB baixados de 13,30 GB");
    state.tasks = [task("10", "paused", { bytesDownloaded: 4.2 * 1024 ** 3, bytesTotal: 0 })];
    expect(render()).toContain("4,20 GB baixados");
    expect(render()).not.toContain("baixados de 0,00 GB");
  });

  it("keeps status next to the title and puts the percentage beside the progress bar", () => {
    state.tasks = [task("10", "paused")];
    const markup = render();
    expect(markup).toMatch(/downloads-hero__top[\s\S]*?Game 10<\/strong><\/button><div class="downloads-hero__middle"><span class="downloads-hero__status-text">Pausado<\/span><\/div><\/div><div class="downloads-hero__controls"/);
    const progressRow = markup.split('class="downloads-hero__controls"')[1].split('class="downloads-hero__footer"')[0];
    expect(progressRow).toContain('class="downloads-hero__percent">25%</span>');
    expect(progressRow).not.toContain("downloads-hero__actions");
    expect(declarations(".downloads-hero__top")).toMatchObject({ display: "flex", "align-items": "center", "justify-content": "space-between" });
    expect(declarations(".downloads-hero__middle")).toMatchObject({ "font-size": "var(--downloads-status-size)", "flex-shrink": "0", "align-items": "center" });
  });

  it("places actions in the footer to the right of the GB information", () => {
    state.tasks = [task("10", "paused")];
    const markup = render();
    const footer = markup.split('class="downloads-hero__footer"')[1];
    expect(footer.indexOf("downloads-hero__transfer-metrics")).toBeLessThan(footer.indexOf("downloads-hero__actions"));
    expect(declarations(".downloads-hero__footer")).toMatchObject({ display: "flex", "align-items": "center", "justify-content": "space-between" });
    expect(declarations(".downloads-hero__actions")).toMatchObject({ "margin-left": "auto" });
  });

  it("shows size and play for completed downloads, not a progress bar", () => {
    state.tasks = [task("40", "completed", { bytesDownloaded: 4096, steamIntegration: { status: "ok" } })];
    const markup = render();
    expect(markup).toContain("4.00 KB / 4.00 KB");
    expect(markup.match(/<button[^>]*aria-label="Jogar"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain("downloads-hero__percent");
    expect(markup).not.toContain('aria-label="Pausar"');
  });

  it("reserves the same progress-row height for completed and paused cards without showing a completed progress bar", () => {
    state.tasks = [task("10", "paused"), task("20", "completed")];
    const markup = render();
    expect(markup.match(/class="downloads-hero__controls"/g)).toHaveLength(2);
    expect(markup).toContain('class="downloads-hero__controls" aria-hidden="true"></div>');
    expect(markup.match(/role="progressbar"/g)).toHaveLength(1);
    expect(declarations(".downloads-hero__controls")).toMatchObject({ "min-height": "var(--type-line-caption)" });
  });

  it("does not enable launching an installation that needs repair", () => {
    state.tasks = [task("40", "completed", { steamIntegration: { status: "library-not-registered" } })];
    expect(render().match(/<button[^>]*aria-label="Jogar"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("offers retry for errors without a misleading progress bar", () => {
    state.tasks = [task("50", "error", { errorMessage: "CDN indisponível" })];
    const markup = render();
    expect(markup).toContain("CDN indisponível");
    expect(markup).toContain('aria-label="Tentar novamente"');
    expect(markup).not.toContain('role="progressbar"');
  });

  it("keeps download speed and selected storage next to the empty list without write metrics", () => {
    const markup = render();
    expect(markup).toContain("Nenhum download por aqui");
    expect(markup).not.toContain("Escrever");
    expect(markup).not.toContain("Gravados");
    expect(markup).toContain("Armazenamento");
    expect(markup).not.toContain("Local padrão de instalação");
    expect(markup).not.toContain("Baixe e acompanhe");
    expect(markup).not.toContain('class="downloads-activity__chart-line"');
  });

  it("clamps progress, handles unknown totals and treats completed downloads as 100 percent", () => {
    expect(downloadPercent(task("10", "downloading", { bytesDownloaded: -1 }))).toBe(0);
    expect(downloadPercent(task("10", "downloading", { bytesDownloaded: 8192 }))).toBe(100);
    expect(downloadPercent(task("10", "downloading", { bytesTotal: 0 }))).toBe(0);
    expect(downloadPercent(task("10", "downloading", { bytesTotal: Number.NaN }))).toBe(0);
    expect(downloadPercent(task("10", "completed", { bytesDownloaded: 0 }))).toBe(100);
    state.tasks = [task("10", "downloading", { bytesTotal: 0 })];
    expect(render().match(/<span[^>]*role="progressbar"[^>]*>/)?.[0]).not.toContain("aria-valuenow");
  });

  it("uses a two-column layout with compact rows and canonical page spacing", () => {
    expect(declarations(".downloads-page__layout")).toMatchObject({ display: "grid", "grid-template-columns": "minmax(0, 1fr) minmax(260px, 32%)" });
    expect(declarations(".downloads-hero")).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)", border: "0", "box-shadow": "none" });
    expect(declarations(".downloads-hero")).not.toHaveProperty("border-bottom");
    expect(declarations(".downloads-page.content-section--full")).toMatchObject({ "flex-shrink": "0", "min-height": "100%", height: "auto", padding: "var(--space-8) var(--space-10) var(--page-bottom-space)" });
    expect(declarations(".downloads-page__sidebar")).toMatchObject({ position: "sticky" });
  });

  it("stacks panels based on content width rather than window width", () => {
    expect(declarations(".downloads-page__layout", "downloads (max-width: 900px)")).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)" });
    expect(declarations(".downloads-page__sidebar", "downloads (max-width: 900px)")).toMatchObject({ position: "static" });
    expect(declarations(".downloads-hero", "downloads (max-width: 540px)")).toMatchObject({ "grid-template-columns": "minmax(0, 1fr)" });
  });

  it("keeps controls visible and uses existing tokens for the download graph", () => {
    expect(declarations(".downloads-hero__actions")).not.toHaveProperty("visibility", "hidden");
    expect(declarations(".downloads-hero__action")).toMatchObject({ width: "32px", height: "32px" });
    expect(declarations(".downloads-activity__chart-line")).toMatchObject({ stroke: "currentColor", fill: "none" });
    expect(declarations(".downloads-activity__metric")).toMatchObject({ color: "var(--text-primary)" });
  });

  it("uses Reicon Play to start, Pause to pause or resume, and Xmark to remove", () => {
    state.tasks = [task("10", "paused", { bytesDownloaded: 0 })];
    expect(render()).toContain('class="reicon downloads-hero__play-icon"');
    expect(render()).toContain('aria-label="Baixar"');
    state.tasks = [task("10", "downloading")];
    expect(render()).toContain('class="reicon downloads-hero__pause-icon"');
    state.tasks = [task("10", "paused")];
    expect(render()).toContain('class="reicon downloads-hero__pause-icon"');
    expect(render()).toContain('aria-label="Retomar"');
    expect(render()).toContain('class="reicon downloads-hero__remove-icon"');
    expect(render()).not.toContain("lucide-pause");
    expect(render()).not.toContain("lucide-play");
  });

  it("hides the downloaded label only during download, uses 14px metrics and primary progress fills", () => {
    state.tasks = [task("10", "downloading")];
    expect(render()).not.toContain("Baixado");
    expect(render()).toContain("lucide-arrow-down-to-line");
    expect(render()).toContain("1.00 KB / 4.00 KB");
    state.tasks = [task("10", "completed")];
    expect(render()).toContain("Baixado");
    expect(declarations(".downloads-hero__transfer-metrics")).toMatchObject({ "font-size": "var(--downloads-transfer-size)" });
    expect(declarations(".downloads-hero__progress-track > span")).toMatchObject({ background: "var(--text-primary)" });
    expect(declarations(".downloads-storage__meter > span")).toMatchObject({ background: "var(--text-primary)" });
  });

  it("uses translucent controls with a subtle brighter hover and replaces the ellipsis with open folder", () => {
    state.tasks = [task("10", "downloading")];
    const markup = render();
    expect(markup).toContain('aria-label="Abrir pasta"');
    expect(markup).toContain("lucide-folder-open");
    expect(markup.indexOf('aria-label="Abrir pasta"')).toBeLessThan(markup.indexOf('aria-label="Remover"'));
    expect(markup).not.toContain("lucide-ellipsis");
    expect(declarations(".downloads-hero__action")).toMatchObject({ background: "var(--surface-hover)" });
    expect(declarations(".downloads-hero__action:hover:not(:disabled)")).toMatchObject({ background: "var(--surface-active)" });
    state.tasks = [task("10", "queued", { outputDir: "" })];
    expect(render().match(/<button[^>]*aria-label="Abrir pasta"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("renders only download samples and downloaded bytes, even when disk-write telemetry exists", () => {
    state.tasks = [task("10", "downloading", { bytesWritten: 2048, writeSpeedBytesPerSecond: 2048 })];
    state.activity = { taskId: "10", queuedAt: state.tasks[0].queuedAt, title: "Game 10",
      download: [{ time: 1000, speed: 1024 }, { time: 2000, speed: 2048 }],
      write: [{ time: 1000, speed: 2048 }, { time: 2000, speed: 4096 }] };
    const markup = render();
    expect(markup.match(/class="downloads-activity__chart-line"/g)).toHaveLength(1);
    expect(markup).toContain("Velocidade de download nos últimos 60 segundos");
    expect(markup).toContain("1.00 KB/s");
    expect(markup).not.toContain("Velocidade de escrita em disco");
    expect(markup).not.toContain("Escrever");
    expect(markup).not.toContain("Gravados");
    expect(markup).toContain("1.00 KB / 4.00 KB");
  });

  it("keeps the download curve visible while paused and reports zero current speed", () => {
    state.tasks = [task("10", "paused", { writeSpeedBytesPerSecond: 4096 })];
    state.activity = { taskId: "10", queuedAt: state.tasks[0].queuedAt, title: "Game 10",
      download: [{ time: 1000, speed: 1024 }], write: [{ time: 1000, speed: 4096 }] };
    const markup = render();
    expect(markup.match(/class="downloads-activity__chart-line"/g)).toHaveLength(1);
    expect(markup.match(/class="downloads-activity__value">0 B\/s/g)).toHaveLength(1);
    expect(markup).not.toContain("4.00 KB/s");
  });

  it("uses library hero art as a background with controls and text above a token-based scrim", () => {
    state.tasks = [task("10", "downloading")];
    const markup = render();
    expect(markup).toContain("library_hero.jpg");
    expect(markup).toContain("downloads-hero__art--loaded");
    expect(markup).toContain("downloads-hero__scrim");
    expect(markup).not.toContain("downloads-hero__cover");
    expect(markup).not.toContain("<img");
    expect(declarations(".downloads-hero__art")).toMatchObject({ position: "absolute", inset: "0", "background-size": "cover", "pointer-events": "none" });
    expect(declarations(".downloads-hero__content")).toMatchObject({ position: "relative", "z-index": "1" });
    expect(declarations(".downloads-hero__scrim").background).toContain("var(--overlay-strong)");
    const sources = steamLibraryHeroSources("550");
    expect(sources[0]).toContain("/550/library_hero_2x.jpg");
    expect(sources.every((source) => /library_hero(_2x)?\.jpg$/.test(source))).toBe(true);
  });

  it("shows only the storage destination selected in settings, not the active download's drive", () => {
    const selected: DownloadDestination = { path: "E:\\Games", drive: "E:", label: "Selected disk", kind: "fixed", isLibrary: true, available: true, freeBytes: 1024, totalBytes: 4096 };
    state.destinations = [{ ...selected, path: "F:\\Other", drive: "F:", label: "Other disk" }, selected];
    state.tasks = [task("10", "downloading", { downloadsRoot: "F:\\Other" })];
    const markup = render();
    expect(markup).toContain("Selected disk");
    expect(markup).not.toContain("Selected disk · E:");
    expect(markup).toContain("E:\\Games");
    expect(markup).toContain("1.00 KB livres de 4.00 KB");
    expect(markup.match(/role="meter"/g)).toHaveLength(1);
    expect(markup).not.toContain("Other disk");
    expect(markup).not.toContain("F:\\Other");
  });

  it("does not fall back to another disk when the selected destination is unavailable", () => {
    state.destinations = [{ path: "F:\\Other", drive: "F:", label: "Other disk", kind: "fixed", isLibrary: true, available: true, freeBytes: 100, totalBytes: 1000 }];
    expect(render()).toContain("Unidade indisponível");
    expect(render()).not.toContain("Other disk");
    expect(render()).not.toContain('role="meter"');
    state.directory = "";
    expect(render()).toContain("Selecione um destino nos ajustes de downloads.");
  });

  it("reports storage query failures without showing unrelated volumes", () => {
    state.storageError = true;
    expect(render()).toContain("Não foi possível consultar os discos.");
    expect(render()).toContain('aria-label="Atualizar discos"');
  });
});
