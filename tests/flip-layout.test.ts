import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("useFlipLayout — motion design e reorganização de capas", () => {
  it("utiliza tokens calibrados de motion design para duração e curva ease-out", () => {
    const source = readFileSync("src/hooks/useFlipLayout.ts", "utf8");

    // Duração base de 220ms e curva cubic-bezier(0.16, 1, 0.3, 1) conforme motion-design
    expect(source).toContain("FLIP_DURATION_MS = 220");
    expect(source).toContain('FLIP_EASING = "cubic-bezier(0.16, 1, 0.3, 1)"');
  });

  it("observa redimensionamento do container via ResizeObserver para disparar FLIP no resize", () => {
    const source = readFileSync("src/hooks/useFlipLayout.ts", "utf8");

    expect(source).toContain("ResizeObserver");
    expect(source).toContain("lastContainerWidthRef");
    expect(source).toContain("performFlip(true)");
  });

  it("suporta cancelamento e captura visual contínua sem saltos ou teleporte", () => {
    const source = readFileSync("src/hooks/useFlipLayout.ts", "utf8");

    expect(source).toContain("currentVisualRects");
    expect(source).toContain("wasAnimating");
    expect(source).toContain("getBoundingClientRect");
    expect(source).toContain("willChange");
  });

  it("respeita prefers-reduced-motion e desativação de animações", () => {
    const source = readFileSync("src/hooks/useFlipLayout.ts", "utf8");

    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("no-animations");
    expect(source).toContain("motionIsDisabled");
  });
});
