#!/usr/bin/env node
// Baixa um recorte do catálogo real do GhostBox (worker piratebox-catalogue) e
// gera os assets do site: capas em webp + src/content/games.generated.ts.
//
// Rodar quando quiser atualizar a vitrine:
//   node GhostBoxSite/scripts/sync-games.mjs
//
// Requer ffmpeg no PATH (usado só para converter/redimensionar).
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const API = "https://piratebox-catalogue.hella.workers.dev";
const DETAILS_API = "https://piratebox-steam-details.hella.workers.dev";
const SITE = fileURLToPath(new URL("..", import.meta.url));
const IMAGES_DIR = `${SITE}public/games`;
const OUTPUT = `${SITE}src/content/games.generated.ts`;

// Curadoria por appId: a ordem aqui é a ordem que aparece na página. São
// títulos que existem no catálogo e que qualquer pessoa reconhece de relance.
const SHOWCASE = [
  "1086940", // Baldur's Gate 3
  "292030", // The Witcher 3
  "1145360", // Hades
  "367520", // Hollow Knight
  "413150", // Stardew Valley
  "2050650", // Resident Evil 4
  "105600", // Terraria
  "264710", // Subnautica
  "294100", // RimWorld
  "588650", // Dead Cells
  "2379780", // Balatro
  "526870", // Satisfactory
  "1794680", // Vampire Survivors
  "322330", // Don't Starve Together
  "227300", // Euro Truck Simulator 2
  "239140", // Dying Light
  "620", // Portal 2
  "550", // Left 4 Dead 2
];

// Jogo do banner da home. Precisa publicar library_hero.jpg.
const BANNER_APP_ID = "1086940";
// Jogo aberto na coluna de prévia do Catálogo — leva duas capturas de tela.
const PREVIEW_APP_ID = "292030";

/** header.jpg é o único formato que todo jogo publica; portrait falha às vezes. */
const VARIANTS = {
  header: { asset: "header.jpg", width: 460, quality: 80 },
  portrait: { asset: "library_600x900.jpg", width: 300, quality: 80 },
  hero: { asset: "library_hero.jpg", width: 1440, quality: 78 },
};

async function fetchJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
  return response.json();
}

/** O proxy de imagem responde 502 de vez em quando; uma segunda tentativa resolve. */
async function fetchAsset(appId, asset, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${API}/images/steam/apps/${appId}/${asset}`);
    if (response.ok) return response;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  return null;
}

async function downloadVariant(appId, variant) {
  const { asset, width, quality } = VARIANTS[variant];
  const response = await fetchAsset(appId, asset);
  if (!response) return null;

  const source = `${IMAGES_DIR}/.tmp-${appId}-${variant}`;
  const target = `${IMAGES_DIR}/${appId}-${variant}.webp`;
  await writeFile(source, Buffer.from(await response.arrayBuffer()));

  try {
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-i", source,
      "-vf", `scale=${width}:-2`,
      "-c:v", "libwebp",
      "-quality", String(quality),
      target,
    ]);
  } finally {
    await rm(source, { force: true });
  }

  return `/games/${appId}-${variant}.webp`;
}

function developerOf(game) {
  // subtitle vem como "Gênero / Gênero - Estúdio".
  const [, developer] = String(game.subtitle ?? "").split(" - ");
  return developer?.trim() || "";
}

/**
 * Mesma conta do app (`getSteamReviewScore` + HomeTopRatedShelf): proporção de
 * reviews positivas vezes 5. Sem amostra de review não existe nota.
 */
function ratingOf(game) {
  const ratio = game.steamPositiveRatio;
  const count = game.steamReviewCount;
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "";
  if (!count || count <= 0) return "";
  return ((ratio * 100) / 100 * 5).toFixed(1);
}

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Captura de tela 16:9 para a coluna de prévia do Catálogo. */
async function downloadScreenshot(appId, url, index) {
  const response = await fetch(url);
  if (!response.ok) return null;

  const source = `${IMAGES_DIR}/.tmp-${appId}-shot${index}`;
  const target = `${IMAGES_DIR}/${appId}-shot${index}.webp`;
  await writeFile(source, Buffer.from(await response.arrayBuffer()));

  try {
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-i", source,
      "-vf", "scale=640:-2",
      "-c:v", "libwebp",
      "-quality", "76",
      target,
    ]);
  } finally {
    await rm(source, { force: true });
  }

  return `/games/${appId}-shot${index}.webp`;
}

function serialize(value) {
  return JSON.stringify(value, null, 2).replace(/\n/g, "\n");
}

const home = await fetchJson("/home");
const byAppId = new Map(home.popular.map((game) => [String(game.appId), game]));

await mkdir(IMAGES_DIR, { recursive: true });

const games = [];
for (const appId of SHOWCASE) {
  const game = byAppId.get(appId) ?? (await fetchJson(`/games/${appId}`))?.game;
  if (!game) {
    console.warn(`sync-games: ${appId} não está no catálogo, pulando.`);
    continue;
  }

  const [header, portrait, hero] = await Promise.all([
    downloadVariant(appId, "header"),
    downloadVariant(appId, "portrait"),
    appId === BANNER_APP_ID ? downloadVariant(appId, "hero") : Promise.resolve(null),
  ]);

  if (!header) {
    console.warn(`sync-games: ${appId} sem header, pulando.`);
    continue;
  }

  const screenshots = [];
  if (appId === PREVIEW_APP_ID) {
    const sources = (game.screenshots ?? []).slice(0, 2);
    for (const [index, url] of sources.entries()) {
      const shot = await downloadScreenshot(appId, url, index + 1);
      if (shot) screenshots.push(shot);
    }
  }

  let description = "";
  if (appId === BANNER_APP_ID) {
    try {
      const details = await fetch(`${DETAILS_API}/games/${appId}/details`).then((r) =>
        r.ok ? r.json() : null,
      );
      description = decodeEntities(details?.shortDescription).slice(0, 220);
    } catch {
      description = "";
    }
  }

  games.push({
    appId,
    title: game.title,
    developer: developerOf(game),
    genres: (game.genres ?? []).slice(0, 2),
    tags: (game.tags ?? []).slice(0, 3),
    release: game.release ?? "",
    rating: ratingOf(game),
    header,
    portrait: portrait ?? header,
    ...(hero ? { hero } : {}),
    ...(description ? { description } : {}),
    ...(screenshots.length ? { screenshots } : {}),
  });
  console.log(`sync-games: ${game.title}`);
}

const file = `// GERADO por GhostBoxSite/scripts/sync-games.mjs — não editar à mão.
// Fonte: ${API}/home (catálogo real do GhostBox).
// Gerado em ${new Date().toISOString().slice(0, 10)}.

export interface SiteGame {
  appId: string;
  title: string;
  developer: string;
  genres: string[];
  tags: string[];
  release: string;
  /** Nota de 0 a 5 derivada da proporção de reviews positivas na Steam. */
  rating: string;
  /** Capa 460x215 (header.jpg da Steam), já convertida para webp. */
  header: string;
  /** Capa retrato 600x900 usada na Biblioteca. */
  portrait: string;
  /** library_hero.jpg — só o jogo do banner tem. */
  hero?: string;
  /** Descrição curta da Steam — só o jogo do banner tem. */
  description?: string;
  /** Capturas 16:9 — só o jogo da coluna de prévia tem. */
  screenshots?: string[];
}

export const games: SiteGame[] = ${serialize(games)};

export const bannerGame: SiteGame =
  games.find((game) => game.hero) ?? games[0];

export const previewGame: SiteGame =
  games.find((game) => game.screenshots?.length) ?? games[0];
`;

await writeFile(OUTPUT, file);
console.log(`sync-games: ${games.length} jogos gravados em ${OUTPUT}`);
