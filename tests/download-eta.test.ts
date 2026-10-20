import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n";
import { downloadEtaSeconds, formatDownloadEta, smoothDownloadSpeed } from "../src/utils/downloadEta";

const t = (key: string, params?: Record<string, string | number>) => translate("pt", key, params);
const task = { status: "downloading" as const, bytesTotal: 1000, bytesDownloaded: 400, speedBytesPerSecond: 100 };

describe("download ETA", () => {
  it("estimates immediately from the current speed, without a warm-up delay", () => {
    expect(downloadEtaSeconds(task)).toBe(6);
  });
  it("has no estimate when stopped, without a total or without speed", () => {
    expect(downloadEtaSeconds({ ...task, status: "paused" })).toBe(0);
    expect(downloadEtaSeconds({ ...task, bytesTotal: 0 })).toBe(0);
    expect(downloadEtaSeconds({ ...task, speedBytesPerSecond: 0 })).toBe(0);
  });
  it("keeps the last average through momentary zero-speed samples", () => {
    const first = smoothDownloadSpeed(0, 200);
    expect(first).toBe(200);
    expect(smoothDownloadSpeed(first, 0)).toBe(200);
    expect(smoothDownloadSpeed(200, 100)).toBe(175);
  });
  it("formats seconds, minutes and hours", () => {
    expect(formatDownloadEta(0, t)).toBe("Calculando…");
    expect(formatDownloadEta(30, t)).toBe("Menos de 1 min");
    expect(formatDownloadEta(600, t)).toBe("10 min");
    expect(formatDownloadEta(3900, t)).toBe("1 h 5 min");
  });
});
