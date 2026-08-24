const STEAMSPY_ALL_URL = "https://steamspy.com/api.php?request=all";
const STEAM_PLAYER_COUNT_URL =
  "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/";

/**
 * Páginas de 1000 jogos ordenadas por owners. O ciclo para bem antes do fim da
 * lista da SteamSpy: da página 20 em diante são títulos com owners na casa dos
 * milhares, cujo CCU é 0 na amostra — puxá-los só gastaria requisição.
 */
export const STEAMSPY_MAX_PAGES = 20;

/** Statements por `batch`: 1000 UPDATEs de uma vez estouram o limite do D1. */
const UPDATE_CHUNK = 100;

export const STEAMSPY_PAGE_KEY = "steamspyPage";
export const STEAMSPY_SAMPLED_AT_KEY = "steamspySampledAt";

interface SteamSpyEntry {
  appid?: number;
  ccu?: number;
  owners?: string;
}

export interface SteamSpySample {
  appId: string;
  ccu: number;
  ownersMax: number;
}

/**
 * "10,000,000 .. 20,000,000" -> 20000000. A SteamSpy só publica a faixa; o
 * limite superior é o que as outras superfícies já chamam de `ownersEstimate`.
 */
export function parseOwnersMax(owners: string | undefined): number {
  if (!owners) return 0;
  const bounds = owners.split("..").map((part) => Number.parseInt(part.replace(/[^\d]/g, ""), 10));
  const max = bounds.filter((value) => Number.isFinite(value)).pop();
  return max && max > 0 ? max : 0;
}

/** Descarta entradas sem appid utilizável e sem nenhuma das duas amostras. */
export function toSteamSpySamples(payload: unknown): SteamSpySample[] {
  if (!payload || typeof payload !== "object") return [];
  const samples: SteamSpySample[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, SteamSpyEntry>)) {
    const appId = String(value?.appid ?? key).trim();
    if (!/^\d+$/.test(appId)) continue;
    const ccu = Number.isFinite(value?.ccu) ? Math.max(0, Math.trunc(value?.ccu ?? 0)) : 0;
    const ownersMax = parseOwnersMax(value?.owners);
    if (ccu === 0 && ownersMax === 0) continue;
    samples.push({ appId, ccu, ownersMax });
  }
  return samples;
}

async function fetchSteamSpyPage(page: number): Promise<SteamSpySample[]> {
  const response = await fetch(`${STEAMSPY_ALL_URL}&page=${page}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`steamspy page ${page} failed: ${response.status}`);
  return toSteamSpySamples(await response.json());
}

/**
 * Contagem de jogadores ao vivo da própria Steam, endpoint público e sem chave.
 *
 * Existe junto com a amostra da SteamSpy porque as duas medem coisas
 * diferentes: a SteamSpy publica uma amostra diária (Resident Evil 4 apareceu
 * com 3.748 quando a Steam reportava 12.039 no mesmo instante), boa para
 * ordenar o catálogo, ruim para mostrar num card como "jogando agora".
 *
 * Devolve `null` em qualquer falha — quem chama cai na coluna do D1 em vez de
 * derrubar a resposta inteira por causa de um número.
 */
export async function fetchLivePlayerCount(appId: string): Promise<number | null> {
  if (!/^\d+$/.test(appId)) return null;
  try {
    const response = await fetch(`${STEAM_PLAYER_COUNT_URL}?appid=${appId}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      response?: { player_count?: number; result?: number };
    };
    // `result` 1 é o único sucesso; app inexistente responde 200 com result 42.
    if (payload.response?.result !== 1) return null;
    const count = payload.response?.player_count;
    return typeof count === "number" && Number.isFinite(count) && count >= 0
      ? Math.trunc(count)
      : null;
  } catch {
    return null;
  }
}

async function readPageCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM catalogue_meta WHERE key = ?")
    .bind(STEAMSPY_PAGE_KEY)
    .first<{ value: string }>();
  const parsed = Number.parseInt(row?.value ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed % STEAMSPY_MAX_PAGES : 0;
}

function writeMeta(db: D1Database, key: string, value: string) {
  return db
    .prepare(
      "INSERT INTO catalogue_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value);
}

/**
 * Grava uma página de amostras da SteamSpy nas colunas `steamspy_*`.
 *
 * `UPDATE`, nunca `INSERT`: a SteamSpy lista o catálogo inteiro da Steam e o
 * ingest é quem decide o que entra na tabela — uma amostra não deve criar
 * jogo. Linhas que não existem simplesmente não casam no `WHERE`.
 */
export async function applySteamSpySamples(
  db: D1Database,
  samples: SteamSpySample[],
  sampledAt: number,
): Promise<number> {
  if (samples.length === 0) return 0;

  let updated = 0;
  for (let index = 0; index < samples.length; index += UPDATE_CHUNK) {
    const chunk = samples.slice(index, index + UPDATE_CHUNK);
    const results = await db.batch(
      chunk.map((sample) =>
        db
          .prepare("UPDATE games SET steamspy_ccu = ?, steamspy_owners_max = ? WHERE app_id = ?")
          .bind(sample.ccu, sample.ownersMax, sample.appId),
      ),
    );
    for (const result of results) updated += result.meta?.changes ?? 0;
  }

  await writeMeta(db, STEAMSPY_SAMPLED_AT_KEY, new Date(sampledAt).toISOString()).run();
  return updated;
}

/**
 * Uma página por execução do cron, com o cursor persistido no `catalogue_meta`:
 * a SteamSpy limita `request=all` a uma chamada por minuto, então varrer as 20
 * páginas de uma vez seria rejeitado. O ciclo inteiro fecha em algumas horas e
 * recomeça do topo, que é onde o CCU muda de verdade.
 */
export async function refreshSteamSpySamples(
  db: D1Database,
  now = Date.now(),
): Promise<{ page: number; samples: number; updated: number }> {
  const page = await readPageCursor(db);
  const samples = await fetchSteamSpyPage(page);
  const updated = await applySteamSpySamples(db, samples, now);
  await writeMeta(db, STEAMSPY_PAGE_KEY, String((page + 1) % STEAMSPY_MAX_PAGES)).run();
  return { page, samples: samples.length, updated };
}
