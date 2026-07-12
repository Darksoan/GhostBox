type Env = {
  DISCORD_WEBHOOK_URL: string;
  ALLOWED_ORIGIN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  RELEASE_ASSET_NAME?: string;
  LATEST_VERSION?: string;
  INSTALLER_URL?: string;
  RELEASE_NOTES_URL?: string;
  UPDATE_SIGNATURE?: string;
};

type GitHubReleaseAsset = {
  id: number;
  name: string;
  size?: number;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
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
const envLatestVersionFallback = "0.1.3";

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit = {},
  env?: Env
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", env?.ALLOWED_ORIGIN || "*");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function getGitHubConfig(env: Env) {
  const owner = normalizeString(env.GITHUB_OWNER);
  const repo = normalizeString(env.GITHUB_REPO);
  const token = normalizeString(env.GITHUB_TOKEN);

  if (!owner || !repo || !token) return null;

  return { owner, repo, token };
}

function githubHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    accept,
    authorization: `Bearer ${token}`,
    "user-agent": "ghostbox-update-worker",
    "x-github-api-version": "2022-11-28",
  };
}

function normalizeReleaseVersion(release: GitHubRelease) {
  const tagName = normalizeString(release.tag_name);
  return tagName.replace(/^v/i, "") || envLatestVersionFallback;
}

async function fetchLatestRelease(env: Env) {
  const config = getGitHubConfig(env);
  if (!config) return null;

  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`, {
    headers: githubHeaders(config.token),
  });

  if (!response.ok) return null;

  return response.json() as Promise<GitHubRelease>;
}

function findInstallerAsset(release: GitHubRelease, env: Env) {
  const configuredName = normalizeString(env.RELEASE_ASSET_NAME);
  const assets = release.assets || [];

  if (configuredName) {
    const configuredAsset = assets.find((asset) => asset.name === configuredName);
    if (configuredAsset) return configuredAsset;
  }

  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".exe") && !name.endsWith(".sig");
  });
}

function findSignatureAsset(release: GitHubRelease, installerName: string) {
  const assets = release.assets || [];
  const exact = assets.find((asset) => asset.name === `${installerName}.sig`);
  if (exact) return exact;
  return assets.find((asset) => asset.name.toLowerCase().endsWith(".sig"));
}

async function fetchAssetText(assetId: number, env: Env) {
  const config = getGitHubConfig(env);
  if (!config) return "";

  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/releases/assets/${assetId}`,
    {
      headers: githubHeaders(config.token, "application/octet-stream"),
      redirect: "follow",
    }
  );

  if (!response.ok) return "";
  return (await response.text()).trim();
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

async function handleLatestUpdate(request: Request, env: Env) {
  const release = await fetchLatestRelease(env);
  const origin = new URL(request.url).origin;

  if (release) {
    const asset = findInstallerAsset(release, env);
    const version = normalizeReleaseVersion(release);
    const installerUrl = asset ? `${origin}/updates/download/${asset.id}` : "";
    let signature = normalizeString(env.UPDATE_SIGNATURE);

    if (!signature && asset) {
      const sigAsset = findSignatureAsset(release, asset.name);
      if (sigAsset) {
        signature = await fetchAssetText(sigAsset.id, env);
      }
    }

    // Tauri updater format (+ legacy fields for older clients)
    return jsonResponse(
      {
        version,
        notes: normalizeString(release.body) || normalizeString(release.name) || `GhostBox ${version}`,
        pub_date: normalizeString(release.published_at) || new Date().toISOString(),
        platforms: {
          "windows-x86_64": {
            signature,
            url: installerUrl,
          },
        },
        latestVersion: version,
        installerUrl,
        releaseNotesUrl: normalizeString(release.html_url),
      },
      { status: 200 },
      env
    );
  }

  const version = normalizeString(env.LATEST_VERSION) || envLatestVersionFallback;
  const installerUrl = normalizeString(env.INSTALLER_URL);
  const signature = normalizeString(env.UPDATE_SIGNATURE);

  return jsonResponse(
    {
      version,
      notes: `GhostBox ${version}`,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: installerUrl,
        },
      },
      latestVersion: version,
      installerUrl,
      releaseNotesUrl: normalizeString(env.RELEASE_NOTES_URL),
    },
    { status: 200 },
    env
  );
}

async function handleUpdateDownload(assetId: string, env: Env) {
  const config = getGitHubConfig(env);
  if (!config || !assetId.match(/^\d+$/)) {
    return jsonResponse({ success: false, error: "Update asset is not configured." }, { status: 404 }, env);
  }

  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/releases/assets/${assetId}`, {
    headers: githubHeaders(config.token, "application/octet-stream"),
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    return Response.redirect(location, 302);
  }

  if (!response.ok || !response.body) {
    return jsonResponse({ success: false, error: "Update asset download failed." }, { status: 502 }, env);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") || "application/octet-stream",
      "content-disposition": response.headers.get("content-disposition") || "attachment",
      "cache-control": "private, max-age=60",
    },
  });
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
      return handleLatestUpdate(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/updates/download/")) {
      return handleUpdateDownload(url.pathname.slice("/updates/download/".length), env);
    }

    return jsonResponse({ success: false, error: "Not found." }, { status: 404 }, env);
  },
};
