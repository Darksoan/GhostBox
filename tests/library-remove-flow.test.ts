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

function menuActions(steamInstallConfirmed: boolean, removable = true) {
  let removeCalls = 0;
  let removeAction: (() => void) | undefined;

  function Menu() {
    const items = useCollectionContextMenu({
      game: registeredGame,
      favoriteGameIds: new Set(),
      libraryGameAppIds: new Set(["123"]),
      removableGameAppIds: new Set(removable ? ["123"] : []),
      steamInstallConfirmed,
      userCollections: [],
      onRemoveGame: () => { removeCalls += 1; },
    });
    removeAction = items.find((item) => item.label === "Remover da biblioteca")?.onClick;
    return createElement(
      "div",
      null,
      items.map((item) => createElement("span", { key: item.label }, item.label)),
    );
  }

  const markup = renderToStaticMarkup(createElement(Menu));
  return {
    markup,
    removeAction,
    get removeCalls() { return removeCalls; },
  };
}

describe("library removal context menu", () => {
  it("offers only one removal entry for an installed registered game", () => {
    const menu = menuActions(true);
    expect(menu.markup).toContain("Remover da biblioteca");
    expect(menu.markup).not.toContain("Remover e desinstalar");
    menu.removeAction?.();
    expect(menu.removeCalls).toBe(1);
  });

  it("still offers library removal when no manifest was confirmed", () => {
    const menu = menuActions(false);
    expect(menu.markup).toContain("Remover da biblioteca");
    expect(menu.markup).not.toContain("Remover e desinstalar");
    menu.removeAction?.();
    expect(menu.removeCalls).toBe(1);
  });

  it("keeps removal accessible for installed games without a removable library entry", () => {
    const menu = menuActions(true, false);
    expect(menu.markup).toContain("Remover da biblioteca");
    expect(menu.markup).not.toContain("Remover e desinstalar");
    expect(menu.removeAction).toBeDefined();
  });
});
