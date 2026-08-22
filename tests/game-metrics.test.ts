import { describe, expect, it } from "vitest";
import {
  getControllerSupportCopy,
  parseSupportedLanguages,
  resolveControllerSupportStatus,
} from "../src/utils/gameMetrics";

describe("parseSupportedLanguages", () => {
  it("returns an empty list for missing or empty input", () => {
    expect(parseSupportedLanguages(undefined)).toEqual([]);
    expect(parseSupportedLanguages(null)).toEqual([]);
    expect(parseSupportedLanguages("")).toEqual([]);
  });

  it("parses languages and detects audio (dubbing) via asterisks", () => {
    const raw =
      "Inglês<strong>*</strong>, Francês, Português (Brasil)<strong>*</strong><br>legendas disponíveis em todos os idiomas";
    expect(parseSupportedLanguages(raw)).toEqual([
      { language: "Inglês", hasAudio: true },
      { language: "Francês", hasAudio: false },
      { language: "Português (Brasil)", hasAudio: true },
    ]);
  });

  it("only considers entries before the first <br>", () => {
    const raw =
      "Inglês<br>Inglês<strong>*</strong> e legendas em outros idiomas";
    expect(parseSupportedLanguages(raw)).toEqual([
      { language: "Inglês", hasAudio: false },
    ]);
  });

  it("strips leftover HTML tags and decodes entities from names", () => {
    const raw = "<span>Inglês</span>, Português &amp; Espanhol<strong>*</strong>";
    expect(parseSupportedLanguages(raw)).toEqual([
      { language: "Inglês", hasAudio: false },
      { language: "Português & Espanhol", hasAudio: true },
    ]);
  });

  it("supports <br/> variants", () => {
    expect(parseSupportedLanguages("Inglês<br/>Japonês")).toEqual([
      { language: "Inglês", hasAudio: false },
    ]);
  });
});

describe("resolveControllerSupportStatus", () => {
  it("maps known values and trims case/whitespace", () => {
    expect(resolveControllerSupportStatus("full")).toBe("full");
    expect(resolveControllerSupportStatus(" partial ")).toBe("partial");
    expect(resolveControllerSupportStatus("FULL")).toBe("full");
  });

  it("maps missing or unknown values to none", () => {
    expect(resolveControllerSupportStatus(undefined)).toBe("none");
    expect(resolveControllerSupportStatus(null)).toBe("none");
    expect(resolveControllerSupportStatus("")).toBe("none");
    expect(resolveControllerSupportStatus("unknown")).toBe("none");
  });
});

describe("getControllerSupportCopy", () => {
  it("localizes labels to English and Portuguese", () => {
    expect(getControllerSupportCopy("full", false).label).toBe("SUPORTE TOTAL");
    expect(getControllerSupportCopy("full", true).label).toBe("FULL SUPPORT");
    expect(getControllerSupportCopy("partial", false).label).toBe(
      "SUPORTE PARCIAL"
    );
    expect(getControllerSupportCopy("partial", true).description).toContain(
      "keyboard"
    );
    expect(getControllerSupportCopy("none", false).description).toBeUndefined();
  });

  it("describes partial support with keyboard/mouse hint in Portuguese", () => {
    expect(getControllerSupportCopy("partial", false).description).toContain(
      "teclado"
    );
  });
});
