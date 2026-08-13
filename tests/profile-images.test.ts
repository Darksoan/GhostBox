import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bannerMaxDimension,
  bannerMaxPixels,
  bannerTargetBytes,
  canPassThrough,
  dataUrlByteLength,
  dataUrlMimeType,
  fitWithinBudget,
} from "../src/utils/profileImages";

describe("Capa do perfil — orçamento de reamostragem", () => {
  it("mantém fontes pequenas intactas em vez de ampliar", () => {
    const fitted = fitWithinBudget(1280, 720);
    expect(fitted).toEqual({ width: 1280, height: 720, scale: 1 });
  });

  it("cabe um 4K dentro do orçamento sem distorcer a proporção", () => {
    const fitted = fitWithinBudget(3840, 2160);

    expect(fitted.width * fitted.height).toBeLessThanOrEqual(bannerMaxPixels);
    expect(fitted.width / fitted.height).toBeCloseTo(16 / 9, 2);
    // O ponto do aumento: ainda cobre uma janela maximizada em 1440p sem esticar.
    expect(fitted.width).toBeGreaterThanOrEqual(2500);
  });

  it("não estrangula fonte quadrada como o corte por altura fazia", () => {
    // Com o teto antigo de 1080px de altura, um 2000×2000 caía para 1080 de
    // largura e a capa esticava quase 2x numa janela grande.
    const fitted = fitWithinBudget(2000, 2000);

    expect(fitted.width).toBeGreaterThan(1080);
    expect(fitted.width).toBe(fitted.height);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(bannerMaxPixels);
  });

  it("segura o lado longo de uma fonte panorâmica", () => {
    const fitted = fitWithinBudget(12000, 1200);

    expect(fitted.width).toBeLessThanOrEqual(bannerMaxDimension);
    expect(fitted.width / fitted.height).toBeCloseTo(10, 1);
  });

  it("trata dimensão ausente sem estourar", () => {
    expect(fitWithinBudget(0, 0)).toEqual({ width: 0, height: 0, scale: 1 });
  });
});

describe("Capa do perfil — leitura do data URL", () => {
  it("conta os bytes reais por trás do base64", () => {
    // "hello" → 5 bytes, independente do padding do base64.
    const dataUrl = `data:image/webp;base64,${Buffer.from("hello").toString("base64")}`;
    expect(dataUrlByteLength(dataUrl)).toBe(5);
  });

  it("lê o tipo declarado", () => {
    expect(dataUrlMimeType("data:image/webp;base64,AAAA")).toBe("image/webp");
    expect(dataUrlMimeType("não é data url")).toBe("");
  });

  it("só dispensa a recodificação de WebP que já cabe nos dois orçamentos", () => {
    const small = `data:image/webp;base64,${Buffer.from("x").toString("base64")}`;
    const fitted = { width: 1600, height: 900, scale: 1 };

    expect(canPassThrough(small, fitted)).toBe(true);
    // Precisou reamostrar: tem que passar pelo canvas de qualquer jeito.
    expect(canPassThrough(small, { ...fitted, scale: 0.5 })).toBe(false);
    // JPEG vira WebP — é a troca que paga o aumento de resolução.
    expect(
      canPassThrough(small.replace("image/webp", "image/jpeg"), fitted)
    ).toBe(false);
  });

  it("recodifica WebP acima do alvo de bytes", () => {
    const heavy = `data:image/webp;base64,${"A".repeat(
      Math.ceil((bannerTargetBytes + 1000) * (4 / 3))
    )}`;

    expect(dataUrlByteLength(heavy)).toBeGreaterThan(bannerTargetBytes);
    expect(canPassThrough(heavy, { width: 2560, height: 1440, scale: 1 })).toBe(
      false
    );
  });
});

describe("Capa do perfil — contrato com o servidor", () => {
  it("sobe num tipo que o worker e o comando Rust aceitam", () => {
    const worker = readFileSync("workers/subscriptions/src/index.ts", "utf8");
    const rust = readFileSync("src-tauri/src/cloud_save.rs", "utf8");

    expect(worker).toContain('["image/jpeg", "image/png", "image/webp"]');
    expect(rust).toContain('"image/jpeg" | "image/png" | "image/webp"');
  });

  it("guarda o servidor num teto por requisição bem acima do alvo do cliente", () => {
    const worker = readFileSync("workers/subscriptions/src/index.ts", "utf8");
    const match = /const maxBytes = (\d+) \* 1024 \* 1024;/.exec(worker);

    expect(match).not.toBeNull();
    const maxBytes = Number(match![1]) * 1024 * 1024;
    expect(maxBytes).toBeGreaterThan(bannerTargetBytes * 2);
    expect(maxBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("mantém um objeto fixo por usuário — sobrescreve em vez de acumular", () => {
    const worker = readFileSync("workers/subscriptions/src/index.ts", "utf8");

    expect(worker).toContain("`${auth.session!.userId}/${kind}.webp`");
    expect(worker).toContain('"x-upsert": "true"');
  });
});
