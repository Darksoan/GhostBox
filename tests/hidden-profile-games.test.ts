import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterAndSortHiddenProfileGames,
  getHiddenProfileGameInitial,
  hasHiddenProfileGameEvidence,
} from "../src/utils/hiddenProfileGames";
import type { GhostBoxGame } from "../src/data";

const games = [
  { appId: "3", title: "Árvore Sombria" },
  { appId: "1", title: "Among Us" },
  { appId: "2", title: "Apex Legends" },
];

describe("filterAndSortHiddenProfileGames", () => {
  it("excludes download-only entries without play, backup, or personal metrics", () => {
    const downloadOnly = {
      appId: "4004820",
      title: "Download incompleto",
      playTimeInMilliseconds: 0,
      achievements: { unlocked: 0, total: 24, progress: 0 },
      achievementList: [],
    } as GhostBoxGame;

    expect(hasHiddenProfileGameEvidence(downloadOnly, new Set())).toBe(false);
    expect(
      hasHiddenProfileGameEvidence(
        { ...downloadOnly, lastTimePlayed: "2026-09-10T10:00:00.000Z" },
        new Set(),
      ),
    ).toBe(true);
    expect(
      hasHiddenProfileGameEvidence(
        { ...downloadOnly, playTimeInMilliseconds: 60_000 },
        new Set(),
      ),
    ).toBe(true);
    expect(
      hasHiddenProfileGameEvidence(
        {
          ...downloadOnly,
          achievements: { unlocked: 1, total: 24, progress: 4 },
        },
        new Set(),
      ),
    ).toBe(true);
    expect(hasHiddenProfileGameEvidence(downloadOnly, new Set(["4004820"]))).toBe(true);
    expect(
      hasHiddenProfileGameEvidence(
        downloadOnly,
        new Set(),
        new Set(["4004820"]),
      ),
    ).toBe(true);
  });

  it("keeps hidden games first and sorts each group by title", () => {
    expect(filterAndSortHiddenProfileGames(games, new Set(["2"]), "")).toEqual([
      { appId: "2", title: "Apex Legends" },
      { appId: "1", title: "Among Us" },
      { appId: "3", title: "Árvore Sombria" },
    ]);
  });

  it("filters titles without requiring matching accents or case", () => {
    expect(filterAndSortHiddenProfileGames(games, new Set(), "ARVORE")).toEqual([
      { appId: "3", title: "Árvore Sombria" },
    ]);
  });

  it("filters by an accent-insensitive initial", () => {
    expect(getHiddenProfileGameInitial("Árvore Sombria")).toBe("A");
    expect(filterAndSortHiddenProfileGames(games, new Set(), "", "A")).toEqual([
      { appId: "1", title: "Among Us" },
      { appId: "2", title: "Apex Legends" },
      { appId: "3", title: "Árvore Sombria" },
    ]);
    expect(filterAndSortHiddenProfileGames(games, new Set(), "", "B")).toEqual([]);
  });

  it("keeps the alphabet beside a four-column desktop grid", () => {
    const styles = readFileSync(
      "src/features/settings/ConnectionsPanel.scss",
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(styles).toContain(".hidden-profile-games-page__alphabet");
    expect(styles).toContain("grid-template-columns: 42px minmax(0, 1fr)");
  });

  it("routes back through the titlebar and freezes ordering until the next entry", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const section = readFileSync("src/features/settings/ConnectionsPanel.tsx", "utf8");
    const alphabetStart = section.indexOf(
      'className={`hidden-profile-games-page__alphabet',
    );
    const alphabetEnd = section.indexOf(
      'className="hidden-profile-games__list"',
      alphabetStart,
    );
    const alphabet = section.slice(alphabetStart, alphabetEnd);
    const alphabetLetters = alphabet.slice(
      alphabet.indexOf("PROFILE_GAME_ALPHABET.map"),
    );

    expect(app).toContain('settingsLibraryView === "hidden-games"');
    expect(app).toContain('setSettingsLibraryView("overview")');
    expect(section).not.toContain("hidden-profile-games-page__back");
    expect(section).toContain("entryHiddenGameIdsRef");
    expect(section).toContain("entryHiddenGameIdsRef.current");
    expect(section).toContain("PROFILE_GAME_ALPHABET.map");
    expect(section).toContain("<ArrowDownAZ");
    expect(section).toContain("clearAlphabetFilter");
    expect(section).toContain("hoveredAlphabetIndex");
    expect(section).toContain("activeInitial");
    expect(section).toContain("onMouseEnter");
    expect(section).toContain("setSelectedInitial(letter)");
    expect(alphabet).toContain("onClick");
    expect(alphabetLetters).not.toContain("onClick");
    expect(alphabet).not.toContain("onMouseLeave");
    expect(section).not.toContain("pendingHiddenGameId");
    expect(section).not.toContain("scrollSnapshotRef");
    expect(section).not.toContain("data-layout-id={appId}");
  });
});
