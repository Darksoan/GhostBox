import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  live: vi.fn(),
  history: vi.fn(),
  state: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", () => ({
  useState: (initialize: () => unknown) => [initialize(), mocks.state],
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
}));
vi.mock("../src/lib/downloadManager", () => ({
  getLiveDownloadTaskByAppId: mocks.live,
  readDownloadTasks: mocks.history,
  downloadTasksChangedEvent: "downloads-changed",
}));
import { useGameDownloadTask } from "../src/hooks/useGameDownloadTask";

describe("modal download state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.effects.length = 0;
    mocks.live.mockReturnValue(null);
    mocks.history.mockReturnValue([]);
  });

  it("recognizes an already completed download when opening the modal", () => {
    const completed = { appId: "10", status: "completed" };
    mocks.history.mockReturnValue([completed]);
    expect(useGameDownloadTask("10", true)).toEqual(completed);
    expect(useGameDownloadTask("10")).toBeNull();
  });

  it("updates to completed when the download finishes and clears after deletion", () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    mocks.live.mockReturnValue({ appId: "10", status: "downloading" });
    useGameDownloadTask("10", true);
    const cleanup = mocks.effects[0]();
    const completed = { appId: "10", status: "completed" };
    mocks.live.mockReturnValue(null);
    mocks.history.mockReturnValue([completed]);
    events.dispatchEvent(new Event("downloads-changed"));
    expect(mocks.state).toHaveBeenLastCalledWith(completed);
    mocks.history.mockReturnValue([]);
    events.dispatchEvent(new Event("downloads-changed"));
    expect(mocks.state).toHaveBeenLastCalledWith(null);
    cleanup?.();
    vi.unstubAllGlobals();
  });

  it("does not treat failed downloads or another game's history as completed", () => {
    mocks.history.mockReturnValue([
      { appId: "10", status: "error" },
      { appId: "20", status: "completed" },
    ]);
    expect(useGameDownloadTask("10", true)).toBeNull();
  });

  it("prioritizes an ongoing download over its old history", () => {
    const paused = { appId: "10", status: "paused" };
    mocks.live.mockReturnValue(paused);
    mocks.history.mockReturnValue([{ appId: "10", status: "completed" }]);
    expect(useGameDownloadTask("10", true)).toEqual(paused);
  });
});
