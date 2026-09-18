import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("library removal flow", () => {
  const contextMenu = readFileSync(
    "src/hooks/useCollectionContextMenu.ts",
    "utf8",
  );
  const modal = readFileSync(
    "src/components/modals/UninstallConfirmModal.tsx",
    "utf8",
  );
  const provider = readFileSync("src/context/AppDataContext.tsx", "utf8");

  it("keeps a single library removal action in the context menu", () => {
    expect(contextMenu).toContain('label: "Remover da biblioteca"');
    expect(contextMenu).not.toContain('label: "Desinstalar"');
    expect(contextMenu).not.toContain("onUninstallGame");
  });

  it("shows only cancel and remove decisions in the confirmation modal", () => {
    expect(modal).toContain("onConfirm: () => void");
    expect(modal).toContain('lang === "en" ? "Cancel" : "Cancelar"');
    expect(modal).toContain('lang === "en" ? "Remove" : "Remover"');
    expect(modal).not.toContain("onRemoveOnly");
    expect(modal).not.toContain("onRemoveAndUninstall");
    expect(modal).not.toContain("Remove & uninstall");
  });

  it("uninstalls installed games only after library removal succeeds", () => {
    expect(provider).toContain(
      "removeConfirmGame && isLocallyInstalledGame(removeConfirmGame)",
    );
    expect(provider).toContain("const removed = await removeQueuedGame(game)");
    expect(provider).toContain("if (!removed) return");
    expect(provider).toContain("steam://uninstall/${appId}");
  });
});
