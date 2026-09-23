import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("background game installation", () => {
  it("returns from add after preparing LuaTools and downloads depots in a task", () => {
    const source = readFileSync("src-tauri/src/luatools.rs", "utf8");
    const addCommand = source.slice(
      source.indexOf("pub async fn luatools_add_game"),
      source.indexOf("pub fn luatools_remove_game"),
    );
    const spawnAt = addCommand.indexOf("tauri::async_runtime::spawn");
    const installAt = addCommand.indexOf("crate::cdndownload::install_added_game");

    expect(spawnAt).toBeGreaterThan(0);
    expect(installAt).toBeGreaterThan(spawnAt);
    expect(addCommand).toContain('"installationStarted": true');
    expect(addCommand).toContain('"game-installation-finished"');
  });

  it("limits the launcher bootstrap and leaves the remaining download to Steam", () => {
    const download = readFileSync("src-tauri/src/cdndownload.rs", "utf8");
    const manifest = readFileSync("src-tauri/src/steam_appmanifest.rs", "utf8");
    const worker = readFileSync(
      "sidecars/steamkit-poc/SteamKitPocRunner.cs",
      "utf8",
    );

    expect(download).toContain("const STEAM_BOOTSTRAP_BYTES: u64 = 1024 * 1024");
    expect(download).toContain('"MaxDownloadBytes": remaining_bootstrap_bytes');
    expect(worker).toContain('Type = depotResult.ReachedDownloadLimit ? "partial-complete"');
    expect(worker).toContain('chunkBytes > _config.MaxDownloadBytes - plannedBytes');
    expect(worker).not.toContain('plannedBytes > 0 && chunkBytes >');
    expect(manifest).toContain('const STATE_FLAG_UPDATE_REQUIRED: &str = "2"');
    expect(manifest).toContain("write_partial_appmanifest");
  });

  it("clears the add state and handles the eventual completion event", () => {
    const api = readFileSync("src/lib/ghostboxApi.tauri.ts", "utf8");
    const context = readFileSync("src/context/AppDataContext.tsx", "utf8");

    expect(api).toContain('listen<GameInstallationFinishedEvent>(\n      "game-installation-finished"');
    expect(context).toContain("ghostboxApi.onGameInstallationFinished");
    expect(context).toContain('showToast(\n          "Jogo adicionado"');
    expect(context).not.toContain('showToast("Pronto na Steam"');
    expect(context).toContain("setAddingGameId(null)");
  });
});
