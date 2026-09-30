import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { SettingsProvider } from "../src/context/settings";
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

  const markup = renderToStaticMarkup(
    createElement(SettingsProvider, null, createElement(Menu)),
  );
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

function hideMenuMarkup(options?: {
  library?: boolean;
  favorite?: boolean;
  hideable?: boolean;
}) {
  function Menu() {
    const items = useCollectionContextMenu({
      game: registeredGame,
      favoriteGameIds: new Set(options?.favorite ? ["steam-123"] : []),
      libraryGameAppIds: new Set(options?.library ? ["123"] : []),
      userCollections: [],
      hideableGameAppIds: new Set(options?.hideable ? ["123"] : []),
      onToggleHidden: () => {},
    });
    return createElement(
      "div",
      null,
      items.map((item) => createElement("span", { key: item.label }, item.label)),
    );
  }

  return renderToStaticMarkup(
    createElement(SettingsProvider, null, createElement(Menu)),
  );
}

describe("profile hide context menu", () => {
  it("offers hide from profile for library games", () => {
    expect(hideMenuMarkup({ library: true })).toContain("Ocultar no perfil");
  });

  it("offers hide from profile for favorites and hideable (history/owned) games", () => {
    expect(hideMenuMarkup({ favorite: true })).toContain("Ocultar no perfil");
    expect(hideMenuMarkup({ hideable: true })).toContain("Ocultar no perfil");
  });

  it("hides the profile option for catalogue games the user does not own", () => {
    const markup = hideMenuMarkup();
    expect(markup).not.toContain("Ocultar no perfil");
    expect(markup).not.toContain("Mostrar no perfil");
  });
});
