import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { useCollectionContextMenu } from "../src/hooks/useCollectionContextMenu";

const registeredGame = {
  id: "steam-123",
  appId: "123",
  title: "Installed game",
  librarySource: "registered",
  status: "discover",
} as GhostBoxGame;

function menuActions(steamInstallConfirmed: boolean) {
  let removeCalls = 0;
  let uninstallCalls = 0;
  let uninstallAction: (() => void) | undefined;

  function Menu() {
    const items = useCollectionContextMenu({
      game: registeredGame,
      favoriteGameIds: new Set(),
      libraryGameAppIds: new Set(["123"]),
      removableGameAppIds: new Set(["123"]),
      steamInstallConfirmed,
      userCollections: [],
      onRemoveGame: () => { removeCalls += 1; },
      onUninstallAndRemoveGame: () => { uninstallCalls += 1; },
    });
    uninstallAction = items.find((item) => item.label === "Remover e desinstalar")?.onClick;
    return createElement(
      "div",
      null,
      items.map((item) => createElement("span", { key: item.label }, item.label)),
    );
  }

  const markup = renderToStaticMarkup(createElement(Menu));
  return {
    markup,
    uninstallAction,
    get removeCalls() { return removeCalls; },
    get uninstallCalls() { return uninstallCalls; },
  };
}

describe("library removal context menu", () => {
  it("offers Steam uninstall for a registered game with a confirmed manifest", () => {
    const menu = menuActions(true);
    expect(menu.markup).toContain("Remover da biblioteca");
    expect(menu.markup).toContain("Remover e desinstalar");
    menu.uninstallAction?.();
    expect(menu.uninstallCalls).toBe(1);
    expect(menu.removeCalls).toBe(0);
  });

  it("does not offer Steam uninstall when no manifest was confirmed", () => {
    const menu = menuActions(false);
    expect(menu.markup).toContain("Remover da biblioteca");
    expect(menu.markup).not.toContain("Remover e desinstalar");
    expect(menu.uninstallAction).toBeUndefined();
  });
});
