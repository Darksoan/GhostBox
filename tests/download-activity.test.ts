import { afterEach, describe, expect, it, vi } from "vitest";
import { appendDownloadSpeedSample, downloadSpeedChart } from "../src/utils/downloadActivity";

afterEach(() => vi.useRealTimers());

describe("Download activity metrics", () => {
  it("keeps a bounded minute of real samples, including zero speed", () => {
    let samples: Array<{ time: number; speed: number }> = [];
    for (let second = 0; second < 120; second++) samples = appendDownloadSpeedSample(samples, second * 1000, second);
    expect(samples).toHaveLength(60);
    expect(samples[0].time).toBe(60_000);
    expect(appendDownloadSpeedSample(samples, 120_000, 0).at(-1)?.speed).toBe(0);
    expect(appendDownloadSpeedSample(samples, 300_000, 1)).toEqual([{ time: 300_000, speed: 1 }]);
  });

  it("sanitizes invalid speeds and has no fabricated empty series", () => {
    expect(appendDownloadSpeedSample([], 1000, Number.NaN)).toEqual([{ time: 1000, speed: 0 }]);
    expect(appendDownloadSpeedSample([], 1000, -20)).toEqual([{ time: 1000, speed: 0 }]);
    expect(downloadSpeedChart([])).toEqual({ line: "", area: "", peak: 0, average: 0 });
    expect(downloadSpeedChart([{ time: 0, speed: Number.POSITIVE_INFINITY }]).line).toBe("");
  });

  it("uses real timestamps on a fixed minute axis and computes peak and average", () => {
    const chart = downloadSpeedChart([{ time: 0, speed: 100 }, { time: 30_000, speed: 200 }, { time: 60_000, speed: 0 }]);
    expect(chart.peak).toBe(200);
    expect(chart.average).toBe(100);
    expect(chart.line).toMatch(/^M0\.00,/);
    expect(chart.line).toContain("L150.00,");
    expect(chart.line).toContain("L300.00,");
    expect(chart.area).toMatch(/ Z$/);
    expect(chart.line).not.toContain("NaN");
  });

  it("preserves both histories across a long pause and resuming the same game", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const store = await import("../src/lib/downloadActivity");
    const game = { id: "10", queuedAt: 1, title: "Game" };
    store.beginDownloadActivity(game);
    store.recordDownloadActivity(game.id, 1024, 2048);
    vi.setSystemTime(2000);
    store.recordDownloadActivity(game.id, 2048, 4096);
    const beforePause = store.readDownloadActivity();
    store.suspendDownloadActivity(game.id);
    vi.setSystemTime(600_000);
    expect(store.readDownloadActivity()).toBe(beforePause);
    store.beginDownloadActivity(game);
    expect(store.readDownloadActivity()).toBe(beforePause);
    store.recordDownloadActivity(game.id, 4096, 8192);
    const resumed = store.readDownloadActivity();
    expect(resumed.download).toHaveLength(3);
    expect(resumed.write).toHaveLength(3);
    expect(resumed.download.slice(0, 2)).toEqual(beforePause.download);
    expect(resumed.write.slice(0, 2)).toEqual(beforePause.write);
    expect(resumed.download[2].time).toBe(2000);
  });

  it("resets both graphs when another game starts, including switching back", async () => {
    vi.resetModules();
    const store = await import("../src/lib/downloadActivity");
    const first = { id: "10", queuedAt: 1, title: "First" };
    const second = { id: "20", queuedAt: 2, title: "Second" };
    store.beginDownloadActivity(first);
    store.recordDownloadActivity(first.id, 100, 200);
    store.beginDownloadActivity(second);
    expect(store.readDownloadActivity()).toMatchObject({ taskId: "20", download: [], write: [] });
    store.recordDownloadActivity(second.id, 300, 400);
    store.beginDownloadActivity(first);
    expect(store.readDownloadActivity()).toMatchObject({ taskId: "10", download: [], write: [] });
  });

  it("recognizes a new download of the same app and does not fabricate missing disk telemetry", async () => {
    vi.resetModules();
    const store = await import("../src/lib/downloadActivity");
    store.beginDownloadActivity({ id: "10", queuedAt: 1, title: "Game" });
    store.recordDownloadActivity("10", 100);
    expect(store.readDownloadActivity().write).toEqual([]);
    const previous = store.readDownloadActivity();
    store.recordDownloadActivity("20", 100, 100);
    expect(store.readDownloadActivity()).toBe(previous);
    store.beginDownloadActivity({ id: "10", queuedAt: 2, title: "Game" });
    expect(store.readDownloadActivity().download).toEqual([]);
  });
});
