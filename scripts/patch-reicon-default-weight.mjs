import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const createIconPath = join(root, "node_modules", "reicon-react", "createIcon.js");
const source = readFileSync(createIconPath, "utf8");
const patched = source.replace("weight = 'Outline'", "weight = 'Filled'");

if (patched !== source) {
  writeFileSync(createIconPath, patched);
}
