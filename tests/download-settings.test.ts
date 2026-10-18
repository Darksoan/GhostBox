import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { translate } from "../src/i18n";
import type { DownloadDestination } from "../src/lib/ghostboxApi.types";
import { writeStoredDownloadsDir } from "../src/lib/downloadManager";
import { settingsNavigationTabs, settingsTabDescriptionKeys, settingsTabLabelKeys } from "../src/features/settings/settingsTabsShared";
import { DownloadSettingsSection } from "../src/features/settings/DownloadSettingsSection";

const state = vi.hoisted(() => ({ destinations: [] as DownloadDestination[], directory: "E:\\Games", loading: false, error: "" }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useId: () => "download-library-options",
  useState: (initial: unknown) => [Array.isArray(initial) ? state.destinations : initial === true ? state.loading : typeof initial === "string" ? state.error : initial, vi.fn()],
}));
vi.mock("../src/context/settings", () => ({ useSettings: () => ({ appearance: { language: "pt" }, t: (key: string, params?: Record<string, string | number>) => translate("pt", key, params) }) }));
vi.mock("../src/hooks/useDownloadsDirectory", () => ({ useDownloadsDirectory: () => state.directory }));
vi.mock("../src/lib/ghostboxApi", () => ({ ghostboxApi: {} }));
vi.mock("../src/lib/downloadManager", () => ({ writeStoredDownloadsDir: vi.fn() }));

type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function elements(node: ReactNode): Element[] {
  return isValidElement<Element["props"]>(node) ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
}
const library = (extra: Partial<DownloadDestination> = {}): DownloadDestination => ({
  path: "E:\\Games", drive: "E:", label: "XPG", kind: "fixed", isLibrary: true,
  available: true, freeBytes: 188.54 * 1024 ** 3, totalBytes: 476.9 * 1024 ** 3, ...extra,
});
const render = () => renderToStaticMarkup(createElement(DownloadSettingsSection, { steamPath: "E:\\Steam" }));
beforeEach(() => { state.destinations = []; state.directory = "E:\\Games"; state.loading = false; state.error = ""; vi.clearAllMocks(); });

describe("download destination settings", () => {
  it("exposes a dedicated settings tab", () => {
    expect(settingsNavigationTabs.some((tab) => tab.id === "downloads")).toBe(true);
    expect(settingsTabLabelKeys.downloads).toBe("settings.tabs.downloads.label");
    expect(settingsTabDescriptionKeys.downloads).toBe("settings.tabs.downloads.description");
    expect(readFileSync("src/pages/SettingsPage.tsx", "utf8")).toContain('<DownloadSettingsSection steamPath={steamPath} />');
  });

  it("renders a horizontal radio grid with disk names, free capacity and a login-style checkmark", () => {
    state.destinations = [library(), library({ path: "D:\\SteamLibrary", drive: "D:", label: "XrayDisk" })];
    const markup = render();
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain("Destino dos downloads");
    expect(markup).not.toContain("Bibliotecas Steam");
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).toContain("XPG (E:)");
    expect(markup).toContain("XrayDisk (D:)");
    expect(markup).toContain("188,54 GB livres");
    expect(markup).toMatch(/<span>188,54 GB livres<\/span><span class="download-library-settings__check"/);
    expect(markup).not.toContain("lucide-star");
    expect(markup).toContain('class="download-library-settings__check" aria-hidden="true"');
    expect(markup).toContain('d="M1 5.52L3.92 9.17L9.17 1"');
    expect(markup.match(/<input[^>]+>/g)?.find((input) => input.includes('value="E:\\Games"'))).toContain('checked=""');
    expect(markup).not.toContain("settings-dropdown");
    expect(markup).not.toContain("settings-input");
    expect(markup).not.toContain("Atualizar bibliotecas");
    expect(markup).not.toContain("Pasta de downloads");
  });

  it("saves the clicked registered library as the download destination", () => {
    state.destinations = [library(), library({ path: "D:\\SteamLibrary", drive: "D:" })];
    const tree = elements(DownloadSettingsSection({ steamPath: "E:\\Steam" }));
    const radio = tree.find((element) => element.type === "input" && element.props.value === "D:\\SteamLibrary")!;
    (radio.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(writeStoredDownloadsDir).toHaveBeenCalledWith("D:\\SteamLibrary");
  });

  it("never offers unregistered disks and prevents selection of unavailable libraries", () => {
    state.destinations = [library(), library({ path: "C:\\Custom", label: "Not registered", isLibrary: false }), library({ path: "F:\\Steam", drive: "F:", label: "Offline", available: false })];
    const markup = render();
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).not.toContain("Not registered");
    expect(markup).toContain("Unidade indisponível");
    const tree = elements(DownloadSettingsSection({ steamPath: "E:\\Steam" }));
    const offline = tree.find((element) => element.type === "input" && element.props.value === "F:\\Steam")!;
    expect(offline.props.disabled).toBe(true);
    (offline.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(writeStoredDownloadsDir).not.toHaveBeenCalled();
  });

  it("distinguishes multiple libraries on the same disk by their paths", () => {
    state.destinations = [library(), library({ path: "E:\\OtherLibrary" })];
    const markup = render();
    expect(markup).toContain("E:\\Games</span>");
    expect(markup).toContain("E:\\OtherLibrary</span>");
  });

  it("preserves shared destination normalization and only marks the chosen library", () => {
    state.directory = "e:/games/";
    state.destinations = [library(), library({ path: "D:\\SteamLibrary", drive: "D:" })];
    expect(render().match(/ checked=""/g)).toHaveLength(1);
    state.directory = "C:\\Unregistered";
    expect(render()).not.toContain('checked=""');
    expect(render()).not.toContain("lucide-star");
  });

  it("reports loading and empty libraries without restoring the old path and refresh options", () => {
    state.loading = true;
    expect(render()).toContain("Consultando discos");
    state.loading = false;
    expect(render()).toContain("Nenhuma biblioteca Steam registrada");
    expect(render()).not.toContain("settings-action");
    expect(render()).not.toContain('type="text"');
  });

  it("allows retry on query errors without adding a permanent refresh setting", () => {
    state.error = "Offline";
    expect(render()).toContain('role="alert"');
    expect(render()).toContain("Tentar novamente");
    expect(render()).not.toContain("Atualizar bibliotecas");
  });

  it("uses a wrapping horizontal grid and existing app tokens", () => {
    const stylesheet = postcss.parse(compile("src/features/settings/DownloadSettingsSection.scss").css);
    const values: Record<string, Record<string, string>> = {};
    stylesheet.walkRules((rule) => {
      if (rule.parent.type !== "root") return;
      rule.walkDecls((decl) => { (values[rule.selector] ??= {})[decl.prop] = decl.value; });
    });
    expect(values[".download-library-settings__grid"]).toMatchObject({ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" });
    expect(values[".download-library-settings"]).toMatchObject({ background: "var(--surface-panel)", padding: "var(--space-7) var(--space-9)" });
    expect(values[".download-library-settings__option-body"]).toMatchObject({ background: "var(--surface-raised)", border: "0" });
    expect(values[".download-library-settings__option input:checked + .download-library-settings__option-body"]).toMatchObject({ background: "var(--surface-option-active)", color: "var(--text-primary)" });
    expect(values[".download-library-settings__capacity"]).toMatchObject({ "font-size": "var(--downloads-storage-meta-size)" });
    expect(values[".download-library-settings__check path"]).toMatchObject({ "stroke-dashoffset": "16" });
    expect(values[".download-library-settings__option input:checked + .download-library-settings__option-body .download-library-settings__check path"]).toMatchObject({ "stroke-dashoffset": "0", animation: "download-library-check-draw var(--motion-slow) var(--ease-out) var(--motion-fast) both" });
    expect(stylesheet.nodes.some((node) => node.type === "atrule" && node.name === "keyframes" && node.params === "download-library-check-draw")).toBe(true);
    expect(values[".download-library-settings__option input:checked + .download-library-settings__option-body .download-library-settings__check"].animation).toContain("download-library-check-appear");
  });

  it("keeps library selection exclusive to VDF registrations without a custom folder picker", () => {
    const settings = readFileSync("src/features/settings/DownloadSettingsSection.tsx", "utf8");
    expect(settings).toContain("registeredDownloadLibraries(result)");
    expect(settings).toContain("destination.isLibrary && destination.available");
    expect(settings).not.toContain("selectDownloadsDir");
    expect(settings).not.toContain("chooseFolder");
    const native = readFileSync("src-tauri/src/download_storage.rs", "utf8");
    expect(native).toContain("read_registered_steam_library_paths");
    expect(native).toContain("GetDiskFreeSpaceExW");
    expect(native).not.toContain("create_dir");
  });
});
