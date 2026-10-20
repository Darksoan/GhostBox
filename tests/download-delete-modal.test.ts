import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadRemoveModal } from "../src/components/modals/DownloadRemoveModal";
import type { DownloadTask } from "../src/lib/downloadManager";
import { deleteDownloadTask } from "../src/lib/downloadManager";

const setters = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const setter = vi.fn();
    setters.push(setter);
    return [initial, setter];
  },
}));
vi.mock("react-dom", async (original) => ({
  ...await original<typeof import("react-dom")>(),
  createPortal: (children: ReactNode) => children,
}));
vi.mock("../src/context/settings", () => ({
  useSettings: () => ({ appearance: { language: "pt" }, t: (key: string) => key }),
}));
vi.mock("../src/lib/downloadManager", () => ({
  deleteDownloadTask: vi.fn(), repairDownloadLibrary: vi.fn(), resumeDownloadTask: vi.fn(),
}));

type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function elements(node: ReactNode): Element[] {
  return isValidElement<Element["props"]>(node)
    ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
}
const task: DownloadTask = {
  id: "10", appId: "10", title: "Game", headerSources: [], downloadsRoot: "E:\\Games", outputDir: "E:\\Games\\Game",
  status: "paused", queuedAt: 1000, bytesDownloaded: 10, bytesTotal: 100, speedBytesPerSecond: 0, depotIndex: 1, depotTotal: 1,
};
beforeEach(() => { setters.length = 0; vi.clearAllMocks(); vi.stubGlobal("document", { body: {} }); });
afterEach(() => vi.unstubAllGlobals());

describe("Download deletion confirmation", () => {
  it("closes on Cancel without switching to the download information modal", () => {
    const onClose = vi.fn();
    const tree = elements(DownloadRemoveModal({ task, onClose }));
    const cancel = tree.find((element) => element.type === "button" && element.props.children === "downloads.cancel")!;
    expect(tree.some((element) => element.type === "dl")).toBe(false);
    (cancel.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
    expect(setters.every((setter) => setter.mock.calls.length === 0)).toBe(true);
  });

  it.each(["downloading", "paused", "queued", "error"] as const)("automatically requests partial file cleanup for %s downloads without a checkbox", async (status) => {
    const onClose = vi.fn();
    const tree = elements(DownloadRemoveModal({ task: { ...task, status }, onClose }));
    expect(tree.some((element) => element.type === "input")).toBe(false);
    const confirm = tree.find((element) => element.type === "button" && element.props.children === "downloads.confirmCancel")!;
    (confirm.props.onClick as () => void)();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(deleteDownloadTask).toHaveBeenCalledWith(task.id, true);
  });

  it("removes only the completed download record and leaves uninstall choices to the library", async () => {
    const onClose = vi.fn();
    const tree = elements(DownloadRemoveModal({ task: { ...task, status: "completed" }, onClose }));
    expect(tree.some((element) => element.type === "input")).toBe(false);
    const confirm = tree.find((element) => element.type === "button" && element.props.children === "downloads.confirmRemove")!;
    (confirm.props.onClick as () => void)();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(deleteDownloadTask).toHaveBeenCalledWith(task.id, false);
  });
});
