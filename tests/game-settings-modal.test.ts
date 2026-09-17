import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("game actions menu", () => {
  const menu = readFileSync("src/components/modals/GameBackupOptionsModal.tsx", "utf8");
  const modal = readFileSync("src/components/modals/GameModal.tsx", "utf8");

  it("opens a floating menu from the gear button", () => {
    expect(menu).toContain('className="game-actions-menu"');
    expect(menu).toContain('role="menu"');
    expect(menu).toContain("trigger: HTMLElement | null");
    expect(modal).toContain("gearButtonRef");
    expect(modal).toContain("trigger={gearButtonRef.current}");
    expect(menu).not.toContain("game-settings-modal");
  });

  it("contains only installation and desktop shortcut actions", () => {
    expect(menu).not.toContain('copy("Mover instalação", "Move installation")');
    expect(menu).toContain('copy("Desinstalar", "Uninstall")');
    expect(menu).toContain('copy("Criar atalho na área de trabalho", "Create desktop shortcut")');
    expect(menu).toContain('createGameShortcut(game, "desktop")');
    expect(menu).not.toContain("selectExeFile");
    expect(menu).not.toContain("launchArguments");
    expect(menu).not.toContain("customExePath");
  });
});
