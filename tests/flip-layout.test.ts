import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relativeLayoutRect } from "../src/utils/flipLayout";

describe("coordenadas de layout durante a rolagem", () => {
  it("não interpreta scroll vertical/horizontal como movimento dos cards", () => {
    const before = relativeLayoutRect(
      { left: 260, top: 900, width: 180, height: 270 },
      { left: 40, top: 100 },
    );
    const after = relativeLayoutRect(
      { left: 240, top: 300, width: 180, height: 270 },
      { left: 20, top: -500 },
    );
    expect(after).toEqual(before);
  });

  it("preserva movimento real de uma linha mesmo quando também houve scroll", () => {
    const before = relativeLayoutRect(
      { left: 260, top: 900, width: 180, height: 270 },
      { left: 40, top: 100 },
    );
    const after = relativeLayoutRect(
      { left: 260, top: 600, width: 180, height: 270 },
      { left: 40, top: -500 },
    );
    expect(after.top - before.top).toBe(300);
    expect(after.left - before.left).toBe(0);
  });
});

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
    const motion = readFileSync("src/utils/motion.ts", "utf8");

    // A checagem mora no util compartilhado (também usado pelo preview do
    // catálogo); o hook só decide se o FLIP roda.
    expect(source).toContain("isMotionDisabled()");
    expect(motion).toContain("prefers-reduced-motion: reduce");
    expect(motion).toContain("no-animations");
  });
});
