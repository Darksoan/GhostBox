# Tauri Visual Navigator MCP

Local MCP server that lets an AI client navigate a Tauri/Vite web UI with Playwright, inspect visible UI state, and capture screenshots for design review.

It is intentionally project-agnostic: any Tauri app that exposes its frontend through a dev server URL can use it.

## Install

```bash
cd mcp/visual-navigator
npm install
npm run build
```

Playwright downloads Chromium during install. If your package manager skips browser downloads, run:

```bash
npx playwright install chromium
```

## Run

```bash
npm start
```

MCP clients should run the built server through stdio:

```json
{
  "mcpServers": {
    "tauri-visual-navigator": {
      "command": "node",
      "args": ["E:/PirateBox-Tauri/mcp/visual-navigator/dist/index.js"],
      "env": {
        "VISUAL_MCP_HEADLESS": "true"
      }
    }
  }
}
```

For another Tauri project, change only the absolute path in `args`.

## Tools

- `visual_open_app`: opens a dev server URL with configurable viewport.
- `visual_set_viewport`: switches desktop/tablet/mobile viewport sizes.
- `visual_click`: clicks by visible text or CSS selector.
- `visual_snapshot_page`: returns URL, title, body text, and visible interactive elements.
- `visual_screenshot_page`: captures the current page and returns the image.
- `visual_capture_tabs`: clicks through labels/selectors and captures each state.
- `visual_close`: closes the browser session.

## Example Workflow

Start your app dev server:

```bash
npm run dev
```

Then ask the MCP client to:

1. Open `http://localhost:5173`.
2. Capture tabs such as `Inicio`, `Biblioteca`, `Downloads`, `Configuracoes`.
3. Repeat with viewport `390x844` for mobile.

Screenshots are saved by default to `.visual-mcp/screenshots` in the MCP process working directory. Override this with `VISUAL_MCP_SCREENSHOT_DIR`.

## Notes For Tauri

This MCP targets the web frontend exposed by Vite/Tauri dev mode. That is the most reliable path for visual design iteration. For native desktop-window automation, use a separate WebDriver/Tauri Driver setup.
