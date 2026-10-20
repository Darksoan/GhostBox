import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n";
import { useDownloadCompletionToast } from "../src/hooks/useDownloadCompletionToast";
import { downloadCompletedEvent } from "../src/lib/downloadManager";
import { Toast } from "../src/components/ui/Toast";

const state = vi.hoisted(() => ({ showToast: vi.fn(), cleanup: undefined as (() => void) | undefined, language: "pt" as "pt" | "en" }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));
vi.mock("../src/context/OverlayContext", () => ({ useOverlay: () => ({ showToast: state.showToast }) }));
vi.mock("../src/context/settings", () => ({ useSettings: () => ({
  appearance: { language: state.language }, notifications: { toastDurationSeconds: 6 },
  t: (key: string) => translate(state.language, key),
}) }));
vi.mock("../src/hooks/useCachedImageSources", () => ({
  useCachedImageSources: (sources: string[]) => sources,
  useLoadableImageCover: (sources: string[]) => ({ source: sources[0] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.language = "pt";
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => { state.cleanup?.(); state.cleanup = undefined; vi.unstubAllGlobals(); });

describe("download completion toast", () => {
  it("shows the game art and localized completion message through the shared toast provider", () => {
    useDownloadCompletionToast();
    window.dispatchEvent(new CustomEvent(downloadCompletedEvent, {
      detail: { id: "203160", appId: "203160", title: "Tomb Raider", headerSources: ["https://example.com/header.jpg"] },
    }));
    expect(state.showToast).toHaveBeenCalledWith("Tomb Raider", "Download concluído com sucesso.", "success", {
      imageSources: expect.arrayContaining(["https://example.com/header.jpg"]), layout: "game",
    });
    const [title, message, variant, options] = state.showToast.mock.calls[0];
    const markup = renderToStaticMarkup(createElement(Toast, {
      toast: { id: 1, title, message, variant, ...options }, onClose: vi.fn(),
    }));
    expect(markup).toContain("toast--game");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('class="toast__capsule"');
    expect(markup).toContain("Tomb Raider");
    expect(markup).toContain("Download concluído com sucesso.");
  });

  it("falls back to Steam artwork and uses the current language", () => {
    state.language = "en";
    useDownloadCompletionToast();
    window.dispatchEvent(new CustomEvent(downloadCompletedEvent, {
      detail: { id: "203160", appId: "203160", title: "Tomb Raider", headerSources: [] },
    }));
    expect(state.showToast.mock.calls[0][1]).toBe("Download completed successfully.");
    expect(state.showToast.mock.calls[0][3].imageSources.length).toBeGreaterThan(0);
  });

  it("does not replay history on mount and removes the listener on unmount", () => {
    useDownloadCompletionToast();
    expect(state.showToast).not.toHaveBeenCalled();
    state.cleanup?.();
    window.dispatchEvent(new CustomEvent(downloadCompletedEvent, {
      detail: { id: "203160", appId: "203160", title: "Tomb Raider", headerSources: [] },
    }));
    expect(state.showToast).not.toHaveBeenCalled();
  });
});
