#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

type VisibleElement = {
  tag: string;
  role: string | null;
  text: string;
  ariaLabel: string | null;
};

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;

const server = new McpServer({
  name: "tauri-visual-navigator",
  version: "0.1.0",
});

const defaultScreenshotDir = path.resolve(
  process.env.VISUAL_MCP_SCREENSHOT_DIR ?? path.join(process.cwd(), ".visual-mcp", "screenshots"),
);

async function ensurePage(options?: {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  headless?: boolean;
}): Promise<Page> {
  const width = options?.width ?? 1440;
  const height = options?.height ?? 1000;
  const deviceScaleFactor = options?.deviceScaleFactor ?? 1;
  const headless = options?.headless ?? process.env.VISUAL_MCP_HEADLESS !== "false";

  if (!browser) {
    browser = await chromium.launch({ headless });
  }

  if (!context) {
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
  }

  if (!page || page.isClosed()) {
    page = await context.newPage();
  }

  return page;
}

async function resetContext(options: {
  width: number;
  height: number;
  deviceScaleFactor: number;
  headless: boolean;
}): Promise<Page> {
  if (context) {
    await context.close();
    context = undefined;
    page = undefined;
  }

  return ensurePage(options);
}

function cleanName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "screenshot";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function screenshot(targetPage: Page, fileName: string, fullPage: boolean): Promise<{ filePath: string; base64: string }> {
  await mkdir(defaultScreenshotDir, { recursive: true });
  const filePath = path.join(defaultScreenshotDir, fileName);
  await targetPage.screenshot({ path: filePath, fullPage });
  const buffer = await readFile(filePath);

  return { filePath, base64: buffer.toString("base64") };
}

async function clickTarget(targetPage: Page, args: { selector?: string; text?: string; exact?: boolean; timeoutMs?: number }) {
  const timeout = args.timeoutMs ?? 7000;

  if (args.selector) {
    await targetPage.locator(args.selector).first().click({ timeout });
    return;
  }

  if (args.text) {
    await targetPage.getByText(args.text, { exact: args.exact ?? false }).first().click({ timeout });
    return;
  }

  throw new Error("Provide either selector or text.");
}

async function waitForUi(targetPage: Page, timeoutMs: number) {
  await targetPage.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
  await targetPage.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 3000) }).catch(() => undefined);
  await targetPage.waitForTimeout(250);
}

async function visibleElements(targetPage: Page, limit: number): Promise<VisibleElement[]> {
  return targetPage.evaluate((max) => {
    const elements = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role], nav *, aside *, [aria-label]"));

    return elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
        ariaLabel: element.getAttribute("aria-label"),
      }))
      .filter((element) => element.text || element.ariaLabel)
      .slice(0, max);
  }, limit);
}

server.registerTool(
  "visual_open_app",
  {
    title: "Open app URL",
    description: "Open a web UI URL, usually a Tauri/Vite dev server such as http://localhost:1420 or http://localhost:5173.",
    inputSchema: {
      url: z.string().url().describe("URL to open, for example http://localhost:5173."),
      width: z.number().int().min(320).max(3840).default(1440),
      height: z.number().int().min(320).max(2400).default(1000),
      deviceScaleFactor: z.number().min(0.5).max(4).default(1),
      headless: z.boolean().default(process.env.VISUAL_MCP_HEADLESS !== "false"),
      waitMs: z.number().int().min(0).max(30000).default(7000),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args) => {
    const targetPage = await resetContext(args);
    await targetPage.goto(args.url, { waitUntil: "domcontentloaded", timeout: args.waitMs });
    await waitForUi(targetPage, args.waitMs);

    return {
      content: [
        {
          type: "text",
          text: `Opened ${targetPage.url()} at ${args.width}x${args.height} on ${os.platform()}.`,
        },
      ],
    };
  },
);

server.registerTool(
  "visual_set_viewport",
  {
    title: "Set viewport",
    description: "Resize the active browser page to inspect desktop, tablet, or mobile layouts.",
    inputSchema: {
      width: z.number().int().min(320).max(3840),
      height: z.number().int().min(320).max(2400),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    const targetPage = await ensurePage();
    await targetPage.setViewportSize({ width: args.width, height: args.height });
    await waitForUi(targetPage, 3000);

    return { content: [{ type: "text", text: `Viewport set to ${args.width}x${args.height}.` }] };
  },
);

server.registerTool(
  "visual_click",
  {
    title: "Click UI element",
    description: "Click an element in the active app by CSS selector or visible text. Prefer selector for stable test IDs and text for exploratory navigation.",
    inputSchema: {
      selector: z.string().optional().describe("CSS selector to click, for example [data-testid='settings-tab']."),
      text: z.string().optional().describe("Visible text to click, for example Settings or Configuracoes."),
      exact: z.boolean().default(false).describe("Whether text matching should be exact."),
      timeoutMs: z.number().int().min(500).max(30000).default(7000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    const targetPage = await ensurePage();
    await clickTarget(targetPage, args);
    await waitForUi(targetPage, args.timeoutMs);

    return { content: [{ type: "text", text: `Clicked ${args.selector ? `selector ${args.selector}` : `text ${args.text}`}. Current URL: ${targetPage.url()}` }] };
  },
);

server.registerTool(
  "visual_snapshot_page",
  {
    title: "Inspect visible UI",
    description: "Return the current URL, title, visible body text, and a compact list of visible interactive/navigation elements.",
    inputSchema: {
      textLimit: z.number().int().min(500).max(12000).default(5000),
      elementsLimit: z.number().int().min(5).max(200).default(80),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    const targetPage = await ensurePage();
    const [title, bodyText, elements] = await Promise.all([
      targetPage.title(),
      targetPage.locator("body").innerText({ timeout: 3000 }).catch(() => ""),
      visibleElements(targetPage, args.elementsLimit),
    ]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              url: targetPage.url(),
              title,
              text: bodyText.replace(/\s+/g, " ").trim().slice(0, args.textLimit),
              elements,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "visual_screenshot_page",
  {
    title: "Screenshot current page",
    description: "Capture a screenshot of the active app page and return both the saved file path and image content.",
    inputSchema: {
      name: z.string().optional().describe("Optional filename prefix. A timestamp and .png extension are added automatically."),
      fullPage: z.boolean().default(true),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    const targetPage = await ensurePage();
    const fileName = `${cleanName(args.name ?? "page")}-${timestamp()}.png`;
    const result = await screenshot(targetPage, fileName, args.fullPage);

    return {
      content: [
        { type: "text", text: `Screenshot saved to ${result.filePath}` },
        { type: "image", data: result.base64, mimeType: "image/png" },
      ],
    };
  },
);

server.registerTool(
  "visual_capture_tabs",
  {
    title: "Capture app tabs",
    description: "Navigate through a list of tab/menu labels or selectors and capture a screenshot plus compact visible-text summary for each state.",
    inputSchema: {
      url: z.string().url().optional().describe("Optional URL to open before capturing tabs."),
      tabs: z.array(z.string()).min(1).max(30).describe("Visible tab labels, menu labels, or selectors to click."),
      matchBy: z.enum(["text", "selector"]).default("text"),
      exact: z.boolean().default(false),
      width: z.number().int().min(320).max(3840).default(1440),
      height: z.number().int().min(320).max(2400).default(1000),
      fullPage: z.boolean().default(true),
      includeImages: z.boolean().default(true).describe("Return screenshots inline. Disable if the client context gets too large."),
      waitMs: z.number().int().min(500).max(30000).default(7000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    const targetPage = await ensurePage({ width: args.width, height: args.height });

    if (args.url) {
      await targetPage.goto(args.url, { waitUntil: "domcontentloaded", timeout: args.waitMs });
      await waitForUi(targetPage, args.waitMs);
    }

    await targetPage.setViewportSize({ width: args.width, height: args.height });

    const captures: Array<{ tab: string; url: string; filePath: string; text: string; error?: string }> = [];
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }> = [];

    for (const tab of args.tabs) {
      try {
        await clickTarget(targetPage, {
          selector: args.matchBy === "selector" ? tab : undefined,
          text: args.matchBy === "text" ? tab : undefined,
          exact: args.exact,
          timeoutMs: args.waitMs,
        });
        await waitForUi(targetPage, args.waitMs);

        const fileName = `${cleanName(tab)}-${args.width}x${args.height}-${timestamp()}.png`;
        const shot = await screenshot(targetPage, fileName, args.fullPage);
        const bodyText = await targetPage.locator("body").innerText({ timeout: 3000 }).catch(() => "");
        const text = bodyText.replace(/\s+/g, " ").trim().slice(0, 1000);
        captures.push({ tab, url: targetPage.url(), filePath: shot.filePath, text });

        if (args.includeImages) {
          content.push({ type: "text", text: `Tab: ${tab}\nURL: ${targetPage.url()}\nScreenshot: ${shot.filePath}\nText: ${text}` });
          content.push({ type: "image", data: shot.base64, mimeType: "image/png" });
        }
      } catch (error) {
        captures.push({
          tab,
          url: targetPage.url(),
          filePath: "",
          text: "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!args.includeImages) {
      content.push({ type: "text", text: JSON.stringify(captures, null, 2) });
    }

    return { content };
  },
);

server.registerTool(
  "visual_close",
  {
    title: "Close browser",
    description: "Close the Playwright browser session used by this MCP server.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    if (browser) {
      await browser.close();
    }

    browser = undefined;
    context = undefined;
    page = undefined;

    return { content: [{ type: "text", text: "Browser closed." }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
