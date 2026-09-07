import { describe, expect, it } from "vitest";
import { documentFor, reserveBatch } from "../scripts/backfill-search-index.mjs";

describe("resumable FTS backfill", () => {
  const state = { format: 2, cursor: "1059860", day: "2026-09-06", writes: 69999, leaseUntil: 0 };

  it("reserves writes before a batch and retains its cursor across interruptions", () => {
    const reserved = reserveBatch(state, state.day, 1000);
    expect(reserved.writes).toBe(79999);
    expect(reserved.cursor).toBe(state.cursor);
    expect(reserveBatch(reserved, state.day, 1001)).toBeNull();
    expect(reserveBatch(reserved, state.day, 601001)).toBeNull();
  });

  it("resumes after UTC rollover without dropping the checkpoint", () => {
    expect(reserveBatch({ ...state, writes: 79999 }, "2026-09-07", 1000))
      .toMatchObject({ cursor: state.cursor, day: "2026-09-07", writes: 10000 });
    expect(reserveBatch({ ...state, writes: Number.NaN }, state.day, 1000)).toBeNull();
  });

  it("preserves exact facet punctuation and indexes only the twelve visible tags", () => {
    const row = { app_id: "10", name: "Ação Épica", developers_json: '["C++","C#"]',
      tags_json: JSON.stringify(Array.from({ length: 13 }, (_, i) => `Tag${i}`)) };
    const doc = documentFor(row);
    expect(doc[0]).toContain("acao epica");
    expect(doc[2].split(" ")).toHaveLength(12);
    expect(new Set(doc[3].split(" ")).size).toBe(2);
  });
});
