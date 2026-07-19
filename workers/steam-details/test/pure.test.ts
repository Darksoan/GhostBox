import { describe, expect, it } from "vitest";
import {
  normalizeStoreDetails,
  parseLanguage,
  parseRequirements,
  steamAppData,
  validAppId,
} from "../src/pure";

describe("request validation", () => {
  it("validates Steam app IDs", () => {
    expect(validAppId("570")).toBe(true);
    expect(validAppId("0")).toBe(false);
    expect(validAppId("01")).toBe(false);
    expect(validAppId("4294967296")).toBe(false);
    expect(validAppId("abc")).toBe(false);
  });

  it("allows only supported languages and defaults to Portuguese", () => {
    expect(parseLanguage(null)).toBe("portuguese");
    expect(parseLanguage("portuguese")).toBe("portuguese");
    expect(parseLanguage("english")).toBe("english");
    expect(parseLanguage("brazilian")).toBeNull();
    expect(parseLanguage("")).toBeNull();
  });
});

describe("Steam normalization", () => {
  it("parses HTML requirements into lines", () => {
    expect(
      parseRequirements("<strong>Minimum:</strong><br><ul><li>OS: Windows 10</li><li>RAM: 8 GB</li></ul>")
    ).toEqual(["OS: Windows 10", "RAM: 8 GB"]);
  });

  it("normalizes Steam fields and camelCase aliases", () => {
    const details = normalizeStoreDetails(
      "570",
      {
        name: "Dota 2",
        header_image: "header.jpg",
        headerImage: "ignored.jpg",
        screenshots: [{ path_full: "one.jpg" }, { pathFull: "two.jpg" }],
        movies: [{
          id: 1,
          name: "Trailer",
          hlsH264: "movie.m3u8",
          mp4: { max: "movie.mp4" },
        }],
        about_the_game: "",
        aboutTheGame: "About",
        short_description: "Short",
        genres: [{ description: "Action" }, "Strategy"],
        pcRequirements: { minimum: ["Windows"], recommended: "RAM: 16 GB" },
        developers: ["Valve"],
        publishers: ["Valve"],
      },
      1784419200000
    );

    expect(details).toMatchObject({
      appId: "570",
      createdAt: 1784419200000,
      name: "Dota 2",
      headerImage: "header.jpg",
      screenshots: ["one.jpg", "two.jpg"],
      aboutTheGame: "About",
      shortDescription: "Short",
      genres: ["Action", "Strategy"],
      pcRequirements: { minimum: ["Windows"], recommended: ["RAM: 16 GB"] },
      developers: ["Valve"],
      publishers: ["Valve"],
    });
    expect(details?.movies[0]).toMatchObject({ hls_h264: "movie.m3u8" });
  });

  it("extracts only successful appdetails data", () => {
    expect(steamAppData({ "570": { success: true, data: { name: "Dota 2" } } }, "570"))
      .toEqual({ name: "Dota 2" });
    expect(steamAppData({ "570": { success: false } }, "570")).toBeNull();
  });
});
