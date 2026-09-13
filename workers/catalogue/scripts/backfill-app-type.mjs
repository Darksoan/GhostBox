import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BATCH_SIZE = 50;
const STATE_KEY = "appTypeBackfillCursor";
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function execute(sql) {
  const output = execFileSync(process.execPath, [
    wrangler, "d1", "execute", "DB", "--remote", "--json", "--command", sql,
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const start = output.indexOf("[");
  if (start < 0) throw new Error(`Wrangler did not return JSON: ${output}`);
  const result = JSON.parse(output.slice(start));
  if (!result.length || result.some((entry) => entry.success !== true)) {
    throw new Error("D1 command failed");
  }
  return result[0]?.results ?? [];
}

function normalizeType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : "";
}

async function steamType(appId) {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`, {
      headers: { accept: "application/json", "user-agent": "GhostBox AppType Backfill/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "";
    const payload = await response.json();
    return payload?.[appId]?.success ? normalizeType(payload[appId].data?.type) : "";
  } catch {
    return "";
  }
}

async function main() {
  const columns = execute("SELECT name FROM pragma_table_info('games') WHERE name='app_type'");
  if (!columns.length) {
    throw new Error("Migration 0005_app_type.sql is not applied. Validate production schema before applying it.");
  }
  execute(`INSERT INTO catalogue_meta(key,value) VALUES(${quote(STATE_KEY)},'') ON CONFLICT DO NOTHING`);
  const cursor = execute(`SELECT value FROM catalogue_meta WHERE key=${quote(STATE_KEY)}`)[0]?.value ?? "";
  const rows = execute(`SELECT app_id FROM games WHERE app_type IS NULL AND app_id > ${quote(cursor)} ORDER BY app_id LIMIT ${BATCH_SIZE}`);
  if (!rows.length) {
    console.log(JSON.stringify({ complete: true, cursor }));
    return;
  }
  let last = cursor;
  let classified = 0;
  let demos = 0;
  let unresolved = 0;
  for (const row of rows) {
    const appId = String(row.app_id ?? "");
    if (!/^\d{1,10}$/.test(appId)) continue;
    const appType = await steamType(appId);
    if (!appType) {
      // Não avança além de uma falha: a próxima execução tenta este ID outra
      // vez, em vez de abandonar para sempre uma linha ainda não classificada.
      unresolved += 1;
      break;
    }
    execute(`UPDATE games SET app_type=${quote(appType)} WHERE app_id=${quote(appId)} AND app_type IS NULL`);
    classified += 1;
    if (appType === "demo") demos += 1;
    last = appId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  execute(`UPDATE catalogue_meta SET value=${quote(last)} WHERE key=${quote(STATE_KEY)}`);
  console.log(JSON.stringify({ complete: rows.length < BATCH_SIZE && unresolved === 0, cursor: last, classified, demos, unresolved }));
}

await main();