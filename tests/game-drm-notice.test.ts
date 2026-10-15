import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameDrmNotice } from "../src/components/modals/GameDrmNotice";

describe("game DRM notice", () => {
  it.each([
    ["pt", "Este jogo contém DRM", "DRM informado pela Steam"],
    ["en", "This game contains DRM", "DRM reported by Steam"],
  ])("renders the %s warning with accessible details", (language, label, heading) => {
    const markup = renderToStaticMarkup(createElement(GameDrmNotice, {
      notice: "Incorporates 3rd-party DRM: Denuvo",
      language,
    }));
    const tooltipId = markup.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(markup).toContain(label);
    expect(markup).toContain(heading);
    expect(markup).toContain("Incorporates 3rd-party DRM: Denuvo");
    expect(markup).toContain('tabindex="0"');
    expect(tooltipId).toBeTruthy();
    expect(markup).toContain(`id="${tooltipId}"`);
    expect(markup).toContain('role="tooltip" hidden=""');
    expect(markup).not.toContain('role="img"');
  });

  it("renders store-provided details as text, not HTML", () => {
    const markup = renderToStaticMarkup(createElement(GameDrmNotice, {
      notice: "<script>alert('test')</script>",
      language: "pt",
    }));

    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("uses a transparent badge with an outline matching the icon", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const badgeStyles = styles.match(/&__drm-badge\s*\{[\s\S]*?\n  \}/)?.[0];

    expect(badgeStyles).toContain("border: 1px solid currentColor;");
    expect(badgeStyles).toContain("background: transparent;");
    expect(badgeStyles).toContain("color: var(--caution);");
    expect(badgeStyles).toContain("display: inline-flex;");
  });
});
