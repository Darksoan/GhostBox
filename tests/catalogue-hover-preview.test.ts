import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Catalogue hover preview", () => {
  const component = readFileSync(
    "src/components/ui/CatalogueHoverPreview.tsx",
    "utf8"
  );

  it("shows game details immediately and fills decoded screenshots as they arrive", () => {
    expect(component).toContain("gameCataloguePreviewScreenshotSourceGroups");
    expect(component).toContain("getCachedImageSource(candidate) || candidate");
    expect(component).toContain("setDisplayedPreview(batch)");
    expect(component).toContain("pendingPreview.shots.every(isSettled)");
    expect(component).toContain("setDisplayedPreview(pendingPreview)");
    expect(component).toContain("generation");
    expect(component).toContain('fetchPriority="high"');
    expect(component).toContain('loading="eager"');
  });

  it("settles failed slots without leaving the previous game's images in the panel", () => {
    expect(component).toContain("displayedPreview");
    expect(component).toContain("pendingPreview");
    expect(component).toContain("status: \"failed\"");
    expect(component).toContain("catalogue-hover-preview__shot--empty");
    expect(component).not.toContain("catalogue-hover-preview__shot--skeleton");
    expect(component).not.toContain("setTimeout(");
  });

  it("contains no preview fade transition", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const previewRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".catalogue-hover-preview"
    );

    expect(previewRule?.toString()).not.toContain("transition:");
    expect(compile("src/app.scss").css).not.toContain(
      "catalogue-hover-preview--visible"
    );
    expect(compile("src/app.scss").css).not.toContain(
      "catalogue-hover-preview--hidden"
    );
  });
});
