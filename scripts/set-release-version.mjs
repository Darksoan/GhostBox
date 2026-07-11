import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-release-version.mjs <semver>");
  process.exit(1);
}

function updateJson(path, updater) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  updater(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceVersion(path) {
  const content = readFileSync(path, "utf8");
  const match = content.match(/^(version\s*=\s*")([^"]+)(")/m);
  if (!match) {
    throw new Error(`Could not find version field in ${path}`);
  }

  if (match[2] === version) {
    return;
  }

  const next = content.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
  writeFileSync(path, next);
}

updateJson("package.json", (value) => {
  value.version = version;
});

updateJson("package-lock.json", (value) => {
  value.version = version;
  if (value.packages?.[""]) {
    value.packages[""].version = version;
  }
});

updateJson("src-tauri/tauri.conf.json", (value) => {
  value.version = version;
});

replaceVersion("src-tauri/Cargo.toml");
