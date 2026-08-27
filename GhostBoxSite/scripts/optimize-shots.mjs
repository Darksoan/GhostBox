#!/usr/bin/env node
// Converte capturas de tela reais do launcher em assets do site.
//
//   1. salve os PNGs em GhostBoxSite/screenshots/ com um destes nomes:
//      home.png, library.png, catalogue.png, achievements.png
//   2. rode: npm run site:shots
//
// Cada captura vira duas larguras em webp (1440 e 720) em public/shots/ e entra
// em src/content/shots.generated.ts. Quem não tiver captura continua sendo
// desenhado pelo mockup em DOM — ver src/components/AppShot.tsx.
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const SITE = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIR = `${SITE}screenshots`;
const OUTPUT_DIR = `${SITE}public/shots`;
const MANIFEST = `${SITE}src/content/shots.generated.ts`;

/** Variantes que a página sabe exibir. O nome do arquivo é a chave. */
const VARIANTS = ["home", "library", "catalogue", "achievements"];

const WIDTHS = [
  { suffix: "", width: 1440, quality: 82 },
  { suffix: "@sm", width: 720, quality: 78 },
];

async function dimensions(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    file,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

async function convert(file, variant) {
  for (const { suffix, width, quality } of WIDTHS) {
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-i", file,
      "-vf", `scale=${width}:-2`,
      "-c:v", "libwebp",
      "-quality", String(quality),
      `${OUTPUT_DIR}/${variant}${suffix}.webp`,
    ]);
  }
}

await mkdir(SOURCE_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });

const files = await readdir(SOURCE_DIR).catch(() => []);
const shots = {};

for (const variant of VARIANTS) {
  const match = files.find((file) => file.replace(/\.[^.]+$/, "").toLowerCase() === variant);
  if (!match) {
    console.warn(`optimize-shots: sem captura para "${variant}" — segue com o mockup em DOM.`);
    continue;
  }

  const file = `${SOURCE_DIR}/${match}`;
  const { width, height } = await dimensions(file);
  await convert(file, variant);

  shots[variant] = {
    src: `/shots/${variant}.webp`,
    small: `/shots/${variant}@sm.webp`,
    width,
    height,
  };
  console.log(`optimize-shots: ${variant} (${width}×${height})`);
}

const file = `// GERADO por GhostBoxSite/scripts/optimize-shots.mjs — não editar à mão.
// Fonte: capturas reais do launcher em GhostBoxSite/screenshots/.

export interface AppShotAsset {
  src: string;
  small: string;
  /** Dimensões do PNG original — a página reserva a caixa antes de carregar. */
  width: number;
  height: number;
}

export type ShotVariant = ${VARIANTS.map((variant) => `"${variant}"`).join(" | ")};

export const shots: Partial<Record<ShotVariant, AppShotAsset>> = ${JSON.stringify(shots, null, 2)};
`;

await writeFile(MANIFEST, file);
console.log(`optimize-shots: ${Object.keys(shots).length} captura(s) em ${MANIFEST}`);
