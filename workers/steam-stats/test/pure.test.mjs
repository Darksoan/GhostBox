import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSchemaAchievements,
  normalizeGlobalPercentages,
  mergeGlobalPercentages,
  parseRetryAfter,
  parseSimilarAppIds,
  sortWishlistItems,
  validAppId,
  validSteamId,
} from "../src/pure.mjs";

test("validSteamId accepts 15-20 digit ids", () => {
  assert.equal(validSteamId("76561197960287930"), true);
  assert.equal(validSteamId("bad"), false);
  assert.equal(validSteamId("123"), false);
});

test("validAppId accepts numeric app ids", () => {
  assert.equal(validAppId("570"), true);
  assert.equal(validAppId("730"), true);
  assert.equal(validAppId("abc"), false);
  assert.equal(validAppId(""), false);
});

test("parseRetryAfter supports seconds and http-date", () => {
  assert.equal(parseRetryAfter("120"), 120);
  assert.equal(parseRetryAfter("-5"), 0);
  const now = Date.parse("2026-07-16T12:00:00Z");
  assert.equal(parseRetryAfter("Thu, 16 Jul 2026 12:01:30 GMT", now), 90);
});

test("parseSimilarAppIds extracts unique app ids", () => {
  const html = `
    <div data-ds-appid="570"></div>
    <div data-ds-appid="730"></div>
    <div data-ds-appid="570"></div>
    <div data-ds-appid="440"></div>
  `;
  assert.deepEqual(parseSimilarAppIds(html, "570"), ["730", "440"]);
});

test("normalizeSchemaAchievements maps steam schema fields", () => {
  const result = normalizeSchemaAchievements({
    availableGameStats: {
      achievements: [
        {
          name: "WIN",
          displayName: "Victory",
          description: "Win once",
          icon: "a.png",
          icongray: "b.png",
        },
        { name: "", displayName: "Skip" },
      ],
    },
  });
  assert.deepEqual(result, [
    {
      name: "WIN",
      title: "Victory",
      description: "Win once",
      icon: "a.png",
      iconGray: "b.png",
    },
  ]);
});

test("sortWishlistItems prioritizes ranked items then recency", () => {
  const sorted = sortWishlistItems([
    { appId: "1", priority: 0, dateAdded: 10 },
    { appId: "2", priority: 2, dateAdded: 1 },
    { appId: "3", priority: 1, dateAdded: 5 },
    { appId: "4", priority: 0, dateAdded: 20 },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.appId),
    ["3", "2", "4", "1"]
  );
});

test("normalizeGlobalPercentages parses steam api response", () => {
  const result = normalizeGlobalPercentages({
    achievementpercentages: {
      achievements: [
        { name: "ACH_WIN", percent: 45.3 },
        { name: "ACH_PERFECT", percent: 2.1 },
        { name: "ACH_INVALID", percent: 150.5 },
        { name: "", percent: 10 },
        { name: "ACH_NAN", percent: "text" },
      ],
    },
  });
  assert.equal(result.size, 2);
  assert.equal(result.get("ACH_WIN"), 45.3);
  assert.equal(result.get("ACH_PERFECT"), 2.1);
  assert.equal(result.get("ACH_INVALID"), undefined);
  assert.equal(result.get(""), undefined);
  assert.equal(result.get("ACH_NAN"), undefined);
});

test("normalizeGlobalPercentages handles empty payload", () => {
  const result1 = normalizeGlobalPercentages(null);
  assert.equal(result1.size, 0);
  const result2 = normalizeGlobalPercentages({});
  assert.equal(result2.size, 0);
  const result3 = normalizeGlobalPercentages({ achievementpercentages: { achievements: [] } });
  assert.equal(result3.size, 0);
});

test("mergeGlobalPercentages adds globalPercent to achievements", () => {
  const achievements = [
    { name: "ACH_WIN", title: "Win", description: "Win once", icon: "a.png", iconGray: "b.png" },
    { name: "ACH_LOSE", title: "Lose", description: "Lose once", icon: "c.png", iconGray: "d.png" },
  ];
  const percentages = new Map([["ACH_WIN", 42.5]]);
  const result = mergeGlobalPercentages(achievements, percentages);
  assert.deepEqual(result, [
    { name: "ACH_WIN", title: "Win", description: "Win once", icon: "a.png", iconGray: "b.png", globalPercent: 42.5 },
    { name: "ACH_LOSE", title: "Lose", description: "Lose once", icon: "c.png", iconGray: "d.png" },
  ]);
});
