import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("explicit native game downloads", () => {
  it("keeps library addition separate from downloading", () => {
    const source = readFileSync("src-tauri/src/luatools.rs", "utf8");
    const add = source.slice(source.indexOf("pub async fn luatools_add_game"), source.indexOf("pub fn luatools_remove_game"));
    expect(add).not.toContain("install_added_game");
    expect(add).not.toContain('"installationStarted": true');
    const overlay = readFileSync("src/components/routing/ContentOverlay.tsx", "utf8");
    expect(overlay).toContain("onQueueGame={appData.queueGame}");
    expect(overlay).toContain("enqueueDownload(game)");
  });

  it("requests a complete download while preserving a separate bootstrap budget", () => {
    const download = readFileSync("src-tauri/src/cdndownload.rs", "utf8");
    const api = readFileSync("src/lib/ghostboxApi.tauri.ts", "utf8");
    const worker = readFileSync("sidecars/steamkit-poc/SteamKitPocRunner.cs", "utf8");
    expect(download).toContain("const STEAM_BOOTSTRAP_BYTES: u64 = 1024 * 1024");
    expect(download).toContain("full_download.unwrap_or(false)");
    expect(download).toContain('"MaxDownloadBytes": byte_budget.unwrap_or(0)');
    expect(api).toContain("fullDownload: true");
    expect(worker).toContain("_config.MaxDownloadBytes == 0");
    expect(worker).toContain("plannedBytes + missingBytes > overshootCap");
  });

  it("registers the commands and refreshes the library only after an explicit installation change", () => {
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const context = readFileSync("src/context/AppDataContext.tsx", "utf8");
    for (const name of ["download_game", "cancel_game", "delete_output_dir", "register_library"]) {
      expect(lib).toContain(`cdndownload::cdndownload_${name},`);
    }
    expect(context).toContain('window.addEventListener("ghostbox:download-installation-changed", refresh)');
  });
});
