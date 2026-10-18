import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { translate } from "../src/i18n";
import { SettingsPage } from "../src/pages/SettingsPage";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useId: () => "launch-preference",
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
}));
vi.mock("../src/context/settings", () => ({ useSettings: () => ({
  appearance: { language: "pt" }, notifications: {}, updateAppearance: vi.fn(), updateNotifications: vi.fn(),
  t: (key: string) => translate("pt", key),
}) }));
vi.mock("../src/features/settings/DownloadSettingsSection", () => ({ DownloadSettingsSection: () => null }));
vi.mock("../src/features/settings/ConnectionsPanel", () => ({ ConnectionsPanel: () => null, HiddenProfileGamesSection: () => null, SteamVisibilitySection: () => null }));
vi.mock("../src/features/settings/TempFilesSection", () => ({ TempFilesSection: () => null }));
vi.mock("../src/components/subscription/SubscriptionPlans", () => ({ SubscriptionPlans: () => null }));
vi.mock("../src/components/subscription/SubscriptionBackdrop", () => ({ SubscriptionBackdrop: () => null }));

function props(enabled = true) {
  return {
    activeTabId: "downloads" as const, libraryView: "overview" as const,
    onLibraryViewChange: vi.fn(), searchQuery: "", onClearSearchQuery: vi.fn(), games: [], steamProfile: null,
    initialPage: "home" as const, onInitialPageChange: vi.fn(), steamPath: "E:\\Steam", onSelectSteamPath: vi.fn(),
    startupSettings: { openAtLogin: false, startMinimized: false, minimizeToTray: false, gameDatabaseUpdateIntervalHours: 24, openSteamOnGameLaunch: enabled },
    onStartupSettingsChange: vi.fn(), backupSettings: null,
  };
}

type Element = ReactElement<{ children?: ReactNode; option?: { checked: boolean; onToggle: (next: boolean) => void } }>;
function elements(node: ReactNode): Element[] {
  return isValidElement<Element["props"]>(node) ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
}

describe("Steam launch preference", () => {
  it.each([true, false])("renders the saved switch value %s and achievement caveats", (enabled) => {
    const markup = renderToStaticMarkup(createElement(SettingsPage, props(enabled)));
    expect(markup).toContain("Abrir Steam ao iniciar jogo baixado pelo GhostBox");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain(`aria-checked="${enabled}"`);
    expect(markup).toContain("registrar conquistas");
    expect(markup).toContain("dependendo da licença e da integração");
    expect(markup).toContain("jogos que exigem a Steam");
    expect(markup).toContain('aria-describedby="launch-preference-description"');
  });

  it("persists only the launch preference without overwriting other startup settings", () => {
    const input = props();
    const row = elements(SettingsPage(input)).find((element) => element.props.option?.onToggle)!;
    row.props.option!.onToggle(false);
    expect(input.onStartupSettingsChange).toHaveBeenCalledWith({ openSteamOnGameLaunch: false });
  });

  it("routes the preference through the shared backend launcher before opening a Steam URI", () => {
    const source = readFileSync("src-tauri/src/lib.rs", "utf8");
    const launcher = source.slice(source.indexOf("pub(crate) fn launch_game_from_value"), source.indexOf("fn launch_app_id_from_args"));
    expect(launcher.indexOf("local_launch::direct_launch_enabled")).toBeLessThan(launcher.indexOf("steam://rungameid/"));
    expect(launcher).toContain("local_launch::resolve_ghostbox_game");
    expect(launcher).toContain("local_launch::launch");
    const direct = readFileSync("src-tauri/src/local_launch.rs", "utf8");
    expect(direct).not.toContain("prepare_game_for_offline_launch(");
    expect(direct).not.toContain(".open_url(");
  });
});
