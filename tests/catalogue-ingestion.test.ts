import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  ingestCatalogueGameOnOpen,
  resetCatalogueIngestionSessionForTests,
} from "../src/utils/catalogueIngestion";

const externalGame = {
  appId: "2943650",
  id: "steam-2943650",
  title: "FragPunk",
} as GhostBoxGame;

describe("catalogue ingestion on game open", () => {
  beforeEach(() => resetCatalogueIngestionSessionForTests());

  it("ingests an AppID once per session and invalidates after success", async () => {
    const ingest = vi.fn(async () => undefined);
    const invalidate = vi.fn(async () => undefined);

    await Promise.all([
      ingestCatalogueGameOnOpen(externalGame, { ingest, invalidate }),
      ingestCatalogueGameOnOpen(externalGame, { ingest, invalidate }),
    ]);
    await ingestCatalogueGameOnOpen(externalGame, { ingest, invalidate });

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a failed ingestion", async () => {
    const ingest = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const invalidate = vi.fn(async () => undefined);

    await expect(
      ingestCatalogueGameOnOpen(externalGame, { ingest, invalidate }),
    ).rejects.toThrow("offline");
    await expect(
      ingestCatalogueGameOnOpen(externalGame, { ingest, invalidate }),
    ).resolves.toBe(true);

    expect(ingest).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("skips games already present in the database", async () => {
    const ingest = vi.fn(async () => undefined);
    await ingestCatalogueGameOnOpen(
      { ...externalGame, databaseAddedAt: 1 },
      { ingest, invalidate: vi.fn() },
    );
    expect(ingest).not.toHaveBeenCalled();
  });
});
