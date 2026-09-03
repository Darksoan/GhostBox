import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnimatedAvatarError,
  animatedAvatarTargetBytes,
  animatedImageMime,
  assembleAnimatedWebp,
  encodeAnimatedWebp,
} from "../src/utils/animatedWebp";
import { encodeAvatarDataUrl } from "../src/utils/profileImages";

function chunk(name: string, data: number[]) {
  const output = Buffer.alloc(8 + data.length + (data.length % 2));
  output.write(name);
  output.writeUInt32LE(data.length, 4);
  output.set(data, 8);
  return output;
}

const frame = Buffer.concat([
  Buffer.from("RIFF\0\0\0\0WEBP"),
  chunk("EXIF", [1, 2, 3]),
  chunk("ALPH", [0, 255, 255, 255]),
  chunk("VP8 ", [1, 2, 3]),
]);
frame.writeUInt32LE(frame.length - 8, 4);

function chunks(bytes: Uint8Array, start = 12) {
  const buffer = Buffer.from(bytes);
  const output: { tag: string; data: Buffer }[] = [];
  for (let offset = start; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    output.push({ tag: buffer.toString("ascii", offset, offset + 4), data: buffer.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size % 2);
  }
  return output;
}

afterEach(() => vi.unstubAllGlobals());

describe("Avatar animado", () => {
  it("preserva duração, repetição, transparência e os quadros no contêiner WebP", () => {
    const output = assembleAnimatedWebp(256, [
      { webp: frame, duration: 100 }, { webp: frame, duration: 250 },
    ], 2);
    expect(Buffer.from(output).readUInt32LE(4)).toBe(output.length - 8);
    const parts = chunks(output);
    expect(parts.map(part => part.tag)).toEqual(["VP8X", "ANIM", "ANMF", "ANMF"]);
    expect(parts[0].data[0]).toBe(0x12);
    expect(parts[0].data.readUIntLE(4, 3)).toBe(255);
    expect(parts[1].data.readUInt16LE(4)).toBe(3);
    expect(parts.slice(2).map(part => part.data.readUIntLE(12, 3))).toEqual([100, 250]);
    expect(parts[2].data[15]).toBe(2);
    expect(chunks(parts[2].data, 16).map(part => part.tag)).toEqual(["ALPH", "VP8 "]);
    expect(animatedImageMime(output)).toBe("image/webp");
  });

  it("preserva o loop infinito e remove metadados que não são usados pelo avatar", () => {
    const output = assembleAnimatedWebp(128, [{ webp: frame, duration: 80 }], Infinity);
    expect(chunks(output)[1].data.readUInt16LE(4)).toBe(0);
    expect(Buffer.from(output).includes(Buffer.from("EXIF"))).toBe(false);
  });

  it("identifica GIF pelo conteúdo e não confunde WebP estático com animação", () => {
    expect(animatedImageMime(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(animatedImageMime(frame)).toBeNull();
    expect(animatedImageMime(new Uint8Array())).toBeNull();
  });

  it("recusa encoder PNG de fallback em vez de produzir um arquivo animado inválido", () => {
    expect(() => assembleAnimatedWebp(256, [{ webp: Buffer.from("PNG"), duration: 100 }], 0))
      .toThrow(AnimatedAvatarError);
  });

  it.each(["image/gif", "application/octet-stream"])("não transforma GIF (%s) em imagem estática sem ImageDecoder", async (mime) => {
    vi.stubGlobal("ImageDecoder", undefined);
    const source = `data:${mime};base64,${Buffer.from("GIF89a").toString("base64")}`;
    await expect(encodeAvatarDataUrl(source, { x: 50, y: 50, scale: 1 }))
      .rejects.toMatchObject({ reason: "unsupported" });
  });

  it("limita a entrada antes de alocar um decoder e mantém o alvo abaixo do teto da nuvem", async () => {
    expect(animatedAvatarTargetBytes).toBeLessThan(4 * 1024 * 1024);
    const decoder = vi.fn();
    vi.stubGlobal("ImageDecoder", decoder);
    await expect(encodeAnimatedWebp(new Uint8Array(21 * 1024 * 1024), "image/gif", vi.fn()))
      .rejects.toMatchObject({ reason: "tooLarge" });
    expect(decoder).not.toHaveBeenCalled();
  });

  it("interrompe uma operação cancelada antes de decodificar", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(encodeAnimatedWebp(new Uint8Array(), "image/gif", vi.fn(), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("libera o decoder quando a quantidade de quadros ultrapassa o limite", async () => {
    const close = vi.fn();
    vi.stubGlobal("ImageDecoder", class {
      static isTypeSupported = async () => true;
      tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 601 } };
      close = close;
    });
    await expect(encodeAnimatedWebp(new Uint8Array(), "image/gif", vi.fn()))
      .rejects.toMatchObject({ reason: "tooLarge" });
    expect(close).toHaveBeenCalledOnce();
  });
});
