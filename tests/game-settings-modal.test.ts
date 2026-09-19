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

  it("contains only GhostBox-exclusive actions, no Steam duplicates", () => {
    expect(menu).toContain('copy("Abrir pasta", "Open folder")');
    expect(menu).toContain('copy("Fazer backup", "Back up now")');
    expect(menu).toContain('copy("Restaurar backup", "Restore backup")');
    expect(menu).toContain('copy("Ocultar no perfil", "Hide from profile")');
    expect(menu).toContain("openInstallFolder");
    expect(menu).toContain("backupGameToCloud");
    expect(menu).toContain("restoreCloudSave");
    expect(menu).toContain("setProfileGameHidden");
    expect(menu).not.toContain('copy("Desinstalar", "Uninstall")');
    expect(menu).not.toContain('copy("Criar atalho na área de trabalho", "Create desktop shortcut")');
    expect(menu).not.toContain("createGameShortcut");
    expect(menu).not.toContain("selectExeFile");
    expect(menu).not.toContain("launchArguments");
    expect(menu).not.toContain("customExePath");
  });

  it("keeps the desktop shortcut action on one line", () => {
    const styles = readFileSync("src/app.scss", "utf8");

    expect(menu).toContain("GAME_ACTIONS_MENU_WIDTH = 300");
    expect(styles).toMatch(/\.game-actions-menu button\s*\{[\s\S]*?white-space: nowrap;/);
  });
});
