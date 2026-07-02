type Env = {
  SUBSCRIPTION_DB: D1Database;
  SUMUP_API_KEY: string;
  SUMUP_MERCHANT_CODE: string;
  SUMUP_BASE_URL?: string;
  CHECKOUT_RETURN_URL?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  DISCORD_OAUTH_STATE_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_PREMIUM_ROLE_ID?: string;
  DISCORD_SYNC_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  CLOUD_SESSION_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLOUD_SAVE_BUCKET?: string;
};

type PlanId = "monthly" | "quarterly";
type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";
type SubscriptionStatus = "free" | "active" | "expired";

type Plan = {
  id: PlanId;
  amountCents: number;
  months: number;
  description: string;
};

type PaymentRow = {
  id: string;
  checkout_reference: string;
  checkout_id: string | null;
  steam_id: string;
  plan_id: PlanId;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  hosted_checkout_url: string | null;
  sumup_payload: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

type PixArtefact = {
  name?: string;
  content_type?: string;
  location?: string;
  content?: string;
  created_at?: string;
};

type SumUpProcessResponse = Record<string, unknown> & {
  CheckoutSuccess?: Record<string, unknown> | null;
  CheckoutAccepted?: Record<string, unknown> | null;
};

type SubscriptionRow = {
  steam_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  last_payment_id: string | null;
  created_at: string;
  updated_at: string;
};

type DiscordLinkRow = {
  steam_id: string;
  discord_user_id: string;
  discord_username: string | null;
  discord_global_name: string | null;
  linked_at: string;
  updated_at: string;
};

type DiscordTokenResponse = {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type CloudSession = {
  steamId: string;
  exp: number;
};

type CloudSaveRow = {
  id: string;
  steam_id: string;
  app_id: string;
  game_title: string;
  storage_path: string;
  size_bytes: number;
  sha256: string;
  manifest_json: string | null;
  device_name: string | null;
  created_at: string;
  updated_at: string;
};

type DiscordUserResponse = {
  id?: string;
  username?: string;
  global_name?: string | null;
};

const plans: Record<PlanId, Plan> = {
  monthly: {
    id: "monthly",
    amountCents: 699,
    months: 1,
    description: "GhostBox Premium Mensal",
  },
  quarterly: {
    id: "quarterly",
    amountCents: 1499,
    months: 3,
    description: "GhostBox Premium Trimestral",
  },
};

const paidStatuses = new Set(["PAID", "SUCCESSFUL", "PAID_OUT"]);
const failedStatuses = new Set(["FAILED", "CANCELLED", "CANCELED", "EXPIRED"]);

function nowIso() {
  return new Date().toISOString();
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months, 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function validSteamId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function getCloudSessionSecret(env: Env) {
  return env.CLOUD_SESSION_SECRET || env.DISCORD_OAUTH_STATE_SECRET || env.DISCORD_CLIENT_SECRET;
}

async function signCloudToken(env: Env, session: CloudSession) {
  const secret = getCloudSessionSecret(env);
  if (!secret) throw new Error("CLOUD_SESSION_SECRET is not configured");
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await hmacSha256(secret, payload);
  return `${payload}.${signature}`;
}

async function verifyCloudToken(env: Env, request: Request): Promise<CloudSession | null> {
  const secret = getCloudSessionSecret(env);
  if (!secret) return null;
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmacSha256(secret, payload);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as CloudSession;
    if (!validSteamId(decoded.steamId) || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function getDiscordRedirectUri(env: Env, request: Request) {
  return env.DISCORD_REDIRECT_URI || `${new URL(request.url).origin}/discord/callback`;
}

function getDiscordStateSecret(env: Env) {
  return env.DISCORD_OAUTH_STATE_SECRET || env.DISCORD_CLIENT_SECRET;
}

async function createDiscordState(env: Env, steamId: string) {
  const secret = getDiscordStateSecret(env);
  if (!secret) throw new Error("DISCORD_OAUTH_STATE_SECRET is not configured");

  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${steamId}.${expiresAt}.${nonce}`;
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

async function verifyDiscordState(env: Env, state: string | null) {
  const secret = getDiscordStateSecret(env);
  if (!secret || !state) return null;

  const parts = state.split(".");
  if (parts.length !== 4) return null;

  const [steamId, expiresAtValue, nonce, signature] = parts;
  if (!validSteamId(steamId) || !nonce) return null;

  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const payload = `${steamId}.${expiresAtValue}.${nonce}`;
  const expected = await hmacSha256(secret, payload);
  return timingSafeEqual(signature, expected) ? steamId : null;
}

function jsonResponse(value: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "cache-control": "no-store",
    },
  });
}

function cloudSaveBucket(env: Env) {
  return env.CLOUD_SAVE_BUCKET || "cloud-saves";
}

function requireSupabase(env: Env) {
  const url = env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase cloud save storage is not configured");
  return { url, key, bucket: cloudSaveBucket(env) };
}

function publicCloudSave(row: CloudSaveRow) {
  return {
    id: row.id,
    steamId: row.steam_id,
    appId: row.app_id,
    gameTitle: row.game_title,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    deviceName: row.device_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requirePremiumSession(request: Request, env: Env) {
  const session = await verifyCloudToken(env, request);
  if (!session) return { response: jsonResponse({ error: "unauthorized" }, env, 401) };
  const subscription = await getSubscription(env, session.steamId);
  if (!isActiveSubscription(subscription)) {
    return { response: jsonResponse({ error: "premium_required" }, env, 402) };
  }
  return { session };
}

function normalizeSumUpStatus(status: unknown): PaymentStatus {
  const normalized = String(status || "").trim().toUpperCase();
  if (paidStatuses.has(normalized)) return "paid";
  if (normalized === "EXPIRED") return "expired";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "cancelled";
  if (failedStatuses.has(normalized)) return "failed";
  return "pending";
}

function pixArtefacts(value: unknown): PixArtefact[] {
  if (!value || typeof value !== "object") return [];
  const checkout = value as Record<string, unknown>;
  const pix = checkout.pix && typeof checkout.pix === "object" ? checkout.pix as Record<string, unknown> : null;
  const qrCodePix = checkout.qr_code_pix && typeof checkout.qr_code_pix === "object" ? checkout.qr_code_pix as Record<string, unknown> : null;
  const artefacts = pix?.artefacts || qrCodePix?.artefacts;
  return Array.isArray(artefacts) ? artefacts as PixArtefact[] : [];
}

function pixDetails(row: PaymentRow, origin?: string) {
  const payload = row.sumup_payload ? JSON.parse(row.sumup_payload) : null;
  const artefacts = pixArtefacts(payload);
  const code = artefacts.find((artefact) => artefact.name === "code")?.content
    || artefacts.find((artefact) => artefact.content_type === "text/plain")?.content
    || null;
  const barcode = artefacts.find((artefact) => artefact.name === "barcode")
    || artefacts.find((artefact) => artefact.content_type?.startsWith("image/"));
  return {
    pixCode: code,
    pixQrCodeUrl: origin && barcode?.location && row.checkout_id
      ? `${origin}/subscription/pix-qr?checkoutId=${encodeURIComponent(row.checkout_id)}`
      : null,
  };
}

function publicPayment(row: PaymentRow, origin?: string) {
  const pix = pixDetails(row, origin);
  return {
    id: row.id,
    checkoutReference: row.checkout_reference,
    checkoutId: row.checkout_id,
    steamId: row.steam_id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    hostedCheckoutUrl: row.hosted_checkout_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    pixCode: pix.pixCode,
    pixQrCodeUrl: pix.pixQrCodeUrl,
  };
}

function publicSubscription(row: SubscriptionRow | null) {
  if (!row) {
    return {
      status: "free" as SubscriptionStatus,
      isPremium: false,
      planId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      lastPaymentId: null,
      updatedAt: null,
    };
  }

  const active = row.status === "active" && !!row.current_period_end && new Date(row.current_period_end).getTime() > Date.now();
  return {
    status: active ? "active" : "expired",
    isPremium: active,
    planId: row.plan_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    lastPaymentId: row.last_payment_id,
    updatedAt: row.updated_at,
  };
}

type DiscordRoleSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
};

function publicDiscordLink(steamId: string, row: DiscordLinkRow | null, roleSync?: DiscordRoleSyncResult | null) {
  return {
    steamId,
    linked: Boolean(row),
    discordUserId: row?.discord_user_id ?? null,
    discordUsername: row?.discord_username ?? null,
    discordGlobalName: row?.discord_global_name ?? null,
    linkedAt: row?.linked_at ?? null,
    premiumRole: roleSync
      ? {
          synced: roleSync.ok,
          skipped: roleSync.skipped,
          reason: roleSync.reason ?? null,
        }
      : null,
  };
}

function isActiveSubscription(row: SubscriptionRow | null) {
  return row?.status === "active" && !!row.current_period_end && new Date(row.current_period_end).getTime() > Date.now();
}

function discordRoleConfigured(env: Env) {
  return Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID && env.DISCORD_PREMIUM_ROLE_ID);
}

async function discordRoleRequest(env: Env, discordUserId: string, grant: boolean): Promise<DiscordRoleSyncResult> {
  if (!discordRoleConfigured(env)) return { ok: false, skipped: true, reason: "Discord role sync is not configured" };

  const endpoint = `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID!)}/members/${encodeURIComponent(discordUserId)}/roles/${encodeURIComponent(env.DISCORD_PREMIUM_ROLE_ID!)}`;
  const response = await fetch(endpoint, {
    method: grant ? "PUT" : "DELETE",
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "x-audit-log-reason": encodeURIComponent(grant ? "GhostBox Premium activated" : "GhostBox Premium expired"),
    },
  });

  if (response.ok || response.status === 204) return { ok: true, skipped: false };
  const message = await response.text().catch(() => "");
  return {
    ok: false,
    skipped: false,
    reason: message || `Discord HTTP ${response.status}`,
  };
}

async function syncPremiumRoleForSteam(env: Env, steamId: string, grant: boolean): Promise<DiscordRoleSyncResult> {
  const link = await getDiscordLink(env, steamId);
  if (!link) return { ok: false, skipped: true, reason: "Steam account has no Discord link" };

  const result = await discordRoleRequest(env, link.discord_user_id, grant);
  if (!result.ok && !result.skipped) {
    console.warn("Discord Premium role sync failed", { steamId, discordUserId: link.discord_user_id, grant, reason: result.reason });
  }
  return result;
}

function htmlResponse(title: string, message: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0b;color:#fff;font:16px system-ui,sans-serif}main{max-width:520px;padding:28px;text-align:center}p{color:#b9b9b9;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${message}</p><script>setTimeout(() => window.close(), 2400)</script></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

async function readJson(request: Request) {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
}

async function validateSteamOpenId(callbackUrl: string) {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }

  const params = Array.from(url.searchParams.entries()).filter(([key]) => key.startsWith("openid."));
  const mode = url.searchParams.get("openid.mode");
  if (mode !== "id_res") return null;
  const claimedId = url.searchParams.get("openid.claimed_id") || "";
  const steamId = claimedId.split("/openid/id/").pop() || "";
  if (!validSteamId(steamId)) return null;

  const body = new URLSearchParams();
  for (const [key, value] of params) {
    if (key !== "openid.mode") body.append(key, value);
  }
  body.append("openid.mode", "check_authentication");

  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;
  const text = await response.text();
  return text.includes("is_valid:true") ? steamId : null;
}

async function handleSteamAuth(request: Request, env: Env) {
  const body = await readJson(request);
  const callbackUrl = typeof body?.callbackUrl === "string" ? body.callbackUrl : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const avatarUrl = typeof body?.avatarUrl === "string" ? body.avatarUrl.trim() : "";
  const steamId = await validateSteamOpenId(callbackUrl);
  if (!steamId) return jsonResponse({ error: "invalid_steam_login" }, env, 401);

  await ensureUser(env, steamId);
  const subscription = await getSubscription(env, steamId);
  const token = await signCloudToken(env, {
    steamId,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  return jsonResponse({
    token,
    user: {
      steamId,
      displayName: displayName || null,
      avatarUrl: avatarUrl || null,
      isPremium: isActiveSubscription(subscription),
    },
    subscription: publicSubscription(subscription),
  }, env);
}

function getSumUpBaseUrl(env: Env) {
  return (env.SUMUP_BASE_URL || "https://api.sumup.com").replace(/\/+$/, "");
}

async function sumupRequest<T>(env: Env, path: string, init: RequestInit = {}) {
  if (!env.SUMUP_API_KEY) throw new Error("SUMUP_API_KEY is not configured");

  const response = await fetch(`${getSumUpBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.SUMUP_API_KEY}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : `SumUp HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function hostedCheckoutUrl(data: Record<string, unknown>) {
  const links = data.links;
  if (typeof data.hosted_checkout_url === "string") return data.hosted_checkout_url;
  if (typeof data.hosted_checkout_url === "object" && data.hosted_checkout_url) return String(data.hosted_checkout_url);
  if (Array.isArray(links)) {
    const hosted = links.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const rel = "rel" in entry ? String(entry.rel) : "";
      return rel === "hosted_checkout" || rel === "checkout";
    }) as { href?: unknown } | undefined;
    if (typeof hosted?.href === "string") return hosted.href;
  }
  if (typeof data.checkout_url === "string") return data.checkout_url;
  return null;
}

function unwrapSumUpCheckout(data: SumUpProcessResponse) {
  if (data.CheckoutSuccess && typeof data.CheckoutSuccess === "object") return data.CheckoutSuccess;
  if (data.CheckoutAccepted && typeof data.CheckoutAccepted === "object") return data.CheckoutAccepted;
  return data;
}

function hasPixTransaction(data: Record<string, unknown>) {
  const transactions = data.transactions;
  if (!Array.isArray(transactions)) return false;
  return transactions.some((transaction) => {
    if (!transaction || typeof transaction !== "object") return false;
    const entryMode = "entry_mode" in transaction ? String(transaction.entry_mode).toUpperCase() : "";
    return entryMode === "PIX" || entryMode === "QR_CODE_PIX";
  });
}

async function createSumUpCheckout(env: Env, reference: string, plan: Plan) {
  if (!env.SUMUP_MERCHANT_CODE) throw new Error("SUMUP_MERCHANT_CODE is not configured");
  const returnUrl = env.CHECKOUT_RETURN_URL || "https://ghostbox-subscriptions.hella.workers.dev/subscription/return";
  const payload = {
    checkout_reference: reference,
    amount: plan.amountCents / 100,
    currency: "BRL",
    merchant_code: env.SUMUP_MERCHANT_CODE,
    description: plan.description,
    return_url: returnUrl,
    redirect_url: returnUrl,
  };
  return sumupRequest<Record<string, unknown>>(env, "/v0.1/checkouts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function processSumUpPixCheckout(env: Env, checkoutId: string) {
  const processed = await sumupRequest<SumUpProcessResponse>(
    env,
    `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ payment_type: "pix" }),
    }
  );
  return unwrapSumUpCheckout(processed);
}

async function getSumUpCheckout(env: Env, checkoutId: string) {
  return sumupRequest<Record<string, unknown>>(env, `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`);
}

async function ensureUser(env: Env, steamId: string) {
  const now = nowIso();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO users (steam_id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET updated_at = excluded.updated_at`
  ).bind(steamId, now, now).run();
}

async function getPaymentByCheckout(env: Env, checkoutId: string) {
  return env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM payments WHERE checkout_id = ? OR checkout_reference = ? LIMIT 1`
  ).bind(checkoutId, checkoutId).first<PaymentRow>();
}

async function activateSubscription(env: Env, payment: PaymentRow) {
  const now = new Date();
  const existing = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions WHERE steam_id = ? LIMIT 1`
  ).bind(payment.steam_id).first<SubscriptionRow>();
  const base = existing?.status === "active" && existing.current_period_end && new Date(existing.current_period_end).getTime() > now.getTime()
    ? new Date(existing.current_period_end)
    : now;
  const plan = plans[payment.plan_id];
  const periodStart = now.toISOString();
  const periodEnd = addMonths(base, plan.months).toISOString();
  const updatedAt = now.toISOString();

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO subscriptions (
       steam_id, plan_id, status, current_period_start, current_period_end, last_payment_id, created_at, updated_at
     ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = 'active',
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       last_payment_id = excluded.last_payment_id,
        updated_at = excluded.updated_at`
  ).bind(payment.steam_id, payment.plan_id, periodStart, periodEnd, payment.id, updatedAt, updatedAt).run();

  await syncPremiumRoleForSteam(env, payment.steam_id, true).catch((error) => {
    console.warn("Discord Premium role grant failed", { steamId: payment.steam_id, error: error instanceof Error ? error.message : String(error) });
  });
}

async function updatePaymentFromSumUp(env: Env, payment: PaymentRow, checkout: Record<string, unknown>) {
  const status = normalizeSumUpStatus(checkout.status);
  const checkoutId = typeof checkout.id === "string" ? checkout.id : payment.checkout_id;
  const updatedAt = nowIso();
  const confirmedAt = status === "paid" ? payment.confirmed_at || updatedAt : payment.confirmed_at;
  const previousPayload = payment.sumup_payload ? JSON.parse(payment.sumup_payload) : null;
  const nextCheckout = previousPayload && pixArtefacts(checkout).length === 0 && pixArtefacts(previousPayload).length > 0
    ? { ...previousPayload, ...checkout, pix: previousPayload.pix, qr_code_pix: previousPayload.qr_code_pix }
    : checkout;

  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE payments SET
       checkout_id = COALESCE(?, checkout_id),
       status = ?,
       sumup_payload = ?,
       updated_at = ?,
       confirmed_at = ?
     WHERE id = ?`
  ).bind(checkoutId, status, JSON.stringify(nextCheckout), updatedAt, confirmedAt, payment.id).run();

  const nextPayment = { ...payment, checkout_id: checkoutId, status, sumup_payload: JSON.stringify(nextCheckout), updated_at: updatedAt, confirmed_at: confirmedAt };
  if (status === "paid" && payment.status !== "paid") {
    await activateSubscription(env, nextPayment);
  }
  return nextPayment;
}

async function getSubscription(env: Env, steamId: string) {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions WHERE steam_id = ? LIMIT 1`
  ).bind(steamId).first<SubscriptionRow>();

  if (row?.status === "active" && row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) {
    const updatedAt = nowIso();
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE steam_id = ?`
    ).bind(updatedAt, steamId).run();
    await syncPremiumRoleForSteam(env, steamId, false).catch((error) => {
      console.warn("Discord Premium role revoke failed", { steamId, error: error instanceof Error ? error.message : String(error) });
    });
    return { ...row, status: "expired" as SubscriptionStatus, updated_at: updatedAt };
  }

  return row;
}

async function getDiscordLink(env: Env, steamId: string) {
  return env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM discord_links WHERE steam_id = ? LIMIT 1`
  ).bind(steamId).first<DiscordLinkRow>();
}

async function syncDiscordPremiumRoles(env: Env) {
  const now = nowIso();
  const expired = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end <= ?
     LIMIT 100`
  ).bind(now).all<SubscriptionRow>();

  let granted = 0;
  let revoked = 0;
  let skipped = 0;
  const failures: Array<{ steamId: string; action: "grant" | "revoke"; reason: string }> = [];

  for (const subscription of expired.results || []) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE steam_id = ?`
    ).bind(now, subscription.steam_id).run();

    const result = await syncPremiumRoleForSteam(env, subscription.steam_id, false);
    if (result.ok) revoked += 1;
    else if (result.skipped) skipped += 1;
    else failures.push({ steamId: subscription.steam_id, action: "revoke", reason: result.reason || "Unknown Discord error" });
  }

  const active = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND current_period_end IS NOT NULL AND current_period_end > ?
     LIMIT 100`
  ).bind(now).all<SubscriptionRow>();

  for (const subscription of active.results || []) {
    const result = await syncPremiumRoleForSteam(env, subscription.steam_id, true);
    if (result.ok) granted += 1;
    else if (result.skipped) skipped += 1;
    else failures.push({ steamId: subscription.steam_id, action: "grant", reason: result.reason || "Unknown Discord error" });
  }

  return {
    granted,
    revoked,
    skipped,
    failures,
  };
}

async function handleDiscordSync(request: Request, env: Env) {
  if (!env.DISCORD_SYNC_TOKEN) return jsonResponse({ error: "Discord sync token is not configured" }, env, 404);
  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${env.DISCORD_SYNC_TOKEN}`) return jsonResponse({ error: "Unauthorized" }, env, 401);

  return jsonResponse(await syncDiscordPremiumRoles(env), env);
}

async function handleDiscordLinkStatus(request: Request, env: Env) {
  const steamId = new URL(request.url).searchParams.get("steamId");
  if (!validSteamId(steamId)) return jsonResponse({ error: "Invalid Steam ID" }, env, 400);

  const [subscription, link] = await Promise.all([
    getSubscription(env, steamId),
    getDiscordLink(env, steamId),
  ]);
  const roleSync = link
    ? await syncPremiumRoleForSteam(env, steamId, isActiveSubscription(subscription))
    : null;

  return jsonResponse(publicDiscordLink(steamId, link, roleSync), env);
}

async function handleDiscordLinkStart(request: Request, env: Env) {
  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return jsonResponse({ error: "Discord OAuth is not configured" }, env, 500);
  }

  await ensureUser(env, steamId);

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", getDiscordRedirectUri(env, request));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", await createDiscordState(env, steamId));

  return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleDiscordCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const steamId = await verifyDiscordState(env, url.searchParams.get("state"));
  const code = url.searchParams.get("code");

  if (!steamId || !code) {
    return htmlResponse("Vínculo não concluído", "A autorização do Discord expirou ou foi recusada. Volte ao GhostBox e tente novamente.", 400);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return htmlResponse("Discord não configurado", "O OAuth do Discord ainda não foi configurado no servidor.", 500);
  }

  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(env, request),
    }),
  });
  const token = await tokenResponse.json<DiscordTokenResponse>();
  if (!tokenResponse.ok || !token.access_token) {
    return htmlResponse("Falha no Discord", token.error_description || token.error || "Não foi possível validar a autorização do Discord.", 502);
  }

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const user = await userResponse.json<DiscordUserResponse>();
  if (!userResponse.ok || !user.id) {
    return htmlResponse("Falha no Discord", "Não foi possível ler o usuário autorizado no Discord.", 502);
  }

  const now = nowIso();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO discord_links (
       steam_id, discord_user_id, discord_username, discord_global_name, linked_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET
       discord_user_id = excluded.discord_user_id,
       discord_username = excluded.discord_username,
       discord_global_name = excluded.discord_global_name,
       linked_at = excluded.linked_at,
       updated_at = excluded.updated_at`
  ).bind(steamId, user.id, user.username ?? null, user.global_name ?? null, now, now).run();

  const subscription = await getSubscription(env, steamId);
  let roleSynced = false;
  if (isActiveSubscription(subscription)) {
    const result = await syncPremiumRoleForSteam(env, steamId, true).catch((error) => {
      console.warn("Discord Premium role grant after link failed", { steamId, discordUserId: user.id, error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    roleSynced = result?.ok === true;
  }

  return htmlResponse(
    "Discord vinculado",
    roleSynced
      ? "Sua conta Discord foi vinculada à Steam usada no GhostBox e o cargo Premium foi sincronizado. Você já pode voltar ao app."
      : "Sua conta Discord foi vinculada à Steam usada no GhostBox. Entre no servidor pelo convite e volte ao app para sincronizar o cargo Premium."
  );
}

async function handleCreateCheckout(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const body = await readJson(request);
  const steamId = body?.steamId;
  const planId = body?.planId;

  if (!validSteamId(steamId)) return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  if (planId !== "monthly" && planId !== "quarterly") return jsonResponse({ error: "Invalid plan" }, env, 400);

  const plan = plans[planId];
  await ensureUser(env, steamId);

  const paymentId = crypto.randomUUID();
  const reference = `ghostbox-${steamId}-${planId}-${paymentId}`;
  const createdCheckout = await createSumUpCheckout(env, reference, plan);
  const createdCheckoutId = typeof createdCheckout.id === "string" ? createdCheckout.id : null;
  if (!createdCheckoutId) {
    throw new Error("SumUp did not return a checkout ID");
  }
  const checkout = await processSumUpPixCheckout(env, createdCheckoutId);
  const checkoutId = typeof checkout.id === "string" ? checkout.id : null;
  const checkoutUrl = hostedCheckoutUrl(checkout);
  const status = normalizeSumUpStatus(checkout.status);
  const createdAt = nowIso();

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO payments (
       id, checkout_reference, checkout_id, steam_id, plan_id, amount_cents, currency,
       status, hosted_checkout_url, sumup_payload, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'BRL', ?, ?, ?, ?, ?)`
  ).bind(
    paymentId,
    reference,
    checkoutId,
    steamId,
    planId,
    plan.amountCents,
    status,
    checkoutUrl,
    JSON.stringify(checkout),
    createdAt,
    createdAt
  ).run();

  const payment = await env.SUBSCRIPTION_DB.prepare(`SELECT * FROM payments WHERE id = ?`).bind(paymentId).first<PaymentRow>();
  return jsonResponse({ payment: payment ? publicPayment(payment, origin) : null }, env, 201);
}

async function handleStatus(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) return jsonResponse({ error: "Invalid Steam ID" }, env, 400);

  const [subscription, latestPayment] = await Promise.all([
    getSubscription(env, steamId),
    env.SUBSCRIPTION_DB.prepare(
      `SELECT * FROM payments WHERE steam_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(steamId).first<PaymentRow>(),
  ]);
  const discordLink = await getDiscordLink(env, steamId);
  const premiumRole = discordLink
    ? await syncPremiumRoleForSteam(env, steamId, isActiveSubscription(subscription))
    : null;

  return jsonResponse({
    steamId,
    subscription: publicSubscription(subscription),
    latestPayment: latestPayment ? publicPayment(latestPayment, origin) : null,
    discordLink: publicDiscordLink(steamId, discordLink, premiumRole),
  }, env);
}

async function handleCloudSavesList(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const appId = url.searchParams.get("appId")?.trim();
  const query = appId
    ? env.SUBSCRIPTION_DB.prepare(
        `SELECT * FROM cloud_saves WHERE steam_id = ? AND app_id = ? ORDER BY updated_at DESC LIMIT 20`
      ).bind(auth.session!.steamId, appId)
    : env.SUBSCRIPTION_DB.prepare(
        `SELECT * FROM cloud_saves WHERE steam_id = ? ORDER BY updated_at DESC LIMIT 100`
      ).bind(auth.session!.steamId);
  const rows = await query.all<CloudSaveRow>();
  return jsonResponse({ saves: (rows.results || []).map(publicCloudSave) }, env);
}

async function handleCloudSaveUpload(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const appId = request.headers.get("x-ghostbox-app-id")?.trim() || "";
  const gameTitle = request.headers.get("x-ghostbox-game-title")?.trim() || appId;
  const sha256 = request.headers.get("x-ghostbox-sha256")?.trim().toLowerCase() || "";
  const deviceName = request.headers.get("x-ghostbox-device-name")?.trim() || null;
  const manifestHeader = request.headers.get("x-ghostbox-manifest") || "";
  if (!/^\d{1,12}$/.test(appId)) return jsonResponse({ error: "invalid_app_id" }, env, 400);
  if (!/^[a-f0-9]{64}$/.test(sha256)) return jsonResponse({ error: "invalid_sha256" }, env, 400);

  let manifest: unknown = null;
  if (manifestHeader) {
    try {
      manifest = JSON.parse(manifestHeader);
    } catch {
      return jsonResponse({ error: "invalid_manifest" }, env, 400);
    }
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return jsonResponse({ error: "empty_backup" }, env, 400);
  if (bytes.byteLength > 50 * 1024 * 1024) return jsonResponse({ error: "backup_too_large" }, env, 413);

  const id = crypto.randomUUID();
  const now = nowIso();
  const storage = requireSupabase(env);
  const storagePath = `${auth.session!.steamId}/${appId}/${id}.zip`;
  const upload = await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(storage.bucket)}/${storagePath}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${storage.key}`,
      apikey: storage.key,
      "content-type": "application/zip",
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!upload.ok) {
    return jsonResponse({ error: "storage_upload_failed", detail: await upload.text().catch(() => "") }, env, 502);
  }

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO cloud_saves (
       id, steam_id, app_id, game_title, storage_path, size_bytes, sha256, manifest_json, device_name, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.session!.steamId, appId, gameTitle, storagePath, bytes.byteLength, sha256, manifest ? JSON.stringify(manifest) : null, deviceName, now, now).run();

  const stale = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE steam_id = ? AND app_id = ? ORDER BY updated_at DESC LIMIT 100 OFFSET 3`
  ).bind(auth.session!.steamId, appId).all<CloudSaveRow>();
  for (const row of stale.results || []) {
    await deleteCloudSaveObject(env, row.storage_path).catch(() => undefined);
    await env.SUBSCRIPTION_DB.prepare(`DELETE FROM cloud_saves WHERE id = ?`).bind(row.id).run();
  }

  return jsonResponse({ save: publicCloudSave({
    id,
    steam_id: auth.session!.steamId,
    app_id: appId,
    game_title: gameTitle,
    storage_path: storagePath,
    size_bytes: bytes.byteLength,
    sha256,
    manifest_json: manifest ? JSON.stringify(manifest) : null,
    device_name: deviceName,
    created_at: now,
    updated_at: now,
  }) }, env, 201);
}

async function deleteCloudSaveObject(env: Env, storagePath: string) {
  const storage = requireSupabase(env);
  await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(storage.bucket)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${storage.key}`,
      apikey: storage.key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: [storagePath] }),
  });
}

async function handleCloudSaveDownload(request: Request, env: Env, saveId: string) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE id = ? AND steam_id = ? LIMIT 1`
  ).bind(saveId, auth.session!.steamId).first<CloudSaveRow>();
  if (!row) return jsonResponse({ error: "not_found" }, env, 404);

  const storage = requireSupabase(env);
  const response = await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(storage.bucket)}/${row.storage_path}`, {
    headers: {
      authorization: `Bearer ${storage.key}`,
      apikey: storage.key,
    },
  });
  if (!response.ok || !response.body) {
    return jsonResponse({ error: "storage_download_failed" }, env, 502);
  }
  return new Response(response.body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(row.size_bytes),
      "x-ghostbox-sha256": row.sha256,
      "cache-control": "no-store",
    },
  });
}

async function handleRefreshPayment(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const checkoutId = url.searchParams.get("checkoutId") || url.searchParams.get("checkoutReference");
  if (!checkoutId) return jsonResponse({ error: "Missing checkoutId" }, env, 400);

  const payment = await getPaymentByCheckout(env, checkoutId);
  if (!payment) return jsonResponse({ error: "Payment not found" }, env, 404);

  const sumupId = payment.checkout_id || checkoutId;
  const checkout = await getSumUpCheckout(env, sumupId);
  const nextPayment = await updatePaymentFromSumUp(env, payment, checkout);
  const subscription = await getSubscription(env, payment.steam_id);

  return jsonResponse({
    payment: publicPayment(nextPayment, origin),
    subscription: publicSubscription(subscription),
  }, env);
}

async function handlePixQr(request: Request, env: Env) {
  const url = new URL(request.url);
  const checkoutId = url.searchParams.get("checkoutId");
  if (!checkoutId) return jsonResponse({ error: "Missing checkoutId" }, env, 400);

  const payment = await getPaymentByCheckout(env, checkoutId);
  if (!payment?.sumup_payload) return jsonResponse({ error: "Payment not found" }, env, 404);
  const payload = JSON.parse(payment.sumup_payload);
  const barcode = pixArtefacts(payload).find((artefact) => artefact.name === "barcode")
    || pixArtefacts(payload).find((artefact) => artefact.content_type?.startsWith("image/"));
  if (!barcode?.location) return jsonResponse({ error: "Pix QR code not found" }, env, 404);

  const artefactUrl = new URL(barcode.location);
  if (artefactUrl.protocol !== "https:" || artefactUrl.hostname !== "api.sumup.com") {
    return jsonResponse({ error: "Invalid Pix artifact URL" }, env, 400);
  }

  const response = await fetch(artefactUrl, {
    headers: {
      accept: barcode.content_type || "image/jpeg",
      authorization: `Bearer ${env.SUMUP_API_KEY}`,
    },
  });
  if (!response.ok) return jsonResponse({ error: "Could not load Pix QR code" }, env, 502);
  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") || barcode.content_type || "image/jpeg",
      "cache-control": "no-store",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    },
  });
}

async function handleWebhook(request: Request, env: Env, context: ExecutionContext) {
  const payload = await request.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = payload ? JSON.parse(payload) : {};
  } catch {
    parsed = {};
  }

  const eventId = typeof parsed.id === "string" ? parsed.id : crypto.randomUUID();
  const eventType = typeof parsed.event_type === "string" ? parsed.event_type : typeof parsed.type === "string" ? parsed.type : null;
  const checkoutId = typeof parsed.checkout_id === "string" ? parsed.checkout_id : typeof parsed.checkoutId === "string" ? parsed.checkoutId : typeof parsed.id === "string" ? parsed.id : null;
  const checkoutReference = typeof parsed.checkout_reference === "string" ? parsed.checkout_reference : typeof parsed.checkoutReference === "string" ? parsed.checkoutReference : null;

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, event_type, checkout_id, checkout_reference, payload)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(eventId, eventType, checkoutId, checkoutReference, payload).run();

  const lookup = checkoutId || checkoutReference;
  if (lookup) {
    context.waitUntil((async () => {
      const payment = await getPaymentByCheckout(env, lookup);
      if (!payment) return;
      const sumupId = payment.checkout_id || checkoutId || lookup;
      const checkout = await getSumUpCheckout(env, sumupId);
      await updatePaymentFromSumUp(env, payment, checkout);
    })());
  }

  return jsonResponse({ ok: true }, env);
}

async function handleReturn(env: Env) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GhostBox Premium</title></head><body><p>Pagamento recebido pela SumUp. Volte ao GhostBox para atualizar o status.</p><script>setTimeout(() => window.close(), 1500)</script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      },
    }
  );
}

async function route(request: Request, env: Env, context: ExecutionContext) {
  if (request.method === "OPTIONS") return jsonResponse({}, env);

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "ghostbox-subscriptions" }, env);
  }
  if (request.method === "POST" && url.pathname === "/auth/steam") {
    return handleSteamAuth(request, env);
  }
  if (request.method === "GET" && url.pathname === "/cloud-saves") {
    return handleCloudSavesList(request, env);
  }
  if (request.method === "POST" && url.pathname === "/cloud-saves") {
    return handleCloudSaveUpload(request, env);
  }
  const downloadMatch = url.pathname.match(/^\/cloud-saves\/([^/]+)\/download$/);
  if (request.method === "GET" && downloadMatch) {
    return handleCloudSaveDownload(request, env, downloadMatch[1]);
  }
  if (request.method === "POST" && url.pathname === "/subscription/checkouts") {
    return handleCreateCheckout(request, env);
  }
  if (request.method === "GET" && url.pathname === "/subscription/status") {
    return handleStatus(request, env);
  }
  if (request.method === "GET" && url.pathname === "/discord/link-status") {
    return handleDiscordLinkStatus(request, env);
  }
  if (request.method === "GET" && url.pathname === "/discord/link") {
    return handleDiscordLinkStart(request, env);
  }
  if (request.method === "GET" && url.pathname === "/discord/callback") {
    return handleDiscordCallback(request, env);
  }
  if (request.method === "POST" && url.pathname === "/discord/sync-premium") {
    return handleDiscordSync(request, env);
  }
  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/subscription/refresh") {
    return handleRefreshPayment(request, env);
  }
  if (request.method === "GET" && url.pathname === "/subscription/pix-qr") {
    return handlePixQr(request, env);
  }
  if (request.method === "GET" && url.pathname === "/subscription/return") {
    return handleReturn(env);
  }
  if (request.method === "POST" && url.pathname === "/sumup/webhook") {
    return handleWebhook(request, env, context);
  }

  return jsonResponse({ error: "Not found" }, env, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    try {
      return await route(request, env, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return jsonResponse({ error: message }, env, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, _context: ExecutionContext) {
    await syncDiscordPremiumRoles(env);
  },
};
