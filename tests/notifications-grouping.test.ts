import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { buildNotificationFeed } from "../src/pages/NotificationsPage";
import type { AppNotificationItem } from "../src/lib/appNotifications";

function notification(
  id: string,
  appId: string,
  createdAt: number
): AppNotificationItem {
  return {
    id,
    type: "achievement",
    severity: "success",
    title: "Conquista desbloqueada",
    message: `Conquista ${id}`,
    createdAt,
    game: { appId, title: `Jogo ${appId}` },
  };
}

describe("Notification feed grouping", () => {
  it("keeps games with fewer than three notifications as single rows", () => {
    const entries = buildNotificationFeed([
      notification("a", "1", 3),
      notification("b", "1", 2),
      notification("c", "2", 1),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.kind === "single")).toBe(true);
  });

  it("collapses three or more notifications of the same game into one group", () => {
    const entries = buildNotificationFeed([
      notification("a", "1", 5),
      notification("b", "1", 4),
      notification("c", "2", 3),
      notification("d", "1", 2),
    ]);

    // O grupo ocupa a posição do item mais recente do jogo, então a ordem
    // cronológica do feed continua valendo.
    expect(entries.map((entry) => entry.kind)).toEqual(["group", "single"]);
    const group = entries[0];
    if (group.kind !== "group") throw new Error("expected group entry");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b", "d"]);
  });

  it("never groups notifications without a game", () => {
    const orphan = (id: string): AppNotificationItem => ({
      id,
      type: "system",
      severity: "info",
      title: "Sistema",
      message: "Mensagem",
      createdAt: 1,
    });

    const entries = buildNotificationFeed([orphan("a"), orphan("b"), orphan("c")]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "single",
      "single",
      "single",
    ]);
  });

  it("animates the group panel by row template, with a reduced-motion escape", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let panelRules = "";
    let reducedMotionRules = "";

    stylesheet.walkRules((rule) => {
      if (rule.selector.includes(".app-notification-group__panel")) {
        const inMediaQuery = rule.parent?.type === "atrule";
        if (inMediaQuery) reducedMotionRules += rule.toString();
        else panelRules += rule.toString();
      }
    });

    // Altura automática animada por `grid-template-rows` (0fr → 1fr): sem isso
    // a abertura só funcionaria medindo o painel no JS.
    expect(panelRules).toContain("grid-template-rows: 0fr");
    expect(panelRules).toContain("grid-template-rows: 1fr");
    expect(reducedMotionRules).toContain("transition: none");
  });

  it("waits for notification art to load before mounting its fade-in layer", () => {
    const component = readFileSync("src/pages/NotificationsPage.tsx", "utf8");

    expect(component).toContain("const hasArt = loaded && Boolean(artSource);");
  });
});
