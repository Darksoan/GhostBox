import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("game settings modal", () => {
  const component = readFileSync(
    "src/components/modals/GameBackupOptionsModal.tsx",
    "utf8",
  );
  const styles = readFileSync("src/app.scss", "utf8");

  it("uses persistent navigation without a title block or game artwork", () => {
    expect(component).toContain('className="game-settings-modal__sidebar"');
    expect(component).toContain('className="game-settings-modal__nav"');
    expect(component).toContain('className="game-settings-modal__content"');
    expect(component).not.toContain('className="game-settings-modal__header"');
    expect(component).not.toContain('className="game-settings-modal__title-block"');
    expect(component).not.toContain("game-settings-modal__hero");
    expect(component).not.toContain("gameHeaderOnlySources");
    expect(styles).toContain("grid-template-columns: 210px minmax(0, 1fr)");
    expect(styles).toContain(
      "height: min(620px, calc(100vh - (var(--space-10) * 2)))",
    );
    expect(styles).toContain("align-self: stretch");
    expect(styles).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(styles).toContain("align-content: stretch");
  });

  it("uses motionless fades and removes redundant footer icons", () => {
    expect(component).toContain(
      'className="game-settings-modal__section-view" key={activeSection}',
    );
    expect(component).not.toContain("<Play size=");
    expect(component).not.toContain("<Save size=");
    expect(styles).toContain("@keyframes game-settings-section-in");
    expect(styles).toContain(".game-settings-modal__section-view");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toContain("translateX(var(--space-3))");
    expect(styles).not.toContain("translateX(var(--space-1))");
    expect(styles).not.toContain("transform: scale(0.98)");
    expect(styles).not.toContain("transform: scale(0.99)");
  });

  it("opens on launch and exposes the three planned sections", () => {
    expect(component).toContain('useState<SettingsSection>("launch")');
    expect(component).toContain('"launch" | "installation" | "organization"');
    expect(component).toContain("gameSettings.sections.launch");
    expect(component).toContain("gameSettings.sections.installation");
    expect(component).toContain("gameSettings.sections.collections");
  });

  it("keeps launch data out of shell interpolation in the frontend contract", () => {
    const api = readFileSync("src/lib/ghostboxApi.tauri.ts", "utf8");
    expect(api).toContain("launchArguments");
    expect(api).toContain('"ghostbox_library_list_executables"');
    expect(api).toContain(
      'return invoke<GameExecutableCandidate[]>(\n      "ghostbox_library_list_executables"',
    );
    expect(api).toContain('"game_create_shortcut"');
  });

  it("completes executable scans without cancelling loading and reports failures inline", () => {
    expect(component).toContain("executableScanRequestRef");
    expect(component).toContain(
      "[installTask?.outputDir, game?.installPath]",
    );
    expect(component).toContain("candidateState === \"error\"");
    expect(component).toContain('role="alert"');
    expect(component).toContain('t("gameSettings.launch.scanError")');
    expect(component).not.toContain(
      "    candidateState,\n    gameTitle,\n    launchMethod",
    );
  });

  it("keeps one desktop shortcut action and full-width launch arguments", () => {
    expect(component).toContain("createDesktopShortcut");
    expect(component).toContain('createGameShortcut(updated, "desktop")');
    expect(component).toContain(
      "saveLaunchSettings({ showSuccessToast: false })",
    );
    expect(component).toContain('<ExternalLink\n                            size={16}');
    expect(component).toContain('aria-label={t("gameSettings.launch.desktop")}');
    expect(component).toContain('aria-busy={shortcutBusy}');
    expect(component).toContain(
      'className="modal__add-spinner modal__add-spinner--light"',
    );
    expect(component).not.toContain('createShortcut("start-menu")');
    expect(styles).toContain(".game-settings-modal__field .settings-input");
    expect(styles).toContain("width: 100%");
    expect(styles).toContain("background: var(--surface-option-hover)");
    expect(styles).toContain("background: var(--surface-option-active)");
    expect(styles).not.toContain(
      ".game-settings-modal__field input:focus-visible",
    );
  });

  it("uses an icon-only browse action with the shortcut icon palette", () => {
    expect(component).toContain(
      'className="game-settings-modal__action-button game-settings-modal__icon-button"',
    );
    expect(component).toContain(
      'aria-label={t("gameSettings.launch.browse")}',
    );
    expect(component).not.toContain(
      '<FolderOpen size={14} strokeWidth={2} aria-hidden="true" />\n                        {t("gameSettings.launch.browse")}',
    );
    expect(styles).toMatch(
      /\.game-settings-modal__shortcut-button,\s*\.game-settings-modal__icon-button\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/,
    );
    expect(styles).toMatch(
      /\.game-settings-modal__icon-button:hover:not\(:disabled\),[\s\S]*?\.game-settings-modal__icon-button:focus-visible:not\(:disabled\)[\s\S]*?color:\s*var\(--text-primary\)/,
    );
  });

  it("matches the requirements tab surface state hierarchy", () => {
    expect(styles).toContain("background: var(--surface-option-hover)");
    expect(styles).toContain("background: var(--surface-option-active)");
    expect(styles).toContain("background: var(--surface-option-selected)");
  });

  it("uses the primary button tokens for saving launch settings", () => {
    const launchActions = component.match(
      /<div className="game-settings-modal__launch-actions">[\s\S]*?<\/div>/,
    )?.[0];
    expect(launchActions).toBeTruthy();
    expect(launchActions).toContain('className="button button--primary"');
    expect(launchActions).not.toContain("Loader2");
    expect(launchActions).not.toContain("data-loading");
    expect(component).not.toContain("testLaunch");
    expect(component).not.toContain("onTestLaunch");
  });

  it("pins save to the lower-right corner and gives the shortcut explicit surfaces", () => {
    expect(styles).toContain(
      ".game-settings-modal__launch-actions {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: var(--space-3);\n  margin-top: auto;\n  padding-top: var(--space-6);",
    );
    expect(component).toContain("game-settings-modal__rows--launch");
    expect(styles).toMatch(
      /\.game-settings-modal__rows--launch\s*\{[\s\S]*?flex:\s*1 0 auto;[\s\S]*?flex-direction:\s*column/,
    );
    expect(component).toContain("game-settings-modal__shortcut-button");
    expect(styles).toMatch(
      /\.game-settings-modal__shortcut-button,\s*\.game-settings-modal__icon-button\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--text-secondary\)/,
    );
    expect(styles).toMatch(
      /\.game-settings-modal__shortcut-button,\s*\.game-settings-modal__icon-button\s*\{[\s\S]*?width:\s*40px;[\s\S]*?justify-content:\s*center/,
    );
    expect(styles).toMatch(
      /\.game-settings-modal__shortcut-button:hover:not\(:disabled\),[\s\S]*?\.game-settings-modal__shortcut-button:focus-visible:not\(:disabled\)[\s\S]*?color:\s*var\(--text-primary\)/,
    );
  });

  it("keeps action feedback in global toasts instead of the modal footer", () => {
    expect(component).toContain("const { showToast } = useOverlay()");
    expect(component).toContain("showToast(");
    expect(component).not.toContain("game-settings-modal__feedback");
    expect(component).not.toContain("actionMessage");
    expect(component).not.toContain("launchFeedback");
    expect(styles).not.toContain(".game-settings-modal__feedback");
  });

  it("adds a subtle gap below the section subtitle", () => {
    expect(styles).toContain(
      ".game-settings-modal__section-header {\n  display: grid;\n  gap: var(--space-2);\n  margin-bottom: var(--space-1);",
    );
  });
});
