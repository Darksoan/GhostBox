import { describe, expect, it } from "vitest";
import type { DownloadDestination } from "../src/lib/ghostboxApi.types";
import { registeredDownloadLibraries, selectedDownloadDestination, downloadStorageUsedPercent } from "../src/utils/downloadStorage";

const selected: DownloadDestination = { path: "E:\\Games", drive: "E:", label: "Selected", kind: "fixed", isLibrary: true, available: true, freeBytes: 25, totalBytes: 100 };

describe("Selected download storage", () => {
  it("only permits registered libraries, not other disks or a previously selected custom folder", () => {
    const disk = { ...selected, path: "C:\\GhostBoxLibrary", isLibrary: false };
    const custom = { ...selected, path: "E:\\Custom", isLibrary: false };
    const unavailable = { ...selected, path: "F:\\SteamLibrary", available: false };
    expect(registeredDownloadLibraries([disk, selected, custom, unavailable])).toEqual([selected, unavailable]);
    expect(registeredDownloadLibraries([disk, custom])).toEqual([]);
  });
  it("matches the exact selected path with Windows case and separator normalization", () => {
    const other = { ...selected, path: "E:\\Other" };
    expect(selectedDownloadDestination("e:/games/", [other, selected])).toBe(selected);
    expect(selectedDownloadDestination("E:\\Games\\Nested", [other, selected])).toBeUndefined();
  });
  it("never selects the first volume or another library on the same drive as a fallback", () => {
    expect(selectedDownloadDestination("", [selected])).toBeUndefined();
    expect(selectedDownloadDestination("F:\\Games", [selected])).toBeUndefined();
    expect(selectedDownloadDestination("E:\\Other", [selected])).toBeUndefined();
  });
  it("shows a bounded occupancy value only for available, measured storage", () => {
    expect(downloadStorageUsedPercent(selected)).toBe(75);
    expect(downloadStorageUsedPercent({ ...selected, available: false })).toBeNull();
    expect(downloadStorageUsedPercent({ ...selected, totalBytes: 0 })).toBeNull();
    expect(downloadStorageUsedPercent({ ...selected, freeBytes: 200 })).toBe(0);
  });
});
