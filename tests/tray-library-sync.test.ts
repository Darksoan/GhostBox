import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tray library synchronization", () => {
  it("refreshes the preloaded tray window whenever it is shown", () => {
    const tray = readFileSync("src/components/tray/TrayMenu.tsx", "utf8");

    expect(tray).toContain('window.addEventListener("focus", refreshGames)');
    expect(tray).toContain('window.removeEventListener("focus", refreshGames)');
  });

  it("does not truncate Steam libraries that exceed the visible tray area", () => {
    const backend = readFileSync("src-tauri/src/window_lifecycle.rs", "utf8");

    expect(backend).not.toContain("TRAY_LIBRARY_LIMIT");
    expect(backend).not.toMatch(/deduped\.len\(\)\s*>=/);
  });

  it("marks games found installed by the Steam scan as launchable", () => {
    const provider = readFileSync("src/context/AppDataContext.tsx", "utf8");

    expect(provider).toMatch(
      /trayInstalled:\s*game\.status === "installed" \|\|\s*game\.librarySource === "steam-installed"/,
    );
  });
});
