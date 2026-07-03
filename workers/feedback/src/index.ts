type Env = {
  DISCORD_WEBHOOK_URL: string;
  ALLOWED_ORIGIN?: string;
  LATEST_VERSION?: string;
  INSTALLER_URL?: string;
  RELEASE_NOTES_URL?: string;
};

type FeedbackPayload = {
  message?: unknown;
  language?: unknown;
  steamId?: unknown;
  userName?: unknown;
  appVersion?: unknown;
  source?: unknown;
};

const maxMessageLength = 1800;

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit = {},
  env?: Env
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", env?.ALLOWED_ORIGIN || "*");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");

  return new Response(JSON.stringify(body), { ...init, headers });
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function corsHeaders(env: Env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

async function handleFeedback(request: Request, env: Env) {
  if (!env.DISCORD_WEBHOOK_URL) {
    return jsonResponse({ success: false, error: "Webhook is not configured." }, { status: 500 }, env);
  }

  let payload: FeedbackPayload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON payload." }, { status: 400 }, env);
  }

  const message = normalizeString(payload.message);
  const language = normalizeString(payload.language) || "unknown";
  const steamId = normalizeString(payload.steamId) || "not provided";
  const userName = normalizeString(payload.userName) || "not provided";
  const appVersion = normalizeString(payload.appVersion) || "unknown";
  const source = normalizeString(payload.source) || "unknown";

  if (!message) {
    return jsonResponse({ success: false, error: "Feedback message is required." }, { status: 400 }, env);
  }

  if (message.length > maxMessageLength) {
    return jsonResponse({ success: false, error: "Feedback message is too long." }, { status: 413 }, env);
  }

  const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "GhostBox Feedback",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Novo feedback",
          description: truncate(message, 4096),
          color: 5793266,
          fields: [
            { name: "Usuario", value: truncate(userName, 256), inline: true },
            { name: "SteamID", value: truncate(steamId, 64), inline: true },
            { name: "Idioma", value: truncate(language, 64), inline: true },
            { name: "Versao", value: truncate(appVersion, 64), inline: true },
            { name: "Origem", value: truncate(source, 64), inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  if (!discordResponse.ok) {
    return jsonResponse({ success: false, error: "Discord rejected the feedback." }, { status: 502 }, env);
  }

  return jsonResponse({ success: true }, { status: 200 }, env);
}

function handleLatestUpdate(env: Env) {
  return jsonResponse(
    {
      latestVersion: normalizeString(env.LATEST_VERSION) || "0.1.0",
      installerUrl: normalizeString(env.INSTALLER_URL),
      releaseNotesUrl: normalizeString(env.RELEASE_NOTES_URL),
    },
    { status: 200 },
    env
  );
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/feedback") {
      return handleFeedback(request, env);
    }

    if (request.method === "GET" && url.pathname === "/updates/latest") {
      return handleLatestUpdate(env);
    }

    return jsonResponse({ success: false, error: "Not found." }, { status: 404 }, env);
  },
};
