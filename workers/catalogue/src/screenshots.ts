const STEAM_SCREENSHOT_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/";

type CompactScreenshots = { v: 1; files: string[]; timestamp?: string };

/** Preserve every screenshot URL while storing the common host, app ID and timestamp once. */
export function packScreenshots(appId: string, screenshots: string[]): string {
  const prefix = `${STEAM_SCREENSHOT_BASE}${appId}/`;
  if (!screenshots.length || screenshots.some((url) => !url.startsWith(prefix))) return JSON.stringify(screenshots);
  const paths = screenshots.map((url) => url.slice(prefix.length));
  if (paths.some((path) => path.includes("/") || path.includes(".."))) return JSON.stringify(screenshots);
  const timestamps = paths.map((path) => path.match(/\?t=(\d+)$/)?.[1]);
  const timestamp = timestamps[0];
  const value: CompactScreenshots = timestamp && timestamps.every((item) => item === timestamp)
    ? { v: 1, files: paths.map((path) => path.slice(0, -timestamp.length - 3)), timestamp }
    : { v: 1, files: paths };
  const packed = JSON.stringify(value);
  const original = JSON.stringify(screenshots);
  return packed.length < original.length ? packed : original;
}

export function unpackScreenshots(appId: string, raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    if (!parsed || typeof parsed !== "object") return [];
    const value = parsed as Partial<CompactScreenshots>;
    if (value.v !== 1 || !Array.isArray(value.files) || !value.files.every((file) => typeof file === "string" && !file.includes("/") && !file.includes(".."))) return [];
    if (value.timestamp !== undefined && !/^\d+$/.test(value.timestamp)) return [];
    return value.files.map((file) => `${STEAM_SCREENSHOT_BASE}${appId}/${file}${value.timestamp ? `?t=${value.timestamp}` : ""}`);
  } catch {
    return [];
  }
}
