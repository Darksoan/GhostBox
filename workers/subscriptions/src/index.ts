import {
  clientIp,
  firebaseDeleteAccount,
  firebaseExchangeRefreshToken,
  firebaseLookup,
  firebaseSendEmailVerification,
  firebaseSendPasswordReset,
  firebaseSignIn,
  firebaseSignUp,
  firebaseUpdatePassword,
  getAccountByEmail,
  getAccountByUserId,
  getAccountByUsername,
  insertAccount,
  mapFirebaseError,
  normalizeEmail,
  normalizeUsername,
  publicAccount,
  recordAuthAttempt,
  tooManyAuthAttempts,
  touchAccountVerified,
  validPassword,
  type AccountRow,
} from "./auth";

type Env = {
  SUBSCRIPTION_DB: D1Database;
  CHECKOUT_RETURN_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
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
  PROFILE_IMAGE_BUCKET?: string;
  FIREBASE_API_KEY?: string;
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
  steam_id: string | null;
  user_id: string | null;
  plan_id: PlanId;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  hosted_checkout_url: string | null;
  stripe_checkout_session_id: string | null;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_subscription_id: string | null;
  provider: "stripe" | null;
  provider_payload: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

type SubscriptionRow = {
  steam_id: string | null;
  user_id: string | null;
  plan_id: PlanId;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  last_payment_id: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  cancel_at_period_end?: number;
  created_at: string;
  updated_at: string;
};

type StripePortalFlow = "manage" | "payment_method_update";

type DiscordLinkRow = {
  steam_id: string | null;
  user_id: string | null;
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
  userId: string;
  steamId?: string | null;
  exp: number;
};

type UserConnectionRow = {
  user_id: string;
  provider: string;
  provider_id: string;
  metadata_json: string | null;
  linked_at: string;
};

type CloudSaveRow = {
  id: string;
  steam_id: string | null;
  user_id: string | null;
  app_id: string;
  game_title: string;
  storage_path: string;
  size_bytes: number;
  sha256: string;
  manifest_json: string | null;
  device_name: string | null;
  pinned?: number | boolean | null;
  created_at: string;
  updated_at: string;
};

const MAX_CLOUD_SAVES_PER_GAME = 3;

type UserProfileCloudRow = {
  steam_id: string | null;
  user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  banner_position_x: number;
  banner_position_y: number;
  banner_position_scale: number;
  updated_at: string;
};

type UserCollectionCloudRow = {
  id: string;
  steam_id: string | null;
  user_id: string | null;
  name: string;
  sort_order: number;
  updated_at: string;
};

type UserCollectionGameCloudRow = {
  steam_id: string | null;
  user_id: string | null;
  collection_id: string;
  game_id: string;
  sort_order: number;
};

type UserFavoriteGameCloudRow = {
  game_id: string;
};

type CloudProfileCollectionInput = {
  id?: unknown;
  name?: unknown;
  gameIds?: unknown;
};

type CloudProfileSnapshotInput = {
  version?: unknown;
  updatedAt?: unknown;
  steamProfile?: {
    displayName?: unknown;
    avatarUrl?: unknown;
    bannerUrl?: unknown;
    bannerPosition?: {
      x?: unknown;
      y?: unknown;
      scale?: unknown;
    } | null;
  } | null;
  favoriteGameIds?: unknown;
  userCollections?: unknown;
};

const CLOUD_PROFILE_SCHEMA_VERSION = 1;
const MAX_CLOUD_PROFILE_URL_LENGTH = 2048;
const MAX_CLOUD_PROFILE_PAYLOAD_BYTES = 256 * 1024;
const MAX_CLOUD_COLLECTION_NAME_LENGTH = 64;
const MAX_CLOUD_COLLECTIONS = 100;
const MAX_CLOUD_GAMES_PER_COLLECTION = 2000;
const MAX_CLOUD_FAVORITES = 5000;

const CLOUD_URL_PREFIXES: Array<{ compact: string; expand: string }> = [
  { compact: "s-av:", expand: "https://avatars.cloudflare.steamstatic.com/" },
  { compact: "s-av2:", expand: "https://avatars.akamai.steamstatic.com/" },
  {
    compact: "s-av3:",
    expand: "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/",
  },
  { compact: "s-cdn:", expand: "https://cdn.cloudflare.steamstatic.com/steam/" },
  {
    compact: "s-cdn2:",
    expand: "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/",
  },
  {
    compact: "s-media:",
    expand: "https://shared.akamai.steamstatic.com/store_item_assets/steam/",
  },
];

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

function nowIso() {
  return new Date().toISOString();
}

function stripeSubscriptionIsPremium(status: unknown) {
  return status === "active" || status === "trialing";
}

function stripePeriodDate(value: unknown, fallback: string | null = null) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : fallback;
}

function planIdFromStripe(value: unknown, fallback: PlanId = "monthly"): PlanId {
  return value === "quarterly" || value === "monthly" ? value : fallback;
}

function validSteamId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
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

function hex(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }
  return value;
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function verifyStripeWebhookSignature(
  signatureHeader: string | null,
  payload: string,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;
  const timestamp = tPart.split("=")[1];
  const signature = v1Part.split("=")[1];
  if (!timestamp || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - parseInt(timestamp, 10));
  if (Number.isNaN(diff) || diff > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = await hmacSha256Hex(secret, signedPayload);
  return timingSafeEqual(signature, expectedSignature);
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
    if (!validUserId(decoded.userId) || decoded.exp < Math.floor(Date.now() / 1000)) return null;
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

async function createDiscordState(env: Env, userId: string) {
  const secret = getDiscordStateSecret(env);
  if (!secret) throw new Error("DISCORD_OAUTH_STATE_SECRET is not configured");

  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${userId}.${expiresAt}.${nonce}`;
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

async function verifyDiscordState(env: Env, state: string | null) {
  const secret = getDiscordStateSecret(env);
  if (!secret || !state) return null;

  const parts = state.split(".");
  if (parts.length !== 4) return null;

  const [userId, expiresAtValue, nonce, signature] = parts;
  if (!validUserId(userId) || !nonce) return null;

  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const payload = `${userId}.${expiresAtValue}.${nonce}`;
  const expected = await hmacSha256(secret, payload);
  return timingSafeEqual(signature, expected) ? userId : null;
}

function jsonResponse(value: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "cache-control": "no-store",
    },
  });
}

function cloudSaveBucket(env: Env) {
  return env.CLOUD_SAVE_BUCKET || "cloud-saves";
}

function profileImageBucket(env: Env) {
  return env.PROFILE_IMAGE_BUCKET || "profile-images";
}

function requireSupabase(env: Env) {
  const url = env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase cloud save storage is not configured");
  return { url, key, bucket: cloudSaveBucket(env) };
}

async function handleCloudProfileImageUpload(request: Request, env: Env, kind: "avatar" | "banner") {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return jsonResponse({ error: "invalid_profile_image_type" }, env, 415);
  }
  const bytes = await request.arrayBuffer();
  const maxBytes = kind === "avatar" ? 100 * 1024 : 350 * 1024;
  if (bytes.byteLength === 0) return jsonResponse({ error: "empty_profile_image" }, env, 400);
  if (bytes.byteLength > maxBytes) return jsonResponse({ error: "profile_image_too_large" }, env, 413);

  const storage = requireSupabase(env);
  const bucket = profileImageBucket(env);
  const storagePath = `${auth.session!.userId}/${kind}.webp`;
  const upload = await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${storage.key}`,
      apikey: storage.key,
      "content-type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!upload.ok) return jsonResponse({ error: "profile_image_upload_failed" }, env, 502);
  const publicUrl = new URL(`${storage.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${storagePath}`);
  publicUrl.searchParams.set("v", String(Date.now()));
  return jsonResponse({ url: publicUrl.toString() }, env, 201);
}

async function handleCloudProfileImageDelete(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const storage = requireSupabase(env);
  const bucket = profileImageBucket(env);
  const response = await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${storage.key}`, apikey: storage.key, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [`${auth.session!.userId}/banner.webp`] }),
  });
  if (!response.ok) return jsonResponse({ error: "profile_image_delete_failed" }, env, 502);
  return jsonResponse({ ok: true }, env);
}

function publicCloudSave(row: CloudSaveRow) {
  return {
    id: row.id,
    steamId: row.steam_id,
    userId: row.user_id,
    appId: row.app_id,
    gameTitle: row.game_title,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    deviceName: row.device_name,
    pinned: row.pinned === true || row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getLinkedSteamId(env: Env, userId: string): Promise<string | null> {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT provider_id FROM user_connections WHERE user_id = ? AND provider = 'steam' LIMIT 1`
  ).bind(userId).first<{ provider_id: string }>();
  return row?.provider_id || null;
}

async function requireSession(request: Request, env: Env) {
  const session = await verifyCloudToken(env, request);
  if (!session) return { response: jsonResponse({ error: "unauthorized" }, env, 401) };
  // steamId is resolved per request instead of being baked into the token:
  // Steam is linked (and unlinked) long after the token was signed, so a
  // token-embedded value would be stale for up to its 7-day lifetime and
  // would tag new rows with a Steam account the user already disconnected.
  session.steamId = await getLinkedSteamId(env, session.userId);
  return { session };
}

async function requirePremiumSession(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return { response: auth.response };
  const subscription = await getSubscription(env, auth.session!.userId);
  if (!isActiveSubscription(subscription)) {
    return { response: jsonResponse({ error: "premium_required" }, env, 402) };
  }
  return { session: auth.session };
}

function publicPayment(row: PaymentRow, origin?: string) {
  void origin;
  return {
    id: row.id,
    checkoutReference: row.checkout_reference,
    checkoutId: row.checkout_id || row.stripe_checkout_session_id,
    steamId: row.steam_id,
    userId: row.user_id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    hostedCheckoutUrl: row.hosted_checkout_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    provider: row.provider,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

async function reconcilePaymentWithSubscription(env: Env, payment: PaymentRow | null, subscription: SubscriptionRow | null) {
  if (!payment || !isActiveSubscription(subscription) || subscription?.last_payment_id !== payment.id) {
    return payment;
  }

  const confirmedAt = payment.confirmed_at || subscription.current_period_start || payment.updated_at;
  if (payment.status === "paid" && payment.confirmed_at) return payment;

  const updatedAt = nowIso();
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE payments SET status = 'paid', confirmed_at = ?, updated_at = ? WHERE id = ?`
  ).bind(confirmedAt, updatedAt, payment.id).run();

  return {
    ...payment,
    status: "paid" as PaymentStatus,
    confirmed_at: confirmedAt,
    updated_at: updatedAt,
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
      cancelAtPeriodEnd: false,
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
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    updatedAt: row.updated_at,
  };
}

function publicPaymentMethod(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const paymentMethod = value as Record<string, unknown>;
  const type = typeof paymentMethod.type === "string" ? paymentMethod.type : null;
  const card =
    paymentMethod.card && typeof paymentMethod.card === "object"
      ? paymentMethod.card as Record<string, unknown>
      : null;
  const brand = typeof card?.brand === "string" ? card.brand : null;
  const last4 = typeof card?.last4 === "string" ? card.last4 : null;
  if (!type && !brand && !last4) return null;
  return { type, brand, last4 };
}

async function resolveStripePaymentMethod(env: Env, subscription: SubscriptionRow | null) {
  if (!subscription || !env.STRIPE_SECRET_KEY?.trim()) return null;

  try {
    const subscriptionId = subscription.stripe_subscription_id?.trim();
    if (subscriptionId) {
      const stripeSubscription = await stripeRequest(
        env,
        `/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=default_payment_method`
      );
      const fromSubscription = publicPaymentMethod(stripeSubscription.default_payment_method);
      if (fromSubscription) return fromSubscription;
    }

    const customerId = subscription.stripe_customer_id?.trim();
    if (!customerId) return null;

    const customer = await stripeRequest(
      env,
      `/customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`
    );
    const invoiceSettings =
      customer.invoice_settings && typeof customer.invoice_settings === "object"
        ? customer.invoice_settings as Record<string, unknown>
        : null;
    return publicPaymentMethod(invoiceSettings?.default_payment_method);
  } catch (error) {
    console.warn("Failed to resolve Stripe payment method", error);
    return null;
  }
}

type DiscordRoleSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
};

function publicDiscordLink(row: DiscordLinkRow | null, roleSync?: DiscordRoleSyncResult | null) {
  return {
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

async function syncPremiumRoleForUser(env: Env, userId: string, grant: boolean): Promise<DiscordRoleSyncResult> {
  const link = await getDiscordLink(env, userId);
  if (!link) return { ok: false, skipped: true, reason: "Account has no Discord link" };

  const result = await discordRoleRequest(env, link.discord_user_id, grant);
  if (!result.ok && !result.skipped) {
    console.warn("Discord Premium role sync failed", { userId, discordUserId: link.discord_user_id, grant, reason: result.reason });
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
    `SELECT * FROM payments WHERE checkout_id = ? OR checkout_reference = ? OR stripe_checkout_session_id = ? LIMIT 1`
  ).bind(checkoutId, checkoutId, checkoutId).first<PaymentRow>();
}

async function getSubscription(env: Env, userId: string) {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<SubscriptionRow>();

  if (row?.status === "active" && row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) {
    const updatedAt = nowIso();
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE user_id = ?`
    ).bind(updatedAt, userId).run();
    await syncPremiumRoleForUser(env, userId, false).catch((error) => {
      console.warn("Discord Premium role revoke failed", { userId, error: error instanceof Error ? error.message : String(error) });
    });
    return { ...row, status: "expired" as SubscriptionStatus, updated_at: updatedAt };
  }

  return row;
}

async function getDiscordLink(env: Env, userId: string) {
  return env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM discord_links WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<DiscordLinkRow>();
}

async function syncDiscordPremiumRoles(env: Env) {
  const now = nowIso();
  const expired = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND user_id IS NOT NULL
       AND current_period_end IS NOT NULL AND current_period_end <= ?
     LIMIT 100`
  ).bind(now).all<SubscriptionRow>();

  let granted = 0;
  let revoked = 0;
  let skipped = 0;
  const failures: Array<{ userId: string; action: "grant" | "revoke"; reason: string }> = [];

  for (const subscription of expired.results || []) {
    if (!subscription.user_id) continue;
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE user_id = ?`
    ).bind(now, subscription.user_id).run();

    const result = await syncPremiumRoleForUser(env, subscription.user_id, false);
    if (result.ok) revoked += 1;
    else if (result.skipped) skipped += 1;
    else failures.push({ userId: subscription.user_id, action: "revoke", reason: result.reason || "Unknown Discord error" });
  }

  const active = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND user_id IS NOT NULL
       AND current_period_end IS NOT NULL AND current_period_end > ?
     LIMIT 100`
  ).bind(now).all<SubscriptionRow>();

  for (const subscription of active.results || []) {
    if (!subscription.user_id) continue;
    const result = await syncPremiumRoleForUser(env, subscription.user_id, true);
    if (result.ok) granted += 1;
    else if (result.skipped) skipped += 1;
    else failures.push({ userId: subscription.user_id, action: "grant", reason: result.reason || "Unknown Discord error" });
  }

  await env.SUBSCRIPTION_DB.prepare(
    `DELETE FROM auth_attempts WHERE created_at < ?`
  ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).run();

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

async function handleDiscordLinkStatus(request: Request, env: Env, context?: ExecutionContext) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  const [subscription, link] = await Promise.all([
    getSubscription(env, userId),
    getDiscordLink(env, userId),
  ]);

  if (link && context) {
    context.waitUntil(
      syncPremiumRoleForUser(env, userId, isActiveSubscription(subscription)).catch((error) => {
        console.warn("Background Discord role sync failed", error);
      })
    );
  }

  return jsonResponse(publicDiscordLink(link, null), env);
}

async function handleDiscordLinkStart(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return jsonResponse({ error: "Discord OAuth is not configured" }, env, 500);
  }

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", getDiscordRedirectUri(env, request));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", await createDiscordState(env, auth.session!.userId));

  // Returned as JSON (not a redirect): the caller opens this URL in the
  // system browser itself, since a browser navigation can't carry our
  // Authorization header the way this authenticated fetch call can.
  return jsonResponse({ url: authorizeUrl.toString() }, env);
}

async function handleDiscordCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const userId = await verifyDiscordState(env, url.searchParams.get("state"));
  const code = url.searchParams.get("code");

  if (!userId || !code) {
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
       steam_id, user_id, discord_user_id, discord_username, discord_global_name, linked_at, updated_at
     ) VALUES (NULL, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       discord_user_id = excluded.discord_user_id,
       discord_username = excluded.discord_username,
       discord_global_name = excluded.discord_global_name,
       linked_at = excluded.linked_at,
       updated_at = excluded.updated_at`
  ).bind(userId, user.id, user.username ?? null, user.global_name ?? null, now, now).run();

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO user_connections (user_id, provider, provider_id, metadata_json, linked_at)
     VALUES (?, 'discord', ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       provider_id = excluded.provider_id,
       metadata_json = excluded.metadata_json,
       linked_at = excluded.linked_at`
  ).bind(userId, user.id, JSON.stringify({ username: user.username ?? null, globalName: user.global_name ?? null }), now).run();

  const subscription = await getSubscription(env, userId);
  let roleSynced = false;
  if (isActiveSubscription(subscription)) {
    const result = await syncPremiumRoleForUser(env, userId, true).catch((error) => {
      console.warn("Discord Premium role grant after link failed", { userId, discordUserId: user.id, error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    roleSynced = result?.ok === true;
  }

  return htmlResponse(
    "Discord vinculado",
    roleSynced
      ? "Sua conta Discord foi vinculada ao GhostBox e o cargo Premium foi sincronizado. Você já pode voltar ao app."
      : "Sua conta Discord foi vinculada ao GhostBox. Entre no servidor pelo convite e volte ao app para sincronizar o cargo Premium."
  );
}

async function stripeRequest(
  env: Env,
  path: string,
  init: { method?: string; body?: URLSearchParams } = {}
) {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init.method || "GET",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: init.body,
  });

  const payload = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : null;
    const message =
      (typeof error?.message === "string" && error.message) ||
      (typeof payload.message === "string" && payload.message) ||
      `Stripe request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function stripeMetadataString(payload: Record<string, unknown>, key: string): string | null {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function saveStripeCustomerId(env: Env, userId: string, customerId: string, steamId?: string | null) {
  const now = nowIso();
  const existing = await getSubscription(env, userId);
  if (existing) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ?`
    ).bind(customerId, now, userId).run();
    return;
  }

  // Premium portal can open for accounts that only have a Stripe customer
  // record after checkout migration; seed a free row so the id persists.
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO subscriptions (
       steam_id, user_id, plan_id, status, current_period_start, current_period_end,
       last_payment_id, stripe_customer_id, created_at, updated_at
     ) VALUES (?, ?, 'monthly', 'free', NULL, NULL, NULL, ?, ?, ?)`
  ).bind(steamId || null, userId, customerId, now, now).run();
}

async function findStripeCustomerIdByUser(env: Env, userId: string) {
  const query = `metadata['user_id']:'${userId}'`;
  const payload = await stripeRequest(
    env,
    `/customers/search?query=${encodeURIComponent(query)}&limit=1`
  );
  const data = Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : [];
  const customerId = typeof data[0]?.id === "string" ? data[0].id : null;
  return customerId;
}

async function createStripeCustomerForUser(env: Env, userId: string, steamId?: string | null) {
  const body = new URLSearchParams();
  body.set("metadata[user_id]", userId);
  if (steamId) body.set("metadata[steam_id]", steamId);
  body.set("description", `GhostBox Premium · ${userId}`);
  const customer = await stripeRequest(env, "/customers", { method: "POST", body });
  const customerId = typeof customer.id === "string" ? customer.id : null;
  if (!customerId) throw new Error("Stripe did not return a customer id");
  return customerId;
}

async function resolveStripeCustomerId(
  env: Env,
  userId: string,
  subscription: SubscriptionRow | null,
  steamId?: string | null
) {
  const stored = subscription?.stripe_customer_id?.trim();
  if (stored) return stored;

  const searched = await findStripeCustomerIdByUser(env, userId).catch(() => null);
  if (searched) {
    await saveStripeCustomerId(env, userId, searched, steamId);
    return searched;
  }

  const created = await createStripeCustomerForUser(env, userId, steamId);
  await saveStripeCustomerId(env, userId, created, steamId);
  return created;
}

function stripePortalReturnUrl(env: Env, request: Request) {
  return (
    env.STRIPE_PORTAL_RETURN_URL?.trim() ||
    env.CHECKOUT_RETURN_URL?.trim() ||
    `${new URL(request.url).origin}/subscription/return`
  );
}

async function handleCreateBillingPortal(request: Request, env: Env) {
  if (!env.STRIPE_SECRET_KEY?.trim()) {
    return jsonResponse(
      {
        error:
          "Stripe billing portal is not configured. Set STRIPE_SECRET_KEY on the subscriptions worker.",
      },
      env,
      503
    );
  }

  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  const body = await readJson(request);
  const flowRaw = typeof body?.flow === "string" ? body.flow.trim() : "manage";
  const flow: StripePortalFlow =
    flowRaw === "payment_method_update" ? "payment_method_update" : "manage";

  const subscription = await getSubscription(env, userId);
  if (!isActiveSubscription(subscription)) {
    return jsonResponse(
      { error: "An active Premium subscription is required to manage billing." },
      env,
      402
    );
  }

  const customerId = await resolveStripeCustomerId(env, userId, subscription, auth.session!.steamId);
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", stripePortalReturnUrl(env, request));
  if (flow === "payment_method_update") {
    params.set("flow_data[type]", "payment_method_update");
  }

  const session = await stripeRequest(env, "/billing_portal/sessions", {
    method: "POST",
    body: params,
  });
  const url = typeof session.url === "string" ? session.url : null;
  if (!url) {
    return jsonResponse({ error: "Stripe did not return a portal URL." }, env, 502);
  }

  return jsonResponse({ url, flow, customerId }, env);
}

async function handleCreateCheckout(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;
  const steamId = auth.session!.steamId || null;

  const body = await readJson(request);
  const planId = body?.planId;
  if (planId !== "monthly" && planId !== "quarterly") return jsonResponse({ error: "Invalid plan" }, env, 400);

  const plan = plans[planId];
  const subscription = await getSubscription(env, userId);
  const customerId = await resolveStripeCustomerId(env, userId, subscription, steamId);

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer", customerId);
  params.set("success_url", `${env.CHECKOUT_RETURN_URL || origin + "/subscription/return"}?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${env.CHECKOUT_RETURN_URL || origin + "/subscription/return"}?cancelled=1`);
  params.set("line_items[0][price_data][currency]", "brl");
  params.set("line_items[0][price_data][product_data][name]", plan.description);
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][recurring][interval_count]", planId === "quarterly" ? "3" : "1");
  params.set("line_items[0][price_data][unit_amount]", String(plan.amountCents));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[user_id]", userId);
  params.set("metadata[plan_id]", planId);
  params.set("subscription_data[metadata][user_id]", userId);
  params.set("subscription_data[metadata][plan_id]", planId);
  if (steamId) {
    params.set("metadata[steam_id]", steamId);
    params.set("subscription_data[metadata][steam_id]", steamId);
  }

  const session = await stripeRequest(env, "/checkout/sessions", {
    method: "POST",
    body: params,
  });

  const sessionId = typeof session.id === "string" ? session.id : null;
  const sessionUrl = typeof session.url === "string" ? session.url : null;
  if (!sessionId || !sessionUrl) {
    throw new Error("Stripe did not return a checkout session");
  }

  const paymentId = crypto.randomUUID();
  const reference = `ghostbox-${userId}-${planId}-${paymentId}`;
  const createdAt = nowIso();

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO payments (
       id, checkout_reference, checkout_id, steam_id, user_id, plan_id, amount_cents, currency,
       status, hosted_checkout_url, stripe_checkout_session_id, provider, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL', 'pending', ?, ?, 'stripe', ?, ?)`
  ).bind(
    paymentId,
    reference,
    sessionId,
    steamId,
    userId,
    planId,
    plan.amountCents,
    sessionUrl,
    sessionId,
    createdAt,
    createdAt
  ).run();

  const payment = await env.SUBSCRIPTION_DB.prepare(`SELECT * FROM payments WHERE id = ?`).bind(paymentId).first<PaymentRow>();
  return jsonResponse({ payment: payment ? publicPayment(payment, origin) : null }, env, 201);
}

async function handleStatus(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  const [subscription, latestPaymentRow, discordLink] = await Promise.all([
    getSubscription(env, userId),
    env.SUBSCRIPTION_DB.prepare(
      `SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first<PaymentRow>(),
    getDiscordLink(env, userId),
  ]);
  const latestPayment = isActiveSubscription(subscription) && !subscription?.last_payment_id
    ? null
    : await reconcilePaymentWithSubscription(env, latestPaymentRow, subscription);

  return jsonResponse({
    userId,
    steamId: auth.session!.steamId || null,
    subscription: publicSubscription(subscription),
    latestPayment: latestPayment ? publicPayment(latestPayment, origin) : null,
    paymentMethod: null,
    discordLink: publicDiscordLink(discordLink, null),
  }, env);
}

async function handleCloudSavesList(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;
  const url = new URL(request.url);
  const appId = url.searchParams.get("appId")?.trim();

  // Listing is read-only. It must never prune: a GET that deletes backups
  // means simply opening the backup modal destroys the user's history.
  // Retention is enforced on upload and on pin changes only.
  const query = appId
    ? env.SUBSCRIPTION_DB.prepare(
         `SELECT * FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY app_id ORDER BY pinned DESC, updated_at DESC) AS save_rank
           FROM cloud_saves
           WHERE user_id = ? AND app_id = ?
         ) WHERE save_rank <= ? ORDER BY updated_at DESC LIMIT 20`
      ).bind(userId, appId, MAX_CLOUD_SAVES_PER_GAME)
    : env.SUBSCRIPTION_DB.prepare(
         `SELECT * FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY app_id ORDER BY pinned DESC, updated_at DESC) AS save_rank
           FROM cloud_saves
           WHERE user_id = ?
         ) WHERE save_rank <= ? ORDER BY updated_at DESC LIMIT 100`
      ).bind(userId, MAX_CLOUD_SAVES_PER_GAME);
  const rows = await query.all<CloudSaveRow>();
  return jsonResponse({ saves: (rows.results || []).map(publicCloudSave) }, env);
}

async function handleCloudSaveUpload(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;
  const steamId = auth.session!.steamId || null;
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
  const storagePath = `${userId}/${appId}/${id}.zip`;
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
    const detail = await upload.text().catch(() => "");
    console.error("Cloud save storage upload failed", { appId, status: upload.status, detail });
    return jsonResponse({ error: "storage_upload_failed", detail }, env, 502);
  }

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO cloud_saves (
       id, steam_id, user_id, app_id, game_title, storage_path, size_bytes, sha256, manifest_json, device_name, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, steamId, userId, appId, gameTitle, storagePath, bytes.byteLength, sha256, manifest ? JSON.stringify(manifest) : null, deviceName, now, now).run();

  // Retention is best-effort: the backup is already stored, so a prune failure
  // must not turn a successful upload into a 500 for the user.
  await pruneCloudSavesForGame(env, userId, appId, id).catch((error) => {
    console.error("Cloud save prune failed after upload", { appId, error: error instanceof Error ? error.message : String(error) });
  });

  return jsonResponse({ save: publicCloudSave({
    id,
    steam_id: steamId,
    user_id: userId,
    app_id: appId,
    game_title: gameTitle,
    storage_path: storagePath,
    size_bytes: bytes.byteLength,
    sha256,
    manifest_json: manifest ? JSON.stringify(manifest) : null,
    device_name: deviceName,
    pinned: 0,
    created_at: now,
    updated_at: now,
  }) }, env, 201);
}

async function handleCloudSavePinnedUpdate(request: Request, env: Env, saveId: string) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;
  const normalizedSaveId = saveId.trim();
  if (!normalizedSaveId) return jsonResponse({ error: "invalid_save_id" }, env, 400);

  const payload = await request.json().catch(() => null) as { pinned?: unknown } | null;
  const pinned = payload?.pinned === true;

  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(normalizedSaveId, userId).first<CloudSaveRow>();
  if (!row) return jsonResponse({ error: "not_found" }, env, 404);

  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE cloud_saves SET pinned = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).bind(pinned ? 1 : 0, nowIso(), normalizedSaveId, userId).run();

  await pruneCloudSavesForGame(env, userId, row.app_id, normalizedSaveId).catch((error) => {
    console.error("Cloud save prune failed after pin change", { appId: row.app_id, error: error instanceof Error ? error.message : String(error) });
  });

  const updated = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(normalizedSaveId, userId).first<CloudSaveRow>();

  return jsonResponse({ save: publicCloudSave(updated || { ...row, pinned: pinned ? 1 : 0 }) }, env);
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

async function pruneCloudSavesForGame(env: Env, userId: string, appId: string, protectedSaveId: string) {
  const rows = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves
     WHERE user_id = ? AND app_id = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, pinned DESC, updated_at DESC
     LIMIT 100`
  ).bind(userId, appId, protectedSaveId).all<CloudSaveRow>();
  const stale = (rows.results || []).slice(MAX_CLOUD_SAVES_PER_GAME);

  for (const row of stale) {
    await deleteCloudSaveObject(env, row.storage_path).catch(() => undefined);
    await env.SUBSCRIPTION_DB.prepare(`DELETE FROM cloud_saves WHERE id = ?`).bind(row.id).run();
  }
}

async function handleCloudSaveDownload(request: Request, env: Env, saveId: string) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(saveId, auth.session!.userId).first<CloudSaveRow>();
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

async function handleCloudSaveDelete(request: Request, env: Env, saveId: string) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;
  const normalizedSaveId = saveId.trim();
  if (!normalizedSaveId) return jsonResponse({ error: "invalid_save_id" }, env, 400);

  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM cloud_saves WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(normalizedSaveId, userId).first<CloudSaveRow>();
  if (!row) return jsonResponse({ error: "not_found" }, env, 404);

  await deleteCloudSaveObject(env, row.storage_path).catch(() => undefined);
  await env.SUBSCRIPTION_DB.prepare(`DELETE FROM cloud_saves WHERE id = ?`).bind(row.id).run();

  const remaining = await env.SUBSCRIPTION_DB.prepare(
    `SELECT COUNT(*) AS count FROM cloud_saves WHERE user_id = ? AND app_id = ?`
  ).bind(userId, row.app_id).first<{ count: number }>();

  return jsonResponse({
    success: true,
    saveId: row.id,
    appId: row.app_id,
    remainingSaves: remaining?.count ?? 0,
  }, env);
}

function clampCloudInt(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeCloudUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:/i.test(trimmed)) throw new Error("data_url_not_allowed");
  if (trimmed.length > MAX_CLOUD_PROFILE_URL_LENGTH) throw new Error("profile_url_too_long");
  return trimmed;
}

function compactCloudUrl(value: unknown): string | null {
  const url = normalizeCloudUrl(value);
  if (!url) return null;
  for (const entry of CLOUD_URL_PREFIXES) {
    if (url.startsWith(entry.expand)) {
      const rest = url.slice(entry.expand.length);
      return rest ? `${entry.compact}${rest}` : url;
    }
  }
  return url;
}

function expandCloudUrl(value: unknown): string | null {
  const raw = normalizeCloudUrl(value);
  if (!raw) return null;
  for (const entry of CLOUD_URL_PREFIXES) {
    if (raw.startsWith(entry.compact)) {
      return `${entry.expand}${raw.slice(entry.compact.length)}`;
    }
  }
  return raw;
}

function normalizeCloudBannerPosition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { x: 50, y: 50, scale: 100 };
  }
  const position = value as Record<string, unknown>;
  const scaleRaw =
    typeof position.scale === "number"
      ? position.scale
      : Number(position.scale);
  const scale =
    Number.isFinite(scaleRaw) && scaleRaw > 3
      ? scaleRaw
      : Math.round((Number.isFinite(scaleRaw) ? scaleRaw : 1) * 100);
  return {
    x: clampCloudInt(position.x, 0, 100, 50),
    y: clampCloudInt(position.y, 0, 100, 50),
    scale: clampCloudInt(scale, 100, 300, 100),
  };
}

async function runD1Batch(database: D1Database, statements: D1PreparedStatement[]) {
  const batchSize = 100;
  for (let index = 0; index < statements.length; index += batchSize) {
    await database.batch(statements.slice(index, index + batchSize));
  }
}

function parseCloudProfileSnapshot(body: CloudProfileSnapshotInput | null) {
  if (!body || typeof body !== "object") {
    return { error: "invalid_profile_snapshot" as const };
  }

  const profile = body.steamProfile && typeof body.steamProfile === "object"
    ? body.steamProfile
    : null;
  const displayName =
    typeof profile?.displayName === "string" ? profile.displayName.trim().slice(0, 80) : null;
  const avatarUrl = compactCloudUrl(profile?.avatarUrl);
  const bannerUrl = compactCloudUrl(profile?.bannerUrl);
  const bannerPosition = normalizeCloudBannerPosition(profile?.bannerPosition);
  const favoriteGameIds = Array.isArray(body.favoriteGameIds)
    ? Array.from(
        new Set(
          body.favoriteGameIds
            .map((gameId) => (typeof gameId === "string" ? gameId.trim() : ""))
            .filter(Boolean)
            .slice(0, MAX_CLOUD_FAVORITES)
        )
      )
    : [];

  const rawCollections = Array.isArray(body.userCollections)
    ? (body.userCollections as CloudProfileCollectionInput[])
    : [];
  if (rawCollections.length > MAX_CLOUD_COLLECTIONS) {
    return { error: "too_many_collections" as const };
  }

  const collections: Array<{ id: string; name: string; gameIds: string[] }> = [];
  const usedCollectionIds = new Set<string>();
  for (const [index, collection] of rawCollections.entries()) {
    if (!collection || typeof collection !== "object") continue;
    const baseId =
      typeof collection.id === "string" && collection.id.trim()
        ? collection.id.trim().slice(0, 80)
        : `collection-${index}`;
    let id = baseId;
    if (usedCollectionIds.has(id)) id = `${id}-${index}`.slice(0, 80);
    usedCollectionIds.add(id);
    const name =
      typeof collection.name === "string" ? collection.name.trim().slice(0, MAX_CLOUD_COLLECTION_NAME_LENGTH) : "";
    if (!name) continue;

    const gameIds = Array.isArray(collection.gameIds)
      ? Array.from(
          new Set(
            collection.gameIds
              .map((gameId) => (typeof gameId === "string" ? gameId.trim() : ""))
              .filter(Boolean)
              .slice(0, MAX_CLOUD_GAMES_PER_COLLECTION)
          )
        )
      : [];

    collections.push({ id, name, gameIds });
  }

  const updatedAt =
    typeof body.updatedAt === "string" && Number.isFinite(Date.parse(body.updatedAt))
      ? new Date(body.updatedAt).toISOString()
      : nowIso();

  return {
    snapshot: {
      version: CLOUD_PROFILE_SCHEMA_VERSION,
      updatedAt,
      displayName,
      avatarUrl,
      bannerUrl,
      bannerPosition,
      favoriteGameIds,
      collections,
    },
  };
}

async function loadCloudProfileSnapshot(env: Env, userId: string) {
  const profile = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM user_profile_cloud WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<UserProfileCloudRow>();

  const collectionsResult = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM user_collections_cloud WHERE user_id = ? ORDER BY sort_order ASC, name ASC`
  ).bind(userId).all<UserCollectionCloudRow>();
  const collections = collectionsResult.results || [];

  const gamesResult = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM user_collection_games_cloud WHERE user_id = ? ORDER BY sort_order ASC`
  ).bind(userId).all<UserCollectionGameCloudRow>();
  const gamesByCollection = new Map<string, string[]>();
  for (const row of gamesResult.results || []) {
    const list = gamesByCollection.get(row.collection_id) || [];
    list.push(row.game_id);
    gamesByCollection.set(row.collection_id, list);
  }

  const favoritesResult = await env.SUBSCRIPTION_DB.prepare(
    `SELECT game_id FROM user_favorite_games_cloud WHERE user_id = ? ORDER BY sort_order ASC`
  ).bind(userId).all<UserFavoriteGameCloudRow>();
  const favoriteGameIds = (favoritesResult.results || []).map((row) => row.game_id);

  if (!profile && collections.length === 0 && favoriteGameIds.length === 0) return null;

  return {
    version: CLOUD_PROFILE_SCHEMA_VERSION,
    updatedAt: profile?.updated_at || collections[0]?.updated_at || nowIso(),
    steamProfile: {
      displayName: profile?.display_name || null,
      avatarUrl: expandCloudUrl(profile?.avatar_url),
      bannerUrl: expandCloudUrl(profile?.banner_url),
      bannerPosition: {
        x: clampCloudInt(profile?.banner_position_x, 0, 100, 50),
        y: clampCloudInt(profile?.banner_position_y, 0, 100, 50),
        scale: Number(
          (clampCloudInt(profile?.banner_position_scale, 100, 300, 100) / 100).toFixed(2)
        ),
      },
    },
    favoriteGameIds,
    userCollections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      gameIds: gamesByCollection.get(collection.id) || [],
    })),
  };
}

async function handleCloudProfileGet(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;

  const snapshot = await loadCloudProfileSnapshot(env, auth.session!.userId);
  return jsonResponse({ profile: snapshot }, env);
}

async function handleCloudProfilePut(request: Request, env: Env) {
  const auth = await requirePremiumSession(request, env);
  if (auth.response) return auth.response;

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CLOUD_PROFILE_PAYLOAD_BYTES) {
    return jsonResponse({ error: "profile_snapshot_too_large" }, env, 413);
  }

  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_CLOUD_PROFILE_PAYLOAD_BYTES) {
    return jsonResponse({ error: "profile_snapshot_too_large" }, env, 413);
  }

  let body: CloudProfileSnapshotInput | null = null;
  try {
    body = JSON.parse(text) as CloudProfileSnapshotInput;
  } catch {
    body = null;
  }
  let parsed: ReturnType<typeof parseCloudProfileSnapshot>;
  try {
    parsed = parseCloudProfileSnapshot(body);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "invalid_profile_snapshot" }, env, 400);
  }
  if ("error" in parsed) {
    return jsonResponse({ error: parsed.error }, env, 400);
  }

  const userId = auth.session!.userId;
  const steamId = auth.session!.steamId || null;
  const { snapshot } = parsed;
  const now = snapshot.updatedAt;

  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO user_profile_cloud (
       steam_id, user_id, display_name, avatar_url, banner_url,
       banner_position_x, banner_position_y, banner_position_scale, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       steam_id = COALESCE(excluded.steam_id, user_profile_cloud.steam_id),
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       banner_url = excluded.banner_url,
       banner_position_x = excluded.banner_position_x,
       banner_position_y = excluded.banner_position_y,
       banner_position_scale = excluded.banner_position_scale,
       updated_at = excluded.updated_at`
  ).bind(
    steamId,
    userId,
    snapshot.displayName,
    snapshot.avatarUrl,
    snapshot.bannerUrl,
    snapshot.bannerPosition.x,
    snapshot.bannerPosition.y,
    snapshot.bannerPosition.scale,
    now
  ).run();

  const collectionStatements: D1PreparedStatement[] = [
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_favorite_games_cloud WHERE user_id = ?`
    ).bind(userId),
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_collection_games_cloud WHERE user_id = ?`
    ).bind(userId),
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_collections_cloud WHERE user_id = ?`
    ).bind(userId),
  ];
  for (const [collectionIndex, collection] of snapshot.collections.entries()) {
    collectionStatements.push(env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_collections_cloud (id, steam_id, user_id, name, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(collection.id, steamId, userId, collection.name, collectionIndex, now));

    for (const [gameIndex, gameId] of collection.gameIds.entries()) {
      collectionStatements.push(env.SUBSCRIPTION_DB.prepare(
        `INSERT INTO user_collection_games_cloud (steam_id, user_id, collection_id, game_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(steamId, userId, collection.id, gameId, gameIndex));
    }
  }
  for (const [gameIndex, gameId] of snapshot.favoriteGameIds.entries()) {
    collectionStatements.push(env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_favorite_games_cloud (steam_id, user_id, game_id, sort_order)
       VALUES (?, ?, ?, ?)`
    ).bind(steamId, userId, gameId, gameIndex));
  }
  await runD1Batch(env.SUBSCRIPTION_DB, collectionStatements);

  const profile = await loadCloudProfileSnapshot(env, userId);
  return jsonResponse({ profile }, env);
}

type UpsertSubscriptionInput = {
  userId?: string | null;
  steamId?: string | null;
  planId: PlanId;
  status: SubscriptionStatus;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  lastPaymentId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  cancelAtPeriodEnd?: boolean;
};

async function upsertSubscription(env: Env, input: UpsertSubscriptionInput) {
  const conflictColumn = input.userId ? "user_id" : "steam_id";
  const conflictValue = input.userId || input.steamId;
  if (!conflictValue) return;
  const now = nowIso();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO subscriptions (
       steam_id, user_id, plan_id, status, current_period_start, current_period_end,
       last_payment_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status,
       cancel_at_period_end, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(${conflictColumn}) DO UPDATE SET
       steam_id = COALESCE(excluded.steam_id, subscriptions.steam_id),
       user_id = COALESCE(excluded.user_id, subscriptions.user_id),
       plan_id = excluded.plan_id,
       status = excluded.status,
       current_period_start = COALESCE(excluded.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       last_payment_id = COALESCE(excluded.last_payment_id, subscriptions.last_payment_id),
       stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
       stripe_subscription_status = COALESCE(excluded.stripe_subscription_status, subscriptions.stripe_subscription_status),
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at`
  ).bind(
    input.steamId || null,
    input.userId || null,
    input.planId,
    input.status,
    input.currentPeriodStart || null,
    input.currentPeriodEnd || null,
    input.lastPaymentId || null,
    input.stripeCustomerId || null,
    input.stripeSubscriptionId || null,
    input.stripeSubscriptionStatus || null,
    input.cancelAtPeriodEnd ? 1 : 0,
    now,
    now
  ).run();
}

async function handleRefreshPayment(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const checkoutId = url.searchParams.get("checkoutId") || url.searchParams.get("checkoutReference");
  if (!checkoutId) return jsonResponse({ error: "Missing checkoutId" }, env, 400);

  const payment = await getPaymentByCheckout(env, checkoutId);
  if (!payment) return jsonResponse({ error: "Payment not found" }, env, 404);

  const now = nowIso();

  if (payment.stripe_checkout_session_id) {
    try {
      const session = await stripeRequest(env, `/checkout/sessions/${payment.stripe_checkout_session_id}`);
      const paymentStatus = session.payment_status;
      const status = paymentStatus === "paid" ? "paid" : payment.status;

      if (status === "paid" && payment.status !== "paid") {
        await env.SUBSCRIPTION_DB.prepare(
          `UPDATE payments SET status = 'paid', provider = 'stripe', confirmed_at = ?, updated_at = ? WHERE id = ?`
        ).bind(now, now, payment.id).run();

        const subscriptionId = session.subscription;
        if (subscriptionId) {
          const subInfo = await stripeRequest(env, `/subscriptions/${subscriptionId}`);
          const stripeStatus = subInfo.status;
          const isPremium = stripeSubscriptionIsPremium(stripeStatus);

          await upsertSubscription(env, {
            userId: payment.user_id,
            steamId: payment.steam_id,
            planId: payment.plan_id,
            status: isPremium ? "active" : "expired",
            currentPeriodStart: stripePeriodDate(subInfo.current_period_start, nowIso()),
            currentPeriodEnd: stripePeriodDate(subInfo.current_period_end, nowIso()),
            lastPaymentId: payment.id,
            stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
            stripeSubscriptionId: typeof subscriptionId === "string" ? subscriptionId : null,
            stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
          });

          if (payment.user_id) {
            await syncPremiumRoleForUser(env, payment.user_id, isPremium).catch(() => undefined);
          }
        }
      }
    } catch (err) {
      console.error("Failed to refresh stripe checkout", err);
    }
  }

  const updatedPayment = await getPaymentByCheckout(env, checkoutId);
  const subscription = payment.user_id ? await getSubscription(env, payment.user_id) : null;

  return jsonResponse({
    payment: updatedPayment ? publicPayment(updatedPayment, origin) : null,
    subscription: publicSubscription(subscription),
  }, env);
}

async function handleStripeWebhook(request: Request, env: Env, context: ExecutionContext) {
  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return jsonResponse({ error: "Stripe webhook secret is not configured" }, env, 500);
  }

  const isValid = await verifyStripeWebhookSignature(signature, payload, secret);
  if (!isValid) {
    return jsonResponse({ error: "Invalid signature" }, env, 400);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, env, 400);
  }

  const eventId = typeof event.id === "string" ? event.id : crypto.randomUUID();
  const eventType = typeof event.type === "string" ? event.type : null;

  const duplicate = await env.SUBSCRIPTION_DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, event_type, payload) VALUES (?, ?, ?)`
  ).bind(eventId, eventType, payload).run();

  if (duplicate.meta.changes === 0) {
    return jsonResponse({ ok: true, note: "duplicate" }, env);
  }

  const data = event.data?.object as Record<string, any> | undefined;
  if (!data) {
    return jsonResponse({ ok: true }, env);
  }

  if (eventType === "checkout.session.completed") {
    const userId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
    const steamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;
    const planId = planIdFromStripe(data.metadata?.plan_id);
    const customerId = data.customer;
    const subscriptionId = data.subscription;
    const sessionId = data.id;

    if ((userId || steamId) && typeof subscriptionId === "string" && typeof sessionId === "string") {
      try {
        const subInfo = await stripeRequest(env, `/subscriptions/${subscriptionId}`);
        const stripeStatus = subInfo.status;
        const isPremium = stripeSubscriptionIsPremium(stripeStatus);
        const currentPeriodStart = stripePeriodDate(subInfo.current_period_start, nowIso());
        const currentPeriodEnd = stripePeriodDate(subInfo.current_period_end, nowIso());

        const paymentRow = await env.SUBSCRIPTION_DB.prepare(
          `SELECT id FROM payments WHERE stripe_checkout_session_id = ? LIMIT 1`
        ).bind(sessionId).first<{ id: string }>();

        await upsertSubscription(env, {
          userId,
          steamId,
          planId,
          status: isPremium ? "active" : "expired",
          currentPeriodStart,
          currentPeriodEnd,
          lastPaymentId: paymentRow?.id || null,
          stripeCustomerId: typeof customerId === "string" ? customerId : null,
          stripeSubscriptionId: subscriptionId,
          stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
        });

        if (userId) {
          await syncPremiumRoleForUser(env, userId, isPremium).catch((error) => {
            console.warn("Discord Premium role grant failed in webhook", error);
          });
        }
      } catch (err) {
        console.error("Failed to process checkout.session.completed", err);
      }
    }
  } else if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
    const subscriptionId = data.id;
    const status = data.status;
    const currentPeriodStart = stripePeriodDate(data.current_period_start);
    const currentPeriodEnd = stripePeriodDate(data.current_period_end);
    const cancelAtPeriodEnd = Boolean(data.cancel_at_period_end);
    const userId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
    const steamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;
    const planId = planIdFromStripe(data.metadata?.plan_id);

    if ((userId || steamId) && typeof subscriptionId === "string") {
      const isPremium = stripeSubscriptionIsPremium(status);

      await upsertSubscription(env, {
        userId,
        steamId,
        planId,
        status: isPremium ? "active" : "expired",
        currentPeriodStart,
        currentPeriodEnd,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: typeof status === "string" ? status : null,
        cancelAtPeriodEnd,
      });

      if (userId) {
        await syncPremiumRoleForUser(env, userId, isPremium).catch((error) => {
          console.warn("Discord Premium role sync failed in subscription hook", error);
        });
      }
    }
  } else if (eventType === "customer.subscription.deleted") {
    const subscriptionId = data.id;
    const now = nowIso();
    let userId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
    let steamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;

    if (!userId && !steamId && typeof subscriptionId === "string") {
      const subRow = await env.SUBSCRIPTION_DB.prepare(
        `SELECT user_id, steam_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
      ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null }>();
      userId = subRow?.user_id || null;
      steamId = subRow?.steam_id || null;
    }

    if (userId) {
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE subscriptions SET
           status = 'expired',
           stripe_subscription_status = 'canceled',
           updated_at = ?
         WHERE user_id = ?`
      ).bind(now, userId).run();

      await syncPremiumRoleForUser(env, userId, false).catch((error) => {
        console.warn("Discord Premium role revoke failed in webhook", error);
      });
    } else if (steamId) {
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE subscriptions SET
           status = 'expired',
           stripe_subscription_status = 'canceled',
           updated_at = ?
         WHERE steam_id = ? AND user_id IS NULL`
      ).bind(now, steamId).run();
    }
  } else if (eventType === "invoice.payment_succeeded") {
    const subscriptionId = data.subscription;
    const invoiceId = typeof data.id === "string" ? data.id : crypto.randomUUID();
    const paymentIntentId = typeof data.payment_intent === "string" ? data.payment_intent : null;
    const amountPaid = typeof data.amount_paid === "number" ? data.amount_paid : 0;
    const currency = data.currency?.toUpperCase() || "BRL";
    const now = nowIso();

    if (typeof subscriptionId === "string") {
      const existing = await env.SUBSCRIPTION_DB.prepare(
        `SELECT user_id, steam_id, plan_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
      ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null; plan_id: PlanId }>();
      const subInfo = await stripeRequest(env, `/subscriptions/${subscriptionId}`);
      const userId = existing?.user_id || stripeMetadataString(subInfo, "user_id");
      const steamIdMeta = stripeMetadataString(subInfo, "steam_id");
      const steamId = existing?.steam_id || (validSteamId(steamIdMeta) ? steamIdMeta : null);
      const planId = planIdFromStripe(stripeMetadataString(subInfo, "plan_id"), existing?.plan_id || "monthly");

      if (userId || steamId) {
        const paymentId = crypto.randomUUID();
        const reference = `stripe-invoice-${invoiceId}`;

        await env.SUBSCRIPTION_DB.prepare(
          `INSERT OR IGNORE INTO payments (
             id, checkout_reference, steam_id, user_id, plan_id, amount_cents, currency,
             status, stripe_invoice_id, stripe_payment_intent_id, stripe_subscription_id, provider, created_at, updated_at, confirmed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, 'stripe', ?, ?, ?)`
        ).bind(
          paymentId,
          reference,
          steamId,
          userId,
          planId,
          amountPaid,
          currency,
          invoiceId,
          paymentIntentId,
          subscriptionId,
          now,
          now,
          now
        ).run();

        const paymentRow = await env.SUBSCRIPTION_DB.prepare(
          `SELECT id FROM payments WHERE stripe_invoice_id = ? OR checkout_reference = ? LIMIT 1`
        ).bind(invoiceId, reference).first<{ id: string }>();
        const stripeStatus = subInfo.status;
        const isPremium = stripeSubscriptionIsPremium(stripeStatus);

        await upsertSubscription(env, {
          userId,
          steamId,
          planId,
          status: isPremium ? "active" : "expired",
          currentPeriodStart: stripePeriodDate(subInfo.current_period_start, now),
          currentPeriodEnd: stripePeriodDate(subInfo.current_period_end, now),
          lastPaymentId: paymentRow?.id || null,
          stripeCustomerId: typeof subInfo.customer === "string" ? subInfo.customer : null,
          stripeSubscriptionId: subscriptionId,
          stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
          cancelAtPeriodEnd: Boolean(subInfo.cancel_at_period_end),
        });

        if (userId) {
          await syncPremiumRoleForUser(env, userId, isPremium).catch((error) => {
            console.warn("Discord Premium role sync failed on paid invoice hook", error);
          });
        }
      }
    }
  } else if (eventType === "invoice.payment_failed") {
    const subscriptionId = data.subscription;
    const invoiceId = typeof data.id === "string" ? data.id : null;
    const paymentIntentId = typeof data.payment_intent === "string" ? data.payment_intent : null;
    const amountDue = typeof data.amount_due === "number"
      ? data.amount_due
      : typeof data.amount_remaining === "number"
        ? data.amount_remaining
        : 0;
    const currency = data.currency?.toUpperCase() || "BRL";
    const now = nowIso();

    if (typeof subscriptionId === "string") {
      const subRow = await env.SUBSCRIPTION_DB.prepare(
        `SELECT user_id, steam_id, plan_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
      ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null; plan_id: PlanId }>();

      if (subRow) {
        if (invoiceId) {
          await env.SUBSCRIPTION_DB.prepare(
            `INSERT OR IGNORE INTO payments (
               id, checkout_reference, steam_id, user_id, plan_id, amount_cents, currency,
               status, stripe_invoice_id, stripe_payment_intent_id, stripe_subscription_id, provider, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, 'stripe', ?, ?)`
          ).bind(
            crypto.randomUUID(),
            `stripe-invoice-${invoiceId}`,
            subRow.steam_id,
            subRow.user_id,
            subRow.plan_id || "monthly",
            amountDue,
            currency,
            invoiceId,
            paymentIntentId,
            subscriptionId,
            now,
            now
          ).run();
        }

        try {
          const subInfo = await stripeRequest(env, `/subscriptions/${subscriptionId}`);
          const status = subInfo.status;
          const isPremium = stripeSubscriptionIsPremium(status);
          if (!isPremium) {
            if (subRow.user_id) {
              await env.SUBSCRIPTION_DB.prepare(
                `UPDATE subscriptions SET status = 'expired', stripe_subscription_status = ?, updated_at = ? WHERE user_id = ?`
              ).bind(status, now, subRow.user_id).run();

              await syncPremiumRoleForUser(env, subRow.user_id, false).catch((error) => {
                console.warn("Discord Premium role revoke failed on failed invoice hook", error);
              });
            } else if (subRow.steam_id) {
              await env.SUBSCRIPTION_DB.prepare(
                `UPDATE subscriptions SET status = 'expired', stripe_subscription_status = ?, updated_at = ? WHERE steam_id = ? AND user_id IS NULL`
              ).bind(status, now, subRow.steam_id).run();
            }
          }
        } catch (err) {
          console.error("Failed to query stripe subscription in invoice.payment_failed", err);
        }
      }
    }
  }

  return jsonResponse({ ok: true }, env);
}

async function handleReturn(env: Env) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GhostBox Premium</title></head><body><p>Processando pagamento via Stripe. Você já pode voltar ao GhostBox.</p><script>setTimeout(() => window.close(), 1500)</script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      },
    }
  );
}

// ---- Account auth: register / login / password reset / verification ----

function accountResponsePayload(account: AccountRow, token: string, firebaseRefreshToken: string) {
  return { token, firebaseRefreshToken, account: publicAccount(account) };
}

async function handleRegister(request: Request, env: Env) {
  const ip = clientIp(request);
  if (await tooManyAuthAttempts(env, ip, "register", 8, 3600)) {
    return jsonResponse({ error: "too_many_attempts" }, env, 429);
  }

  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  const username = normalizeUsername(body?.username);
  const password = body?.password;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 60) : null;

  // Form-validation failures deliberately do NOT count against the rate
  // limit: a user fumbling the signup form (short password, taken username)
  // would otherwise lock themselves out for an hour. Only attempts that
  // actually reach Firebase are counted.
  if (!email) return jsonResponse({ error: "invalid_email" }, env, 400);
  if (!username) return jsonResponse({ error: "invalid_username" }, env, 400);
  if (!validPassword(password)) return jsonResponse({ error: "weak_password" }, env, 400);

  const existingUsername = await getAccountByUsername(env, username);
  if (existingUsername) return jsonResponse({ error: "username_taken" }, env, 409);
  const existingEmail = await getAccountByEmail(env, email);
  if (existingEmail) return jsonResponse({ error: "email_already_registered" }, env, 409);

  await recordAuthAttempt(env, ip, "register");

  let firebaseSession;
  try {
    firebaseSession = await firebaseSignUp(env, email, password);
  } catch (error) {
    const mapped = mapFirebaseError(error);
    // EMAIL_EXISTS with no accounts row (checked above) means a previous
    // signup created the Firebase credential and then failed to write D1 —
    // and its rollback delete failed too. That account is otherwise
    // unreachable forever: login 404s and signup 409s. Adopt it here, but
    // only for whoever can produce the password.
    if (mapped.code === "email_already_registered") {
      const recovered = await firebaseSignIn(env, email, password).catch(() => null);
      if (!recovered) {
        return jsonResponse({ error: "email_already_registered" }, env, 409);
      }
      const strayAccount = await getAccountByUserId(env, recovered.localId);
      if (strayAccount) {
        return jsonResponse({ error: "email_already_registered" }, env, 409);
      }
      console.warn("Register: adopting orphaned Firebase credential", { userId: recovered.localId });
      firebaseSession = recovered;
    } else {
      return jsonResponse({ error: mapped.code }, env, mapped.status === 500 ? 500 : 400);
    }
  }

  try {
    await insertAccount(env, {
      userId: firebaseSession.localId,
      email,
      username,
      displayName: displayName || username,
    });
  } catch (error) {
    // Username/email race lost to a concurrent request: undo the Firebase signup.
    await firebaseDeleteAccount(env, firebaseSession.idToken).catch(() => undefined);
    console.warn("Register: account insert failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ error: "username_taken" }, env, 409);
  }

  await firebaseSendEmailVerification(env, firebaseSession.idToken).catch((error) => {
    console.warn("Register: verification email failed", { userId: firebaseSession.localId, error: error instanceof Error ? error.message : String(error) });
  });

  const token = await signCloudToken(env, {
    userId: firebaseSession.localId,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  const account = await getAccountByUserId(env, firebaseSession.localId);
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 500);

  return jsonResponse(accountResponsePayload(account, token, firebaseSession.refreshToken), env, 201);
}

async function handleLogin(request: Request, env: Env) {
  const ip = clientIp(request);
  if (await tooManyAuthAttempts(env, ip, "login", 15, 900)) {
    return jsonResponse({ error: "too_many_attempts" }, env, 429);
  }

  const body = await readJson(request);
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = body?.password;
  if (!identifier || !validPassword(password)) {
    return jsonResponse({ error: "invalid_credentials" }, env, 400);
  }

  // Counted from here on: a wrong password or an unknown user is exactly the
  // brute-force pattern the limit exists for, so both must burn quota.
  await recordAuthAttempt(env, ip, "login");

  let email = normalizeEmail(identifier);
  if (!email) {
    const username = normalizeUsername(identifier);
    const account = username ? await getAccountByUsername(env, username) : null;
    if (!account) return jsonResponse({ error: "invalid_credentials" }, env, 401);
    email = account.email;
  }

  let firebaseSession;
  try {
    firebaseSession = await firebaseSignIn(env, email, password);
  } catch (error) {
    const mapped = mapFirebaseError(error);
    return jsonResponse({ error: mapped.code }, env, mapped.status === 500 ? 500 : 401);
  }

  const lookup = await firebaseLookup(env, firebaseSession.idToken).catch(() => null);
  if (lookup) {
    await touchAccountVerified(env, firebaseSession.localId, lookup.emailVerified);
  }

  const token = await signCloudToken(env, {
    userId: firebaseSession.localId,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  const account = await getAccountByUserId(env, firebaseSession.localId);
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 404);

  return jsonResponse(accountResponsePayload(account, token, firebaseSession.refreshToken), env);
}

async function handlePasswordReset(request: Request, env: Env) {
  const ip = clientIp(request);
  if (await tooManyAuthAttempts(env, ip, "password_reset", 8, 3600)) {
    return jsonResponse({ ok: true }, env);
  }
  await recordAuthAttempt(env, ip, "password_reset");

  const body = await readJson(request);
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";

  let email = normalizeEmail(identifier);
  if (!email) {
    const username = normalizeUsername(identifier);
    const account = username ? await getAccountByUsername(env, username) : null;
    email = account?.email || null;
  }

  if (email) {
    await firebaseSendPasswordReset(env, email).catch((error) => {
      console.warn("Password reset email failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  // Always 200: never reveal whether the identifier matched an account.
  return jsonResponse({ ok: true }, env);
}

async function handleResendVerification(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const refreshToken = typeof body?.firebaseRefreshToken === "string" ? body.firebaseRefreshToken : "";
  if (!refreshToken) return jsonResponse({ error: "missing_refresh_token" }, env, 400);

  let exchanged;
  try {
    exchanged = await firebaseExchangeRefreshToken(env, refreshToken);
  } catch {
    return jsonResponse({ error: "session_expired" }, env, 401);
  }
  if (exchanged.userId !== auth.session!.userId) {
    return jsonResponse({ error: "session_mismatch" }, env, 401);
  }

  const lookup = await firebaseLookup(env, exchanged.idToken);
  await touchAccountVerified(env, auth.session!.userId, lookup.emailVerified);

  if (!lookup.emailVerified) {
    await firebaseSendEmailVerification(env, exchanged.idToken).catch((error) => {
      console.warn("Resend verification failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }

  return jsonResponse({ ok: true, emailVerified: lookup.emailVerified, firebaseRefreshToken: exchanged.refreshToken }, env);
}

async function handleChangePassword(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (!validPassword(currentPassword) || !validPassword(newPassword)) {
    return jsonResponse({ error: "weak_password" }, env, 400);
  }

  const account = await getAccountByUserId(env, auth.session!.userId);
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 404);

  let reauth;
  try {
    reauth = await firebaseSignIn(env, account.email, currentPassword);
  } catch {
    return jsonResponse({ error: "invalid_credentials" }, env, 401);
  }

  try {
    await firebaseUpdatePassword(env, reauth.idToken, newPassword);
  } catch (error) {
    const mapped = mapFirebaseError(error);
    return jsonResponse({ error: mapped.code }, env, 400);
  }

  return jsonResponse({ ok: true }, env);
}

async function handleMe(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  const account = await getAccountByUserId(env, userId);
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 404);

  const [subscription, connections] = await Promise.all([
    getSubscription(env, userId),
    env.SUBSCRIPTION_DB.prepare(
      `SELECT provider, provider_id, metadata_json, linked_at FROM user_connections WHERE user_id = ?`
    ).bind(userId).all<UserConnectionRow>(),
  ]);

  return jsonResponse({
    account: publicAccount(account),
    subscription: publicSubscription(subscription),
    connections: (connections.results || []).map((row) => ({
      provider: row.provider,
      providerId: row.provider_id,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      linkedAt: row.linked_at,
    })),
  }, env);
}

// Every table that carries both a steam_id and a user_id. Claiming a Steam
// account backfills user_id across them; disconnecting clears steam_id back
// out, so a stale Steam id never outlives the connection that produced it.
const STEAM_LINKED_TABLES = [
  "subscriptions",
  "payments",
  "discord_links",
  "cloud_saves",
  "user_profile_cloud",
  "user_collections_cloud",
  "user_collection_games_cloud",
  "user_favorite_games_cloud",
];

async function handleClaimSteam(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  const body = await readJson(request);
  const callbackUrl = typeof body?.callbackUrl === "string" ? body.callbackUrl : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const avatarUrl = typeof body?.avatarUrl === "string" ? body.avatarUrl.trim() : "";

  const steamId = await validateSteamOpenId(callbackUrl);
  if (!steamId) return jsonResponse({ error: "invalid_steam_login" }, env, 401);

  const existingLink = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id FROM user_connections WHERE provider = 'steam' AND provider_id = ? LIMIT 1`
  ).bind(steamId).first<{ user_id: string }>();

  if (existingLink && existingLink.user_id !== userId) {
    return jsonResponse({ error: "steam_already_linked" }, env, 409);
  }

  await ensureUser(env, steamId);

  if (!existingLink) {
    const now = nowIso();
    await env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_connections (user_id, provider, provider_id, metadata_json, linked_at)
       VALUES (?, 'steam', ?, ?, ?)`
    ).bind(userId, steamId, JSON.stringify({ displayName: displayName || null, avatarUrl: avatarUrl || null }), now).run();

    for (const table of STEAM_LINKED_TABLES) {
      try {
        await env.SUBSCRIPTION_DB.prepare(
          `UPDATE ${table} SET user_id = ? WHERE steam_id = ? AND user_id IS NULL`
        ).bind(userId, steamId).run();
      } catch (error) {
        // A UNIQUE(user_id) collision means this account already has its own
        // row in that table; keep the account's row and leave the legacy one
        // orphaned rather than failing the whole claim.
        console.warn("Claim: failed to migrate table", { table, steamId, userId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const claimedDiscord = await getDiscordLink(env, userId);
    if (claimedDiscord) {
      await env.SUBSCRIPTION_DB.prepare(
        `INSERT INTO user_connections (user_id, provider, provider_id, metadata_json, linked_at)
         VALUES (?, 'discord', ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET
           provider_id = excluded.provider_id,
           metadata_json = excluded.metadata_json`
      ).bind(
        userId,
        claimedDiscord.discord_user_id,
        JSON.stringify({ username: claimedDiscord.discord_username, globalName: claimedDiscord.discord_global_name }),
        claimedDiscord.linked_at
      ).run();
    }

    const claimedSubscription = await getSubscription(env, userId);
    const stripeCustomerId = claimedSubscription?.stripe_customer_id?.trim();
    if (stripeCustomerId && env.STRIPE_SECRET_KEY?.trim()) {
      const params = new URLSearchParams();
      params.set("metadata[user_id]", userId);
      params.set("metadata[steam_id]", steamId);
      await stripeRequest(env, `/customers/${encodeURIComponent(stripeCustomerId)}`, { method: "POST", body: params }).catch((error) => {
        console.warn("Claim: failed to update Stripe customer metadata", { stripeCustomerId, error: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  return jsonResponse({ steamId, claimed: true }, env);
}

async function handleDisconnectProvider(request: Request, env: Env, provider: "steam" | "discord") {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  if (provider === "discord") {
    // Order matters: the role revoke reads discord_links, so it has to run
    // before the row goes away. Dropping the row is what actually unlinks —
    // leaving it behind keeps the cron granting Premium roles to an account
    // that shows "disconnected", and its UNIQUE(discord_user_id) blocks the
    // same Discord account from ever linking anywhere else.
    await syncPremiumRoleForUser(env, userId, false).catch((error) => {
      console.warn("Discord Premium role revoke failed on disconnect", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await env.SUBSCRIPTION_DB.prepare(`DELETE FROM discord_links WHERE user_id = ?`).bind(userId).run();
  }

  if (provider === "steam") {
    // Deleting the connection row alone left the old steam_id stamped across
    // the account's rows, so the account kept claiming a Steam id it was no
    // longer linked to. Rows stay with the account (keyed by user_id); only
    // the Steam stamp goes.
    for (const table of STEAM_LINKED_TABLES) {
      try {
        await env.SUBSCRIPTION_DB.prepare(
          `UPDATE ${table} SET steam_id = NULL WHERE user_id = ?`
        ).bind(userId).run();
      } catch (error) {
        console.warn("Disconnect: failed to clear steam_id", {
          table,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await env.SUBSCRIPTION_DB.prepare(
    `DELETE FROM user_connections WHERE user_id = ? AND provider = ?`
  ).bind(userId, provider).run();
  return jsonResponse({ ok: true }, env);
}

async function route(request: Request, env: Env, context: ExecutionContext) {
  if (request.method === "OPTIONS") return jsonResponse({}, env);

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "ghostbox-subscriptions" }, env);
  }

  if (request.method === "POST" && url.pathname === "/auth/register") return handleRegister(request, env);
  if (request.method === "POST" && url.pathname === "/auth/login") return handleLogin(request, env);
  if (request.method === "POST" && url.pathname === "/auth/password-reset") return handlePasswordReset(request, env);
  if (request.method === "POST" && url.pathname === "/auth/resend-verification") return handleResendVerification(request, env);
  if (request.method === "POST" && url.pathname === "/auth/change-password") return handleChangePassword(request, env);
  if (request.method === "GET" && url.pathname === "/auth/me") return handleMe(request, env);
  if (request.method === "POST" && url.pathname === "/auth/claim-steam") return handleClaimSteam(request, env);
  if (request.method === "DELETE" && url.pathname === "/auth/connections/steam") return handleDisconnectProvider(request, env, "steam");
  if (request.method === "DELETE" && url.pathname === "/auth/connections/discord") return handleDisconnectProvider(request, env, "discord");

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
  const cloudSaveMatch = url.pathname.match(/^\/cloud-saves\/([^/]+)$/);
  const cloudSavePinnedMatch = url.pathname.match(/^\/cloud-saves\/([^/]+)\/pinned$/);
  if (request.method === "PATCH" && cloudSavePinnedMatch) {
    return handleCloudSavePinnedUpdate(request, env, cloudSavePinnedMatch[1]);
  }
  if (request.method === "DELETE" && cloudSaveMatch) {
    return handleCloudSaveDelete(request, env, cloudSaveMatch[1]);
  }
  if (request.method === "GET" && url.pathname === "/cloud-profile") {
    return handleCloudProfileGet(request, env);
  }
  if (request.method === "PUT" && url.pathname === "/cloud-profile") {
    return handleCloudProfilePut(request, env);
  }
  if (request.method === "POST" && url.pathname === "/cloud-profile/avatar") {
    return handleCloudProfileImageUpload(request, env, "avatar");
  }
  if (request.method === "POST" && url.pathname === "/cloud-profile/banner") {
    return handleCloudProfileImageUpload(request, env, "banner");
  }
  if (request.method === "DELETE" && url.pathname === "/cloud-profile/banner") {
    return handleCloudProfileImageDelete(request, env);
  }
  if (request.method === "POST" && url.pathname === "/subscription/checkouts") {
    return handleCreateCheckout(request, env);
  }
  if (request.method === "POST" && url.pathname === "/subscription/portal") {
    return handleCreateBillingPortal(request, env);
  }
  if (request.method === "GET" && url.pathname === "/subscription/status") {
    return handleStatus(request, env);
  }
  if (request.method === "GET" && url.pathname === "/discord/link-status") {
    return handleDiscordLinkStatus(request, env, context);
  }
  if (request.method === "POST" && url.pathname === "/discord/link") {
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
  if (request.method === "GET" && url.pathname === "/subscription/return") {
    return handleReturn(env);
  }
  if (request.method === "POST" && url.pathname === "/stripe/webhook") {
    return handleStripeWebhook(request, env, context);
  }

  return jsonResponse({ error: "Not found" }, env, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    try {
      return await route(request, env, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      console.error("Unhandled worker error", { url: request.url, message, stack: error instanceof Error ? error.stack : undefined });
      return jsonResponse({ error: message }, env, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, _context: ExecutionContext) {
    await syncDiscordPremiumRoles(env);
  },
};
