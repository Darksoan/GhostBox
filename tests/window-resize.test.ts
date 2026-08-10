import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Window resize and maximize support", () => {
  it("keeps the main window resizable and maximizable with a safe minimum size", () => {
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const window = config.app.windows.find((entry: { label: string }) => entry.label === "main");

    expect(window?.resizable).toBe(true);
    expect(window?.maximizable).toBe(true);
    expect(window?.minWidth).toBe(1024);
    expect(window?.minHeight).toBe(600);
    expect(window?.decorations).toBe(false);
  });

  it("does not re-lock the window flags from Rust", () => {
    const source = readFileSync("src-tauri/src/window_lifecycle.rs", "utf8");
    expect(source).not.toContain("set_resizable(false)");
    expect(source).not.toContain("set_maximizable(false)");
  });

  it("grants the window APIs the header maximize controls call", () => {
    const capabilities = JSON.parse(
      readFileSync("src-tauri/capabilities/default.json", "utf8")
    );
    const permissions = capabilities.permissions as string[];
    expect(permissions).toContain("core:window:allow-maximize");
    expect(permissions).toContain("core:window:allow-unmaximize");
    expect(permissions).toContain("core:window:allow-toggle-maximize");
    expect(permissions).toContain("core:window:allow-is-maximized");
  });

  it("persists window state between sessions via the window-state plugin", () => {
    const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(cargo).toContain("tauri-plugin-window-state");
    expect(lib).toContain("tauri_plugin_window_state::Builder::new().build()");
  });
});
