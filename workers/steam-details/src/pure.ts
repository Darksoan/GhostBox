export type Language = "portuguese" | "english";

type UnknownObject = Record<string, unknown>;

export type SteamMovie = {
  id: number | string;
  name: string;
  thumbnail: string;
  highlight: boolean;
  hls_h264: string;
  dash_h264: string;
  dash_av1: string;
  mp4: { max: string; "480": string };
  webm: { max: string; "480": string };
};

export type GameDetails = {
  appId: string;
  createdAt: number;
  name: string;
  headerImage: string;
  screenshots: string[];
  movies: SteamMovie[];
  aboutTheGame: string;
  shortDescription: string;
  genres: string[];
  pcRequirements: { minimum: string[]; recommended: string[] };
  developers: string[];
  publishers: string[];
};

function isObject(value: unknown): value is UnknownObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function first(object: UnknownObject, keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function aliasedText(object: UnknownObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(object[key]);
    if (value) return value;
  }
  return "";
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      const point = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    if (lower.startsWith("#")) {
      const point = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[lower] ?? entity;
  });
}

export function validAppId(value: string | undefined): value is string {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return false;
  return Number(value) <= 4_294_967_295;
}

export function parseLanguage(value: string | null): Language | null {
  if (value === null) return "portuguese";
  return value === "portuguese" || value === "english" ? value : null;
}

export function parseRequirements(value: unknown): string[] {
  if (Array.isArray(value)) return textArray(value);
  const html = text(value);
  if (!html) return [];

  const lines = decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:li|p|div)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "")
      .replace(/<[^>]*>/g, "")
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return lines.filter(
    (line) =>
      !/^(?:minimum|recommended|m\u00ednimos?|minimos?|recomendados?)\s*:$/i.test(line)
  );
}

function normalizeScreenshots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      return isObject(item) ? aliasedText(item, "path_full", "pathFull", "full") : "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

function mediaGroup(value: unknown): { max: string; "480": string } {
  if (!isObject(value)) return { max: "", "480": "" };
  return { max: text(value.max), "480": text(value["480"]) };
}

function normalizeMovies(value: unknown): SteamMovie[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    const id = item.id;
    if (typeof id !== "number" && typeof id !== "string") return [];
    const mp4 = mediaGroup(item.mp4);
    const webm = mediaGroup(item.webm);
    const hlsH264 = aliasedText(item, "hls_h264", "hlsH264");
    const dashH264 = aliasedText(item, "dash_h264", "dashH264");
    const dashAv1 = aliasedText(item, "dash_av1", "dashAv1");
    if (!hlsH264 && !dashH264 && !dashAv1 && !mp4.max && !mp4["480"] && !webm.max && !webm["480"]) {
      return [];
    }
    return [{
      id,
      name: text(item.name),
      thumbnail: text(item.thumbnail),
      highlight: item.highlight === true,
      hls_h264: hlsH264,
      dash_h264: dashH264,
      dash_av1: dashAv1,
      mp4,
      webm,
    }];
  });
}

function normalizeGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((genre) => {
      if (typeof genre === "string") return genre.trim();
      return isObject(genre) ? aliasedText(genre, "description", "name") : "";
    })
    .filter(Boolean)
    .slice(0, 6);
}

export function normalizeStoreDetails(
  appId: string,
  value: unknown,
  createdAt = Date.now()
): GameDetails | null {
  if (!isObject(value)) return null;
  const requirements = first(value, ["pc_requirements", "pcRequirements"]);
  const requirementObject = isObject(requirements) ? requirements : {};

  return {
    appId,
    createdAt,
    name: aliasedText(value, "name", "title"),
    headerImage: aliasedText(value, "header_image", "headerImage"),
    screenshots: normalizeScreenshots(value.screenshots),
    movies: normalizeMovies(value.movies),
    aboutTheGame: aliasedText(value, "about_the_game", "aboutTheGame"),
    shortDescription: aliasedText(value, "short_description", "shortDescription"),
    genres: normalizeGenres(value.genres),
    pcRequirements: {
      minimum: parseRequirements(requirementObject.minimum),
      recommended: parseRequirements(requirementObject.recommended),
    },
    developers: textArray(value.developers),
    publishers: textArray(value.publishers),
  };
}

export function steamAppData(payload: unknown, appId: string): unknown | null {
  if (!isObject(payload)) return null;
  const app = payload[appId];
  if (!isObject(app) || app.success !== true || !isObject(app.data)) return null;
  return app.data;
}
