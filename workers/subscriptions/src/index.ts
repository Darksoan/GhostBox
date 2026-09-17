import {
  bumpTokenVersion,
  clientIp,
  getAccountByUserId,
  getAccountByUsername,
  newUserId,
  normalizeEmail,
  publicAccount,
  recordAuthAttempt,
  suggestUsername,
  tooManyAuthAttempts,
  type AccountRow,
} from "./auth";
import { base64Url, base64UrlDecode, hmacSha256, sha256Hex, timingSafeEqual } from "./crypto";
import {
  buildCloudProfilePayloads,
  diffCloudProfileSnapshots,
  normalizeIncomingSnapshot,
  storedRowsToNormalizedSnapshot,
} from "./cloudProfile";
import {
  STRIPE_API_VERSION,
  planIdFromStripe,
  stripeInvoiceSubscriptionId,
  stripeMetadataString,
  stripeSubscriptionIsPremium,
  stripeSubscriptionPeriod,
  verifyStripeWebhookSignature,
  type PlanId,
} from "./stripe";

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
  OAUTH_REDIRECT_URI?: string;
  ALLOWED_ORIGIN?: string;
  CLOUD_SESSION_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLOUD_SAVE_BUCKET?: string;
  PROFILE_IMAGE_BUCKET?: string;
  STRIPE_API_VERSION?: string;
};

/** Shown at signup and in the terms: the provider account IS the key. */
const PROVIDER_AUTH_DISCLAIMER =
  "A conta GhostBox é acessada exclusivamente pelo Discord ou pela Steam vinculados. " +
  "Proteja essas contas e seus métodos de recuperação. A GhostBox não se responsabiliza por acessos " +
  "decorrentes do comprometimento da sua conta no provedor, exceto quando resultarem de falha de " +
  "segurança ou tratamento inadequado de dados pela própria GhostBox.";

type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";
type SubscriptionStatus = "free" | "active" | "expired";
type SubscriptionAccessType = "stripe" | "lifetime";

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
  stripe_event_created?: number | null;
  stripe_payment_method_json?: string | null;
  stripe_payment_method_updated_at?: string | null;
  access_type?: SubscriptionAccessType | null;
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
  /** Seconds since epoch when this token was minted. Linking a second
   * provider, unlinking, merging or deleting the account requires a *recent*
   * session, so a stolen long-lived token alone cannot rewire who can get
   * in. Tokens minted before this claim existed carry none and are treated
   * as not-recent. */
  iat?: number;
  /** The account's `token_version` when this token was signed. `requireSession`
   * rejects the token once the account moves past it, which is how linking,
   * unlinking or merging signs every other device out.
   *
   * Optional because tokens minted before migration 0016 carry no version at
   * all; those are read as 1 so the deploy signs nobody out. */
  v?: number;
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
  hidden_game_ids: string | null;
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
  hiddenProfileGameIds?: unknown;
  userCollections?: unknown;
};

const CLOUD_PROFILE_SCHEMA_VERSION = 1;
const MAX_CLOUD_PROFILE_URL_LENGTH = 2048;
const MAX_CLOUD_PROFILE_PAYLOAD_BYTES = 256 * 1024;
const MAX_CLOUD_COLLECTION_NAME_LENGTH = 64;
const MAX_CLOUD_COLLECTIONS = 100;
const MAX_CLOUD_GAMES_PER_COLLECTION = 2000;
const MAX_CLOUD_FAVORITES = 5000;
const MAX_CLOUD_HIDDEN_PROFILE_GAMES = 5000;

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
  avatar?: string | null;
  email?: string | null;
  verified?: boolean;
};

/** Providers that sign a user in through the browser hand-off. Steam is not
 * one of them: it accepts an arbitrary `return_to`, so the desktop app takes
 * its callback directly on the loopback port and never needs a ticket. */
type OAuthProvider = "discord";
type ProviderName = OAuthProvider | "steam";

function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === "discord";
}

/** What a provider told us about the person who just authorised. Normalised at
 * the edge so nothing downstream has to care that it came from Discord's
 * `/users/@me`. */
type ProviderIdentity = {
  provider: ProviderName;
  /** The provider's stable id — Discord's snowflake, never the email, which
   * can be reassigned by whoever controls the address' domain. */
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
};

/** See migration 0017: the columns keep their `discord_` names, but hold
 * whatever `provider` says they hold. */
type DiscordLoginTicketRow = {
  ticket_hash: string;
  user_id: string | null;
  provider: string;
  purpose: string;
  app_nonce: string | null;
  discord_user_id: string;
  discord_username: string | null;
  discord_global_name: string | null;
  discord_avatar_url: string | null;
  discord_email: string | null;
  discord_email_verified: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type DiscordVerificationCodeRow = {
  user_id: string;
  code_hash: string;
  discord_user_id: string;
  attempts: number;
  expires_at: string;
  created_at: string;
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

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Billing period pulled off a Stripe subscription, or a hard failure.
 *
 * A missing period used to fall back to "now", which stored a subscription
 * that `isActiveSubscription` rejects immediately — the user paid and got
 * nothing, silently. Throwing instead surfaces it: inside the webhook it
 * becomes a 500 and Stripe retries the event.
 */
function requireStripePeriod(subscription: unknown) {
  const period = stripeSubscriptionPeriod(subscription);
  if (!period.end) throw new Error("stripe_period_unresolved");
  return { start: period.start || nowIso(), end: period.end };
}

function validSteamId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/**
 * No fallback, deliberately. This used to fall back to the Discord OAuth
 * secrets, which quietly made the key that forges any user's session the same
 * key GhostBox hands to Discord — one leak, both broken. It is also the key
 * that has to be rotatable on its own: rotating it is the only way to sign
 * every session out at once.
 */
function getCloudSessionSecret(env: Env) {
  return env.CLOUD_SESSION_SECRET;
}

const CLOUD_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Tokens predating migration 0016 carry no version; they count as the initial
 * one so the deploy does not sign their owners out. */
function sessionVersion(session: CloudSession) {
  return session.v ?? 1;
}

/** The one place a session token is minted, so the account's current
 * `token_version` can never be left off by accident. */
async function issueSessionToken(env: Env, account: AccountRow) {
  return signCloudToken(env, {
    userId: account.user_id,
    exp: Math.floor(Date.now() / 1000) + CLOUD_SESSION_TTL_SECONDS,
    iat: Math.floor(Date.now() / 1000),
    v: account.token_version ?? 1,
  });
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

/** One redirect URI for every provider. Discord only redirects to a URI
 * registered up front, so the desktop app cannot receive the callback on its
 * random loopback port — it lands here and gets bounced onward.
 *
 * `DISCORD_REDIRECT_URI` is still honoured for the Discord flow so existing
 * deployments keep working without touching the Discord app config. */
function getOAuthRedirectUri(env: Env, request: Request, provider: OAuthProvider) {
  if (provider === "discord" && env.DISCORD_REDIRECT_URI) return env.DISCORD_REDIRECT_URI;
  return env.OAUTH_REDIRECT_URI || `${new URL(request.url).origin}/oauth/callback`;
}

function getDiscordRedirectUri(env: Env, request: Request) {
  return getOAuthRedirectUri(env, request, "discord");
}

function getDiscordStateSecret(env: Env) {
  return env.DISCORD_OAUTH_STATE_SECRET || env.DISCORD_CLIENT_SECRET;
}

/**
 * - `link` attaches a provider to the already-signed-in account that started
 *   the flow. The session that started it must be recent.
 * - `login` runs before any session exists and carries the desktop app's
 *   loopback port so the callback knows where to hand the result back.
 * - `recover` is a retired purpose kept only so old signed states fail
 *   closed with a clear error instead of matching nothing.
 */
type DiscordStatePurpose = "link" | "login" | "recover";

type DiscordState = {
  purpose: DiscordStatePurpose;
  provider: OAuthProvider;
  userId: string | null;
  port: number | null;
  /** The app's own nonce, echoed back to its loopback listener so it can tell
   * this flow's callback from anything else that reaches the port. */
  appNonce: string | null;
};

/** Anything that would break the dot-delimited state payload. The app's nonce
 * is the only field that comes from outside. */
function validAppNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

async function createDiscordState(env: Env, state: DiscordState) {
  const secret = getDiscordStateSecret(env);
  if (!secret) throw new Error("DISCORD_OAUTH_STATE_SECRET is not configured");

  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = [
    state.purpose,
    state.provider,
    state.userId ?? "",
    state.port ?? "",
    state.appNonce ?? "",
    expiresAt,
    nonce,
  ].join(".");
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

async function verifyDiscordState(env: Env, state: string | null): Promise<DiscordState | null> {
  const secret = getDiscordStateSecret(env);
  if (!secret || !state) return null;

  const parts = state.split(".");
  if (parts.length !== 8) return null;

  const [purpose, providerValue, userIdValue, portValue, appNonce, expiresAtValue, nonce, signature] = parts;
  if (purpose !== "link" && purpose !== "login" && purpose !== "recover") return null;
  if (!isOAuthProvider(providerValue)) return null;
  if (!nonce) return null;

  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const payload = [purpose, providerValue, userIdValue, portValue, appNonce, expiresAtValue, nonce].join(".");
  const expected = await hmacSha256(secret, payload);
  if (!timingSafeEqual(signature, expected)) return null;

  if (purpose === "link") {
    return validUserId(userIdValue)
      ? { purpose, provider: providerValue, userId: userIdValue, port: null, appNonce: null }
      : null;
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  // An empty nonce is the legacy `/auth/discord/start` flow, from app builds
  // that predate the binding. Those are accepted so they keep signing in —
  // they are no more exposed than they already were — but `/auth/oauth/*`
  // refuses to *mint* a state without one, so nothing new lands here unbound.
  if (appNonce && !validAppNonce(appNonce)) return null;
  return { purpose, provider: providerValue, userId: null, port, appNonce: appNonce || null };
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
  const auth = kind === "avatar" ? await requireSession(request, env) : await requirePremiumSession(request, env);
  if (auth.response) return auth.response;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return jsonResponse({ error: "invalid_profile_image_type" }, env, 415);
  }
  const bytes = await request.arrayBuffer();
  // A reamostragem roda no cliente (utils/profileImages → encodeBannerDataUrl:
  // teto de 2560×1440 e alvo de ~1,1 MB em WebP), então o que chega aqui já
  // deveria estar bem abaixo do limite. Este guarda existe pro caso de um
  // cliente adulterado: cada usuário tem um objeto fixo por tipo
  // (`<userId>/avatar.webp`, `<userId>/banner.webp`, sempre sobrescrito), então
  // o teto por requisição é o que limita o custo de armazenamento por conta.
  const maxBytes = 4 * 1024 * 1024;
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

/**
 * Resolves the caller's session, or the 401 to return instead.
 *
 * The account row comes back with it: verifying `token_version` needs it
 * anyway, and nearly every caller used to load the very same row on the next
 * line. Callers that need it should take `auth.account` rather than issue a
 * second `getAccountByUserId`.
 */
async function requireSession(
  request: Request,
  env: Env
): Promise<{ response?: Response; session?: CloudSession; account?: AccountRow | null }> {
  const session = await verifyCloudToken(env, request);
  if (!session) return { response: jsonResponse({ error: "unauthorized" }, env, 401) };

  const account = await getAccountByUserId(env, session.userId);
  if (!account) return { response: jsonResponse({ error: "account_not_found" }, env, 401) };

  // Revocation. A token minted before the account's current version belongs to
  // a device that was signed out — by a provider being linked or unlinked, or
  // by an account merge — and must not be honoured for the rest of its
  // seven days.
  if (sessionVersion(session) < (account.token_version ?? 1)) {
    return { response: jsonResponse({ error: "session_revoked" }, env, 401) };
  }

  // steamId is resolved per request instead of being baked into the token:
  // Steam is linked (and unlinked) long after the token was signed, so a
  // token-embedded value would be stale for up to its 7-day lifetime and
  // would tag new rows with a Steam account the user already disconnected.
  session.steamId = await getLinkedSteamId(env, session.userId);
  return { session, account };
}

async function requirePremiumSession(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return { response: auth.response };
  const subscription = await getSubscription(env, auth.session!.userId);
  if (!isActiveSubscription(subscription)) {
    return { response: jsonResponse({ error: "premium_required" }, env, 402) };
  }
  return { session: auth.session, account: auth.account };
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
      accessType: "free" as const,
      canManageBilling: false,
      planId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      lastPaymentId: null,
      cancelAtPeriodEnd: false,
      updatedAt: null,
    };
  }

  const active = row.status === "active" && !!row.current_period_end && new Date(row.current_period_end).getTime() > Date.now();
  const accessType = row.access_type === "lifetime" ? "lifetime" : "stripe";
  return {
    status: active ? "active" : "expired",
    isPremium: active,
    accessType,
    canManageBilling: active && accessType === "stripe" && Boolean(row.stripe_subscription_id?.trim()),
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

const PAYMENT_METHOD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type PublicPaymentMethod = { type: string | null; brand: string | null; last4: string | null };

/**
 * Card on file, cached in D1.
 *
 * The subscription screen polls /subscription/status every 10 seconds, so
 * asking Stripe on every request would burn rate limit for data that changes
 * only when the user edits their billing details. The cache is cleared by
 * `invalidateCachedPaymentMethod` whenever that can have happened.
 */
async function resolveCachedPaymentMethod(env: Env, subscription: SubscriptionRow | null) {
  if (!subscription) return null;

  const cachedAt = subscription.stripe_payment_method_updated_at
    ? Date.parse(subscription.stripe_payment_method_updated_at)
    : NaN;
  if (Number.isFinite(cachedAt) && Date.now() - cachedAt < PAYMENT_METHOD_CACHE_TTL_MS) {
    if (!subscription.stripe_payment_method_json) return null;
    try {
      return JSON.parse(subscription.stripe_payment_method_json) as PublicPaymentMethod;
    } catch {
      // fall through and re-resolve
    }
  }

  const observedUpdatedAt = subscription.stripe_payment_method_updated_at ?? null;
  const resolved = await resolveStripePaymentMethod(env, subscription);
  const target = subscription.user_id
    ? { column: "user_id", value: subscription.user_id }
    : subscription.steam_id
      ? { column: "steam_id", value: subscription.steam_id }
      : null;
  if (target) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET stripe_payment_method_json = ?, stripe_payment_method_updated_at = ?
       WHERE ${target.column} = ? AND stripe_payment_method_updated_at IS ?`
    ).bind(resolved ? JSON.stringify(resolved) : null, nowIso(), target.value, observedUpdatedAt).run().catch(() => undefined);
  }
  return resolved;
}

async function invalidateCachedPaymentMethod(env: Env, userId?: string | null, steamId?: string | null) {
  const target = userId
    ? { column: "user_id", value: userId }
    : steamId
      ? { column: "steam_id", value: steamId }
      : null;
  if (!target) return;
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE subscriptions SET stripe_payment_method_json = NULL, stripe_payment_method_updated_at = NULL
     WHERE ${target.column} = ? AND (stripe_payment_method_json IS NOT NULL OR stripe_payment_method_updated_at IS NOT NULL)`
  ).bind(target.value).run().catch(() => undefined);
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

type DiscordDmResult = { ok: boolean; blocked: boolean; reason?: string };

/** Sends a bot DM. The bot can only open a DM with someone who shares a guild
 * with it and has not closed DMs from server members — Discord answers 403 in
 * both cases, which the caller surfaces as `discord_dm_blocked` so the UI can
 * tell the user what to change instead of showing a generic failure. */
async function discordDirectMessage(env: Env, discordUserId: string, content: string): Promise<DiscordDmResult> {
  if (!env.DISCORD_BOT_TOKEN) return { ok: false, blocked: false, reason: "Discord bot token is not configured" };

  const headers = {
    authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "content-type": "application/json",
  };

  const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!channelResponse.ok) {
    return { ok: false, blocked: channelResponse.status === 403, reason: `Discord HTTP ${channelResponse.status}` };
  }

  const channel = await channelResponse.json<{ id?: string }>();
  if (!channel.id) return { ok: false, blocked: false, reason: "Discord returned no DM channel" };

  const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!messageResponse.ok) {
    return { ok: false, blocked: messageResponse.status === 403, reason: `Discord HTTP ${messageResponse.status}` };
  }
  return { ok: true, blocked: false };
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

const STEAM_OPENID_NONCE_TTL_SECONDS = 10 * 60;

/** One-shot guard against Steam OpenID assertion replay: the same
 * `openid.response_nonce` is never accepted twice. */
async function consumeSteamNonce(env: Env, nonce: string): Promise<boolean> {
  const now = Date.now();
  const hash = await sha256Hex(`steam-nonce:${nonce}`);
  try {
    await env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO steam_openid_nonces (nonce_hash, created_at, expires_at) VALUES (?, ?, ?)`
    )
      .bind(hash, new Date(now).toISOString(), new Date(now + STEAM_OPENID_NONCE_TTL_SECONDS * 1000).toISOString())
      .run();
    return true;
  } catch {
    // UNIQUE hit: this assertion was already used.
    return false;
  }
}

async function validateSteamOpenId(env: Env, callbackUrl: string, consume = true) {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }

  const params = Array.from(url.searchParams.entries()).filter(([key]) => key.startsWith("openid."));
  const mode = url.searchParams.get("openid.mode");
  if (mode !== "id_res") return null;

  // The assertion must come from Steam itself and describe one consistent id.
  const opEndpoint = url.searchParams.get("openid.op_endpoint") || "";
  if (opEndpoint !== "https://steamcommunity.com/openid/login") return null;
  const claimedId = url.searchParams.get("openid.claimed_id") || "";
  const identity = url.searchParams.get("openid.identity") || "";
  if (!claimedId || claimedId !== identity) return null;
  const steamId = claimedId.split("/openid/id/").pop() || "";
  if (!validSteamId(steamId)) return null;
  if (claimedId !== `https://steamcommunity.com/openid/id/${steamId}`) return null;

  // The app always sets return_to to its own loopback listener. Anything else
  // is an assertion minted for somebody else's flow.
  const returnTo = url.searchParams.get("openid.return_to") || "";
  let returnToUrl: URL;
  try {
    returnToUrl = new URL(returnTo);
  } catch {
    return null;
  }
  if (returnToUrl.protocol !== "http:") return null;
  if (returnToUrl.hostname !== "127.0.0.1" && returnToUrl.hostname !== "localhost") return null;
  if (returnToUrl.pathname !== "/steam/callback") return null;

  // Freshness + single use. Steam signs `response_nonce` as
  // `<timestamp>Z<unique>`; the timestamp bounds the age and the table makes
  // the assertion one-shot even if Steam would still answer `is_valid:true`.
  // The timestamp is matched loosely on purpose: real nonces carry no
  // fractional seconds, but anything starting with a valid UTC instant counts.
  const nonce = url.searchParams.get("openid.response_nonce") || "";
  const nonceInstant = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(nonce)?.[1];
  const nonceTime = nonceInstant ? Date.parse(`${nonceInstant}Z`) : NaN;
  if (!nonce || !Number.isFinite(nonceTime)) return null;
  if (Math.abs(Date.now() - nonceTime) > STEAM_OPENID_NONCE_TTL_SECONDS * 1000) return null;

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
  if (!text.includes("is_valid:true")) return null;

  // Consume the nonce only after Steam confirmed the assertion, so a network
  // failure does not burn an assertion the user can still retry — while a
  // captured assertion can never be traded in twice. Callers that only peek
  // (merge preview, or a login that may yet turn into a signup on the same
  // assertion) pass consume=false; every successful authentication consumes.
  if (consume && !(await consumeSteamNonce(env, nonce))) return null;
  return steamId;
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

async function pruneStaleRecords(env: Env) {
  const now = Date.now();
  const results = await Promise.allSettled([
    // Handled events are kept only long enough to cover Stripe's redelivery
    // window; beyond that they are just an unbounded pile of payloads.
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM webhook_events WHERE processed_at IS NOT NULL AND created_at < ?`
    ).bind(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()).run(),
    // A Stripe checkout session dies after 24h; without this the abandoned
    // payment row keeps the app showing "payment processing" forever.
    env.SUBSCRIPTION_DB.prepare(
      `UPDATE payments SET status = 'expired', updated_at = ?
       WHERE status = 'pending' AND created_at < ?`
    ).bind(nowIso(), new Date(now - 24 * 60 * 60 * 1000).toISOString()).run(),
    // Both are short-lived by design and single-use; nothing reads them back
    // once expired, so they are pure accumulation.
    env.SUBSCRIPTION_DB.prepare(`DELETE FROM discord_login_tickets WHERE expires_at < ?`)
      .bind(nowIso())
      .run(),
    env.SUBSCRIPTION_DB.prepare(`DELETE FROM discord_verification_codes WHERE expires_at < ?`)
      .bind(nowIso())
      .run(),
    // 90 days is long enough to notice a sign-in that was not yours and short
    // enough that this does not become a standing history of when someone uses
    // their computer.
    env.SUBSCRIPTION_DB.prepare(`DELETE FROM security_events WHERE created_at < ?`)
      .bind(new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString())
      .run(),
    // Consumed or not, a Steam assertion is single-use: its nonce row only
    // exists to reject replays inside the 10-minute freshness window.
    env.SUBSCRIPTION_DB.prepare(`DELETE FROM steam_openid_nonces WHERE expires_at < ?`)
      .bind(nowIso())
      .run(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") console.warn("Retention sweep failed", result.reason);
  }
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

/** The credentials and the authorize endpoint for a provider, or `null` when
 * that provider was never configured on this deployment. */
function oauthClient(env: Env, provider: OAuthProvider) {
  if (provider === "discord") {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return null;
    return {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      authorizeEndpoint: "https://discord.com/oauth2/authorize",
      tokenEndpoint: "https://discord.com/api/oauth2/token",
      // `email` pre-fills the account's contact address at signup. It proves
      // nothing by itself and is never used for recovery — the provider
      // account itself is the only way back in.
      scope: "identify email",
    };
  }
  return null;
}

function buildAuthorizeUrl(
  env: Env,
  request: Request,
  provider: OAuthProvider,
  state: string
): string | null {
  const client = oauthClient(env, provider);
  if (!client) return null;

  const url = new URL(client.authorizeEndpoint);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", getOAuthRedirectUri(env, request, provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", client.scope);
  url.searchParams.set("state", state);
  // Forces a fresh authorization on every sign-in instead of silently reusing
  // whatever authorization the browser remembers from a previous session.
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function handleOAuthLinkStart(request: Request, env: Env, provider: OAuthProvider) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;

  const state = await createDiscordState(env, {
    purpose: "link",
    provider,
    userId: auth.session!.userId,
    port: null,
    appNonce: null,
  });
  const url = buildAuthorizeUrl(env, request, provider, state);
  if (!url) return jsonResponse({ error: "oauth_not_configured" }, env, 500);

  // Returned as JSON (not a redirect): the caller opens this URL in the
  // system browser itself, since a browser navigation can't carry our
  // Authorization header the way this authenticated fetch call can.
  return jsonResponse({ url }, env);
}

function handleDiscordLinkStart(request: Request, env: Env) {
  return handleOAuthLinkStart(request, env, "discord");
}

/** Signed-out counterpart of `handleOAuthLinkStart`. Providers only accept a
 * pre-registered redirect_uri, so the desktop app cannot receive the callback
 * directly on its random loopback port — it passes the port here instead and
 * the callback bounces the result back to it. */
async function handleOAuthLoginStart(
  request: Request,
  env: Env,
  provider: OAuthProvider,
  purpose: "login" | "recover"
) {
  const url = new URL(request.url);
  const port = Number(url.searchParams.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return jsonResponse({ error: "invalid_port" }, env, 400);
  }

  // Required, not optional: without it the app's loopback listener has nothing
  // to check a callback against, and any local process could feed it a ticket
  // for someone else's account.
  const appNonce = url.searchParams.get("nonce");
  if (!validAppNonce(appNonce)) return jsonResponse({ error: "invalid_nonce" }, env, 400);

  const state = await createDiscordState(env, { purpose, provider, userId: null, port, appNonce });
  const authorizeUrl = buildAuthorizeUrl(env, request, provider, state);
  if (!authorizeUrl) return jsonResponse({ error: "oauth_not_configured" }, env, 500);

  return jsonResponse({ url: authorizeUrl }, env);
}

/** Legacy shim for app builds that still call `/auth/discord/start` without a
 * nonce. Kept for one release; the flow it starts is the unbound one. */
async function handleDiscordLoginStart(request: Request, env: Env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return jsonResponse({ error: "Discord OAuth is not configured" }, env, 500);
  }

  const port = Number(new URL(request.url).searchParams.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return jsonResponse({ error: "invalid_port" }, env, 400);
  }

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", getDiscordRedirectUri(env, request));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify email");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set(
    "state",
    await createDiscordState(env, {
      purpose: "login",
      provider: "discord",
      userId: null,
      port,
      appNonce: null,
    })
  );

  return jsonResponse({ url: authorizeUrl.toString() }, env);
}

async function exchangeDiscordCode(env: Env, request: Request, code: string) {
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(env, request),
    }),
  });
  const token = await tokenResponse.json<DiscordTokenResponse>();
  if (!tokenResponse.ok || !token.access_token) {
    return { user: null, error: token.error_description || token.error || "Não foi possível validar a autorização do Discord." };
  }

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const user = await userResponse.json<DiscordUserResponse>();
  if (!userResponse.ok || !user.id) {
    return { user: null, error: "Não foi possível ler o usuário autorizado no Discord." };
  }
  return { user, error: null };
}

function discordIdentity(user: DiscordUserResponse): ProviderIdentity {
  const avatarHash = user.avatar?.trim();
  const avatarFormat = avatarHash?.startsWith("a_") ? "gif" : "png";
  return {
    provider: "discord",
    id: user.id!,
    username: user.username ?? null,
    displayName: user.global_name ?? user.username ?? null,
    avatarUrl: avatarHash
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id!)}/${encodeURIComponent(avatarHash)}.${avatarFormat}?size=256`
      : null,
    email: normalizeEmail(user.email),
    emailVerified: user.verified === true,
  };
}

/** Resolves whoever just authorised, whichever provider they used. The
 * provider's access token is read once here and never stored: the account row
 * only ever holds the provider id. */
async function exchangeOAuthCode(
  env: Env,
  request: Request,
  provider: OAuthProvider,
  code: string
): Promise<{ identity: ProviderIdentity | null; error: string | null }> {
  void provider;
  const exchanged = await exchangeDiscordCode(env, request, code);
  if (!exchanged.user) return { identity: null, error: exchanged.error };
  return { identity: discordIdentity(exchanged.user), error: null };
}

const DISCORD_TICKET_TTL_SECONDS = 90;

async function createOAuthLoginTicket(
  env: Env,
  identity: ProviderIdentity,
  userId: string | null,
  options: { purpose: "login" | "recover"; appNonce: string | null }
) {
  const ticket = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO discord_login_tickets (
       ticket_hash, user_id, provider, purpose, app_nonce,
       discord_user_id, discord_username, discord_global_name,
       discord_avatar_url, discord_email, discord_email_verified, expires_at, consumed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  )
    .bind(
      await sha256Hex(ticket),
      userId,
      identity.provider,
      options.purpose,
      options.appNonce,
      identity.id,
      identity.username,
      identity.displayName,
      identity.avatarUrl,
      identity.email,
      identity.emailVerified ? 1 : 0,
      new Date(now + DISCORD_TICKET_TTL_SECONDS * 1000).toISOString(),
      new Date(now).toISOString()
    )
    .run();
  return ticket;
}

async function takeDiscordLoginTicket(env: Env, ticket: unknown) {
  if (typeof ticket !== "string" || !ticket) return null;
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM discord_login_tickets WHERE ticket_hash = ? LIMIT 1`
  )
    .bind(await sha256Hex(ticket))
    .first<DiscordLoginTicketRow>();
  if (!row || row.consumed_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

/** Atomic single-use consume: marks the ticket consumed and returns its row
 * only when it was still fresh and unconsumed. Two concurrent exchanges of
 * the same ticket yield exactly one winner. */
async function consumeDiscordLoginTicketAtomic(env: Env, ticket: unknown) {
  if (typeof ticket !== "string" || !ticket) return null;
  const hash = await sha256Hex(ticket);
  return env.SUBSCRIPTION_DB.prepare(
    `UPDATE discord_login_tickets SET consumed_at = ?
     WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING *`
  )
    .bind(nowIso(), hash, nowIso())
    .first<DiscordLoginTicketRow>();
}

/** Writes both identity representations in one D1 transaction. The unique
 * provider identity constraint is authoritative and prevents stealing even
 * when two link callbacks race. */
async function writeProviderConnection(env: Env, userId: string, identity: ProviderIdentity) {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_connections (user_id, provider, provider_id, metadata_json, linked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         provider_id = excluded.provider_id,
         metadata_json = excluded.metadata_json,
         linked_at = excluded.linked_at`
    ).bind(userId, identity.provider, identity.id, providerMetadata(identity), now),
  ];
  if (identity.provider === "discord") {
    statements.push(env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM discord_links WHERE discord_user_id = ? AND user_id IS NULL`
    ).bind(identity.id), env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO discord_links (
         steam_id, user_id, discord_user_id, discord_username, discord_global_name, linked_at, updated_at
       ) VALUES (NULL, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         discord_user_id = excluded.discord_user_id,
         discord_username = excluded.discord_username,
         discord_global_name = excluded.discord_global_name,
         linked_at = excluded.linked_at,
         updated_at = excluded.updated_at`
    ).bind(userId, identity.id, identity.username, identity.displayName, now, now));
  }
  try {
    await env.SUBSCRIPTION_DB.batch(statements);
  } catch (error) {
    const owner = await getProviderOwner(env, identity);
    if (owner && owner !== userId) throw new ProviderAlreadyLinkedError();
    if (identity.provider === "discord") {
      const legacyOwner = await env.SUBSCRIPTION_DB.prepare(
        `SELECT user_id FROM discord_links WHERE discord_user_id = ? AND user_id <> ? LIMIT 1`
      ).bind(identity.id, userId).first<{ user_id: string }>();
      if (legacyOwner?.user_id) throw new ProviderAlreadyLinkedError();
    }
    throw error;
  }
}

class ProviderAlreadyLinkedError extends Error {}

async function writeDiscordLink(env: Env, userId: string, user: DiscordUserResponse) {
  await writeProviderConnection(env, userId, discordIdentity(user));
}

async function handleDiscordCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const state = await verifyDiscordState(env, url.searchParams.get("state"));
  const code = url.searchParams.get("code");

  if (!state || !code) {
    return htmlResponse("Vínculo não concluído", "A autorização expirou ou foi recusada. Volte ao GhostBox e tente novamente.", 400);
  }
  if (!oauthClient(env, state.provider)) {
    return htmlResponse("Login não configurado", "Este provedor ainda não foi configurado no servidor.", 500);
  }

  if (state.purpose === "login" || state.purpose === "recover") {
    return handleOAuthLoginCallback(request, env, state, code);
  }

  const userId = state.userId!;

  const exchanged = await exchangeDiscordCode(env, request, code);
  if (!exchanged.user) return htmlResponse("Falha no Discord", exchanged.error!, 502);
  const user = exchanged.user;

  // Never steal: a Discord attached to another GhostBox account stays there.
  // Uniting two accounts is the explicit merge flow, which proves both sides.
  const conflictingOwner = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id FROM user_connections WHERE provider = 'discord' AND provider_id = ? AND user_id <> ? LIMIT 1`
  )
    .bind(user.id!, userId)
    .first<{ user_id: string }>();
  if (conflictingOwner?.user_id) {
    return htmlResponse(
      "Discord já vinculado",
      "Esta conta do Discord já está vinculada a outra conta GhostBox. Volte ao app e use a opção de unir contas para juntá-las com confirmação.",
      409
    );
  }

  try {
    await writeDiscordLink(env, userId, user);
  } catch (error) {
    if (error instanceof ProviderAlreadyLinkedError) {
      return htmlResponse("Discord já vinculado", "Esta conta do Discord já está vinculada a outra conta GhostBox.", 409);
    }
    // This callback renders in the user's browser, so the global handler's
    // JSON 500 would be unreadable here.
    console.error("Discord link write failed", { userId, discordUserId: user.id, error: error instanceof Error ? error.message : String(error) });
    return htmlResponse("Vínculo não concluído", "Não foi possível salvar o vínculo com o Discord. Tente novamente pelo GhostBox em instantes.", 500);
  }

  await recordSecurityEvent(env, request, userId, "provider_linked", "discord");

  // Synced in both directions, not only to grant. A Discord that moves from a
  // paying account to a free one used to keep the Premium role until the cron
  // happened to notice — and the cron looks for expired subscriptions, so for
  // a still-active one on an account that no longer holds the Discord it never
  // would.
  const subscription = await getSubscription(env, userId);
  const shouldHaveRole = isActiveSubscription(subscription);
  const roleResult = await syncPremiumRoleForUser(env, userId, shouldHaveRole).catch((error) => {
    console.warn("Discord Premium role sync after link failed", { userId, discordUserId: user.id, error: error instanceof Error ? error.message : String(error) });
    return null;
  });
  const roleSynced = shouldHaveRole && roleResult?.ok === true;

  const linkMessage = roleSynced
    ? "Sua conta Discord foi vinculada ao GhostBox e o cargo Premium foi sincronizado."
    : "Sua conta Discord foi vinculada ao GhostBox. Entre no servidor pelo convite e volte ao app para sincronizar o cargo Premium.";

  return htmlResponse(
    "Discord vinculado",
    `${linkMessage} Você já pode voltar ao app.`
  );
}

/**
 * Signed-out branch of the callback: resolves which GhostBox account owns this
 * provider identity (if any), then bounces a single-use ticket back to the
 * app's loopback listener. The ticket — not the OAuth code, not a session
 * token — is what travels through the browser.
 *
 * The redirect carries the app's own nonce back as `state`. The listener
 * refuses callbacks without it, which is what stops another local process from
 * feeding the app a ticket for an account the user does not own.
 */
async function handleOAuthLoginCallback(request: Request, env: Env, state: DiscordState, code: string) {
  const exchanged = await exchangeOAuthCode(env, request, state.provider, code);
  if (!exchanged.identity) return htmlResponse("Falha no login", exchanged.error!, 502);
  const identity = exchanged.identity;

  const connection = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM user_connections WHERE provider = ? AND provider_id = ? LIMIT 1`
  )
    .bind(identity.provider, identity.id)
    .first<UserConnectionRow>();

  // Provider data changes independently of GhostBox. Refresh it on each
  // successful authorization so `/auth/me` returns the current identity to
  // the sidebar immediately after login.
  if (connection?.user_id) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE user_connections SET metadata_json = ?
       WHERE user_id = ? AND provider = ? AND provider_id = ?`
    )
      .bind(
        JSON.stringify({
          username: identity.username,
          globalName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
          emailVerified: identity.emailVerified,
        }),
        connection.user_id,
        identity.provider,
        identity.id
      )
      .run();

    if (identity.provider === "discord") {
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE discord_links
         SET discord_username = ?, discord_global_name = ?, updated_at = ?
         WHERE user_id = ? AND discord_user_id = ?`
      )
        .bind(identity.username, identity.displayName, nowIso(), connection.user_id, identity.id)
        .run();
    }
  }

  // Recovery only ever proves an account that already exists. Offering signup
  // here would turn "I lost my password" into "here is a brand new account",
  // which is not what the user asked for and hides the failure from them.
  // The password-recovery hand-off no longer exists: there is no password to
  // set. A `recover` state minted by an old app build fails closed here with
  // a readable page instead of a ticket nobody can use.
  if (state.purpose === "recover") {
    return htmlResponse(
      "Recuperação desativada",
      "A recuperação por senha foi desativada junto com o acesso por e-mail/senha. Entre direto pelo Discord ou pela Steam vinculados à sua conta.",
      410
    );
  }

  let ticket: string;
  try {
    ticket = await createOAuthLoginTicket(env, identity, connection?.user_id ?? null, {
      purpose: "login",
      appNonce: state.appNonce,
    });
  } catch (error) {
    console.error("OAuth login ticket write failed", {
      provider: identity.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return htmlResponse("Entrada não concluída", "Não foi possível concluir a entrada. Tente novamente em instantes.", 500);
  }

  // `/discord/callback` on the loopback for a legacy flow that has no nonce,
  // so older app builds keep working; everything else lands on the shared path.
  const path = state.appNonce ? "/oauth/callback" : "/discord/callback";
  const target = new URL(`http://127.0.0.1:${state.port}${path}`);
  target.searchParams.set("ticket", ticket);
  if (state.appNonce) target.searchParams.set("state", state.appNonce);

  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "cache-control": "no-store" },
  });
}

const STRIPE_RETRY_DELAYS_MS = [250, 750];

async function stripeRequest(
  env: Env,
  path: string,
  init: { method?: string; body?: URLSearchParams; idempotencyKey?: string } = {}
): Promise<Record<string, any>> {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const method = init.method || "GET";
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/x-www-form-urlencoded",
    // Pinned rather than inherited from the account: a version bump in the
    // Stripe dashboard would otherwise silently reshape these payloads.
    "stripe-version": env.STRIPE_API_VERSION?.trim() || STRIPE_API_VERSION,
  };
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  // Only replay what is safe to replay: reads, and writes carrying an
  // idempotency key (Stripe returns the original result for those instead of
  // charging or creating twice).
  const retryable = method === "GET" || Boolean(init.idempotencyKey);
  let lastError: Error | null = null;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.stripe.com/v1${path}`, {
        method,
        headers,
        body: init.body,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!retryable || attempt >= STRIPE_RETRY_DELAYS_MS.length) throw lastError;
      await sleep(STRIPE_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    const text = await response.text();
    // Stripe answers 5xx (and some edge proxies answer 429) with HTML, so the
    // body cannot be assumed to be JSON.
    let payload: Record<string, any> = {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") payload = parsed;
    } catch {
      payload = {};
    }

    if (response.ok) return payload;

    const error = payload.error && typeof payload.error === "object" ? payload.error : null;
    const message =
      (typeof error?.message === "string" && error.message) ||
      (typeof payload.message === "string" && payload.message) ||
      `Stripe request failed (${response.status}): ${text.slice(0, 200) || "empty body"}`;
    lastError = new Error(message);

    const transient = response.status === 429 || response.status >= 500;
    if (!transient || !retryable || attempt >= STRIPE_RETRY_DELAYS_MS.length) throw lastError;
    await sleep(STRIPE_RETRY_DELAYS_MS[attempt]);
  }
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

function isStripeMissingResourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /No such (customer|subscription)/i.test(message) || /resource_missing/i.test(message);
}

function stripeCustomerMissingError(): Error {
  const error = new Error("stripe_customer_missing");
  (error as unknown as Record<string, unknown>).code = "stripe_customer_missing";
  return error;
}

function isStripeCustomerMissingError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.message === "stripe_customer_missing") return true;
    const code = (error as unknown as Record<string, unknown>).code;
    if (code === "stripe_customer_missing") return true;
  }
  return false;
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
  const customer = await stripeRequest(env, "/customers", {
    method: "POST",
    body,
    // Derived from the account id, not random: concurrent calls (the status
    // poll, the checkout button and the portal button can all land at once)
    // then resolve to the same Stripe Customer instead of creating duplicates
    // that could each carry their own subscription.
    idempotencyKey: `ghostbox-customer-${userId}`,
  });
  const customerId = typeof customer.id === "string" ? customer.id : null;
  if (!customerId) throw new Error("Stripe did not return a customer id");
  return customerId;
}

async function resolveStripeCustomerId(
  env: Env,
  userId: string,
  subscription: SubscriptionRow | null,
  steamId?: string | null,
  allowCreate = true
) {
  const stored = subscription?.stripe_customer_id?.trim() || null;
  if (stored) {
    try {
      const customer = await stripeRequest(env, `/customers/${encodeURIComponent(stored)}`);
      if (customer && typeof customer === "object" && (customer as Record<string, unknown>).deleted) {
        throw stripeCustomerMissingError();
      }
      return stored;
    } catch (error) {
      if (!isStripeCustomerMissingError(error) && !isStripeMissingResourceError(error)) throw error;
      // The stored id belongs to another Stripe mode (ex.: test id with a live
      // key) or was deleted. Recover the live customer by metadata when there
      // is one; the portal must never mint an empty customer just to open.
      const searched = await findStripeCustomerIdByUser(env, userId).catch(() => null);
      if (searched) {
        await saveStripeCustomerId(env, userId, searched, steamId);
        return searched;
      }
      if (!allowCreate) throw stripeCustomerMissingError();
      // Fall through and create a live customer, overwriting the stale id.
    }
  } else {
    const searched = await findStripeCustomerIdByUser(env, userId).catch(() => null);
    if (searched) {
      await saveStripeCustomerId(env, userId, searched, steamId);
      return searched;
    }
    if (!allowCreate) throw stripeCustomerMissingError();
  }

  const created = await createStripeCustomerForUser(env, userId, steamId);

  // Re-read: a request that raced us may have stored a different id already,
  // and two ids for one account means two billable customers. A stale stored
  // id already proven missing above must not win over the live id just made.
  const current = (await getSubscription(env, userId))?.stripe_customer_id?.trim();
  if (current && current !== created && current !== stored) return current;

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
  if (subscription?.access_type === "lifetime") {
    return jsonResponse({ error: "billing_not_managed" }, env, 409);
  }

  let customerId: string;
  try {
    customerId = await resolveStripeCustomerId(env, userId, subscription, auth.session!.steamId, false);
  } catch (error) {
    if (isStripeCustomerMissingError(error) || isStripeMissingResourceError(error)) {
      return jsonResponse({ error: "stripe_customer_missing" }, env, 409);
    }
    throw error;
  }
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", stripePortalReturnUrl(env, request));
  if (flow === "payment_method_update") {
    params.set("flow_data[type]", "payment_method_update");
  }

  let session: Record<string, any>;
  try {
    session = await stripeRequest(env, "/billing_portal/sessions", {
      method: "POST",
      body: params,
    });
  } catch (error) {
    if (isStripeMissingResourceError(error)) {
      return jsonResponse({ error: "stripe_customer_missing" }, env, 409);
    }
    throw error;
  }
  const url = typeof session.url === "string" ? session.url : null;
  if (!url) {
    return jsonResponse({ error: "Stripe did not return a portal URL." }, env, 502);
  }

  // The portal is where the card gets changed, and Stripe sends no webhook for
  // a payment-method swap on its own — drop the cache so the next status read
  // shows what the user just entered.
  await invalidateCachedPaymentMethod(env, userId, auth.session!.steamId);

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

  // Each attempt costs a Stripe API call and a payments row; cap both per IP
  // and per account so a stuck client cannot spin them up without bound.
  const ip = clientIp(request);
  if (
    (await tooManyAuthAttempts(env, ip, "checkout", 10, 3600)) ||
    (await tooManyAuthAttempts(env, `user:${userId}`, "checkout", 10, 3600))
  ) {
    return jsonResponse({ error: "too_many_attempts" }, env, 429);
  }
  await recordAuthAttempt(env, ip, "checkout");
  await recordAuthAttempt(env, `user:${userId}`, "checkout");

  const plan = plans[planId];
  const subscription = await getSubscription(env, userId);
  const customerId = await resolveStripeCustomerId(env, userId, subscription, steamId);

  // Generated before the Stripe call so it can key the idempotent request.
  const paymentId = crypto.randomUUID();

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
    idempotencyKey: `ghostbox-checkout-${paymentId}`,
  });

  const sessionId = typeof session.id === "string" ? session.id : null;
  const sessionUrl = typeof session.url === "string" ? session.url : null;
  if (!sessionId || !sessionUrl) {
    throw new Error("Stripe did not return a checkout session");
  }

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

  // Only subscribers have a card worth showing, and only they see the panel
  // that renders it.
  const paymentMethod = isActiveSubscription(subscription) && subscription?.access_type !== "lifetime"
    ? await resolveCachedPaymentMethod(env, subscription).catch(() => null)
    : null;

  return jsonResponse({
    userId,
    steamId: auth.session!.steamId || null,
    subscription: publicSubscription(subscription),
    latestPayment: latestPayment ? publicPayment(latestPayment, origin) : null,
    paymentMethod,
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
  return deleteCloudSaveObjects(env, [storagePath]);
}

async function deleteCloudSaveObjects(env: Env, storagePaths: string[]) {
  const storage = requireSupabase(env);
  const response = await fetch(`${storage.url}/storage/v1/object/${encodeURIComponent(storage.bucket)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${storage.key}`,
      apikey: storage.key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: storagePaths }),
  });
  if (!response.ok) throw new Error(`Supabase storage delete failed (${response.status})`);
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
  const hiddenProfileGameIds = Array.isArray(body.hiddenProfileGameIds)
    ? Array.from(
        new Set(
          body.hiddenProfileGameIds
            .map((appId) => (typeof appId === "string" ? appId.trim() : ""))
            .filter(Boolean)
            .slice(0, MAX_CLOUD_HIDDEN_PROFILE_GAMES)
        )
      ).sort()
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
      hiddenProfileGameIds,
      collections,
    },
  };
}

async function loadCloudProfileSnapshot(env: Env, userId: string) {
  const { profile, collections, games, favorites } = await loadCloudProfileRows(
    env.SUBSCRIPTION_DB,
    userId
  );
  const gamesByCollection = new Map<string, string[]>();
  for (const row of games) {
    const list = gamesByCollection.get(row.collection_id) || [];
    list.push(row.game_id);
    gamesByCollection.set(row.collection_id, list);
  }
  const favoriteGameIds = favorites.map((row) => row.game_id);

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
    hiddenProfileGameIds: (() => {
      try {
        const parsed = JSON.parse(profile?.hidden_game_ids || "[]");
        return Array.isArray(parsed)
          ? parsed.filter((appId): appId is string => typeof appId === "string")
          : [];
      } catch {
        return [];
      }
    })(),
    userCollections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      gameIds: gamesByCollection.get(collection.id) || [],
    })),
  };
}

async function loadCloudProfileRows(database: D1Database, userId: string) {
  const [profileResult, collectionsResult, gamesResult, favoritesResult] = await database.batch([
    database.prepare(`SELECT * FROM user_profile_cloud WHERE user_id = ? LIMIT 1`).bind(userId),
    database.prepare(
      `SELECT * FROM user_collections_cloud WHERE user_id = ? ORDER BY sort_order ASC, name ASC`
    ).bind(userId),
    database.prepare(
      `SELECT * FROM user_collection_games_cloud WHERE user_id = ? ORDER BY sort_order ASC`
    ).bind(userId),
    database.prepare(
      `SELECT game_id FROM user_favorite_games_cloud WHERE user_id = ? ORDER BY sort_order ASC`
    ).bind(userId),
  ]);
  return {
    profile: (profileResult.results?.[0] as UserProfileCloudRow | undefined) || null,
    collections: (collectionsResult.results || []) as UserCollectionCloudRow[],
    games: (gamesResult.results || []) as UserCollectionGameCloudRow[],
    favorites: (favoritesResult.results || []) as UserFavoriteGameCloudRow[],
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
  const incoming = normalizeIncomingSnapshot(snapshot);

  const currentRows = await loadCloudProfileRows(env.SUBSCRIPTION_DB, userId);
  const hasCurrentSnapshot = Boolean(
    currentRows.profile ||
    currentRows.collections.length ||
    currentRows.games.length ||
    currentRows.favorites.length
  );
  const current = hasCurrentSnapshot
    ? storedRowsToNormalizedSnapshot(
        currentRows.profile,
        currentRows.collections,
        currentRows.games,
        currentRows.favorites
      )
    : null;
  if (!diffCloudProfileSnapshots(current, incoming)) {
    const profile = await loadCloudProfileSnapshot(env, userId);
    return jsonResponse({ profile }, env);
  }

  const payloads = buildCloudProfilePayloads(incoming);
  await env.SUBSCRIPTION_DB.batch([
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_profile_cloud (
         steam_id, user_id, display_name, avatar_url, banner_url,
         banner_position_x, banner_position_y, banner_position_scale,
         hidden_game_ids, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         steam_id = COALESCE(excluded.steam_id, user_profile_cloud.steam_id),
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         banner_url = excluded.banner_url,
         banner_position_x = excluded.banner_position_x,
         banner_position_y = excluded.banner_position_y,
         banner_position_scale = excluded.banner_position_scale,
         hidden_game_ids = excluded.hidden_game_ids,
         updated_at = excluded.updated_at`
    ).bind(
      steamId,
      userId,
      incoming.displayName,
      incoming.avatarUrl,
      incoming.bannerUrl,
      incoming.bannerPosition.x,
      incoming.bannerPosition.y,
      incoming.bannerPosition.scale,
      payloads.hiddenProfileGameIdsJson,
      now
    ),
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_favorite_games_cloud WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE j.value = user_favorite_games_cloud.game_id)`
    ).bind(userId, payloads.favoritesJson),
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_favorite_games_cloud (steam_id, user_id, game_id, sort_order)
       SELECT ?, ?, j.value, CAST(j.key AS INTEGER) FROM json_each(?) j
       WHERE 1
       ON CONFLICT(user_id, game_id) DO UPDATE SET
         sort_order = excluded.sort_order,
         steam_id = COALESCE(excluded.steam_id, user_favorite_games_cloud.steam_id)
       WHERE user_favorite_games_cloud.sort_order IS NOT excluded.sort_order
          OR (excluded.steam_id IS NOT NULL AND user_favorite_games_cloud.steam_id IS NOT excluded.steam_id)`
    ).bind(steamId, userId, payloads.favoritesJson),
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_collection_games_cloud WHERE user_id = ? AND NOT EXISTS (
         SELECT 1 FROM json_each(?) c, json_each(json_extract(c.value, '$.games')) g
         WHERE json_extract(c.value, '$.id') = user_collection_games_cloud.collection_id
           AND g.value = user_collection_games_cloud.game_id
       )`
    ).bind(userId, payloads.collectionsJson),
    env.SUBSCRIPTION_DB.prepare(
      `DELETE FROM user_collections_cloud WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE json_extract(j.value, '$.id') = user_collections_cloud.id)`
    ).bind(userId, payloads.collectionsJson),
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_collections_cloud (id, steam_id, user_id, name, sort_order, updated_at)
       SELECT json_extract(j.value, '$.id'), ?, ?, json_extract(j.value, '$.name'), CAST(json_extract(j.value, '$.o') AS INTEGER), ?
       FROM json_each(?) j
       WHERE 1
       ON CONFLICT(user_id, id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order,
         steam_id = COALESCE(excluded.steam_id, user_collections_cloud.steam_id),
         updated_at = excluded.updated_at
       WHERE user_collections_cloud.name IS NOT excluded.name
          OR user_collections_cloud.sort_order IS NOT excluded.sort_order
          OR (excluded.steam_id IS NOT NULL AND user_collections_cloud.steam_id IS NOT excluded.steam_id)`
    ).bind(steamId, userId, now, payloads.collectionsJson),
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_collection_games_cloud (steam_id, user_id, collection_id, game_id, sort_order)
       SELECT ?, ?, json_extract(c.value, '$.id'), g.value, CAST(g.key AS INTEGER)
       FROM json_each(?) c, json_each(json_extract(c.value, '$.games')) g
       WHERE 1
       ON CONFLICT(user_id, collection_id, game_id) DO UPDATE SET
         sort_order = excluded.sort_order,
         steam_id = COALESCE(excluded.steam_id, user_collection_games_cloud.steam_id)
       WHERE user_collection_games_cloud.sort_order IS NOT excluded.sort_order
          OR (excluded.steam_id IS NOT NULL AND user_collection_games_cloud.steam_id IS NOT excluded.steam_id)`
    ).bind(steamId, userId, payloads.collectionsJson),
  ]);

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
  /** Stripe `event.created`, in seconds. Guards against out-of-order webhooks. */
  eventCreated?: number;
};

async function upsertSubscription(env: Env, input: UpsertSubscriptionInput) {
  const conflictColumn = input.userId ? "user_id" : "steam_id";
  const conflictValue = input.userId || input.steamId;
  if (!conflictValue) return;

  // Accounts created before the Firebase migration own a subscriptions row
  // keyed only by steam_id. Inserting a fresh row for the same steam_id would
  // hit the steam_id PRIMARY KEY, which ON CONFLICT(user_id) does not catch —
  // the whole webhook would throw. Adopt the legacy row first so the upsert
  // below lands on it.
  if (input.userId && input.steamId) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE subscriptions SET user_id = ?, updated_at = ?
       WHERE steam_id = ? AND user_id IS NULL`
    ).bind(input.userId, nowIso(), input.steamId).run();
  }

  const now = nowIso();
  const eventCreated = input.eventCreated ?? nowSeconds();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO subscriptions (
       steam_id, user_id, plan_id, status, current_period_start, current_period_end,
       last_payment_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status,
       cancel_at_period_end, stripe_event_created, access_type, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stripe', ?, ?)
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
       stripe_event_created = excluded.stripe_event_created,
       access_type = 'stripe',
       updated_at = excluded.updated_at
     WHERE COALESCE(subscriptions.stripe_event_created, 0) <= excluded.stripe_event_created`
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
    eventCreated,
    now,
    now
  ).run();
}

/**
 * Marks a subscription expired, but only when the event refers to the
 * subscription currently on record. Someone who cancels and resubscribes has a
 * new stripe_subscription_id; the old subscription's `deleted` event must not
 * revoke the new one. Returns whether a row actually changed.
 */
async function expireSubscription(
  env: Env,
  target: { userId?: string | null; steamId?: string | null },
  stripeSubscriptionId: string | null,
  stripeStatus: string
) {
  const now = nowIso();
  const statement = target.userId
    ? env.SUBSCRIPTION_DB.prepare(
        `UPDATE subscriptions SET status = 'expired', stripe_subscription_status = ?, updated_at = ?
         WHERE user_id = ? AND (stripe_subscription_id = ? OR stripe_subscription_id IS NULL)`
      ).bind(stripeStatus, now, target.userId, stripeSubscriptionId)
    : env.SUBSCRIPTION_DB.prepare(
        `UPDATE subscriptions SET status = 'expired', stripe_subscription_status = ?, updated_at = ?
         WHERE steam_id = ? AND user_id IS NULL AND (stripe_subscription_id = ? OR stripe_subscription_id IS NULL)`
      ).bind(stripeStatus, now, target.steamId, stripeSubscriptionId);

  const result = await statement.run();
  return (result.meta.changes ?? 0) > 0;
}

async function handleRefreshPayment(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = url.origin;

  // This endpoint used to be unauthenticated, so anyone holding a checkout id
  // could read back the owner's userId, steamId, Stripe ids and hosted
  // checkout URL.
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const sessionUserId = auth.session!.userId;

  const checkoutId = url.searchParams.get("checkoutId") || url.searchParams.get("checkoutReference");
  if (!checkoutId) return jsonResponse({ error: "Missing checkoutId" }, env, 400);

  const payment = await getPaymentByCheckout(env, checkoutId);
  // 404 rather than 403 for someone else's payment: a 403 would confirm the
  // checkout id exists.
  if (!payment || payment.user_id !== sessionUserId) {
    return jsonResponse({ error: "Payment not found" }, env, 404);
  }

  const now = nowIso();

  if (payment.stripe_checkout_session_id) {
    const session = await stripeRequest(
      env,
      `/checkout/sessions/${encodeURIComponent(payment.stripe_checkout_session_id)}`
    );
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;

    if (session.payment_status === "paid" && payment.status !== "paid") {
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE payments SET status = 'paid', provider = 'stripe', confirmed_at = ?, updated_at = ?,
           stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
         WHERE id = ?`
      ).bind(now, now, subscriptionId, payment.id).run();

      if (subscriptionId) {
        const subInfo = await stripeRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
        const stripeStatus = subInfo.status;
        const isPremium = stripeSubscriptionIsPremium(stripeStatus);
        const period = stripeSubscriptionPeriod(subInfo);
        if (isPremium && !period.end) {
          return jsonResponse({ error: "stripe_period_unresolved" }, env, 502);
        }

        await upsertSubscription(env, {
          userId: payment.user_id,
          steamId: payment.steam_id,
          planId: payment.plan_id,
          status: isPremium ? "active" : "expired",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          lastPaymentId: payment.id,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
          stripeSubscriptionId: subscriptionId,
          stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
          cancelAtPeriodEnd: Boolean(subInfo.cancel_at_period_end),
        });

        if (payment.user_id) {
          await syncPremiumRole(env, payment.user_id, isPremium);
        }
      }
    }
  }

  const updatedPayment = await getPaymentByCheckout(env, checkoutId);
  const subscription = await getSubscription(env, sessionUserId);

  return jsonResponse({
    payment: updatedPayment ? publicPayment(updatedPayment, origin) : null,
    subscription: publicSubscription(subscription),
  }, env);
}

type StripeEventContext = {
  eventType: string;
  eventCreated: number;
  data: Record<string, any>;
};

/**
 * Discord role sync inside a webhook, made non-fatal.
 *
 * Billing state is the payload that must survive; a Discord outage must not
 * turn a successful payment into a 500 and a retry loop. The 30-minute cron in
 * `syncDiscordPremiumRoles` reconciles whatever this misses.
 */
async function syncPremiumRole(env: Env, userId: string, grant: boolean) {
  try {
    await syncPremiumRoleForUser(env, userId, grant);
  } catch (error) {
    console.warn("Discord Premium role sync failed in webhook", {
      userId,
      grant,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processCheckoutSessionCompleted(env: Env, event: StripeEventContext) {
  const { data, eventCreated } = event;
  const metadataUserId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
  const metadataSteamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;
  const planId = planIdFromStripe(data.metadata?.plan_id);
  const customerId = typeof data.customer === "string" ? data.customer : null;
  const subscriptionId = typeof data.subscription === "string" ? data.subscription : null;
  const sessionId = typeof data.id === "string" ? data.id : null;

  if (!subscriptionId || !sessionId) return;

  // Local ownership is authoritative after an account merge/deletion. Stripe
  // metadata can lag behind, but the checkout row moves or is anonymized.
  const existingPayment = await env.SUBSCRIPTION_DB.prepare(
    `SELECT * FROM payments WHERE stripe_checkout_session_id = ? LIMIT 1`
  ).bind(sessionId).first<PaymentRow>();
  const userId = existingPayment ? existingPayment.user_id : metadataUserId;
  const steamId = existingPayment ? existingPayment.steam_id : metadataSteamId;
  if (!(userId || steamId)) return;

  const subInfo = await stripeRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const stripeStatus = subInfo.status;
  const isPremium = stripeSubscriptionIsPremium(stripeStatus);
  const period = requireStripePeriod(subInfo);
  const now = nowIso();

  // The payments row was left 'pending' by handleCreateCheckout; this is the
  // moment it is actually paid. It used to stay pending until handleStatus
  // lazily reconciled it, so the receipt in the app lagged behind the charge.
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE payments SET status = 'paid', confirmed_at = ?, updated_at = ?,
       stripe_subscription_id = COALESCE(stripe_subscription_id, ?), provider = 'stripe'
     WHERE stripe_checkout_session_id = ? AND status <> 'paid'`
  ).bind(now, now, subscriptionId, sessionId).run();

  const paymentRow = await env.SUBSCRIPTION_DB.prepare(
    `SELECT id FROM payments WHERE stripe_checkout_session_id = ? LIMIT 1`
  ).bind(sessionId).first<{ id: string }>();

  await upsertSubscription(env, {
    userId,
    steamId,
    planId,
    status: isPremium ? "active" : "expired",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    lastPaymentId: paymentRow?.id || null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
    eventCreated,
  });

  if (userId) await syncPremiumRole(env, userId, isPremium);
}

async function processCheckoutSessionExpired(env: Env, event: StripeEventContext) {
  const sessionId = typeof event.data.id === "string" ? event.data.id : null;
  if (!sessionId) return;

  // Without this an abandoned checkout stays 'pending' forever and the app
  // keeps showing "payment processing" on the subscription screen.
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE payments SET status = 'expired', updated_at = ?
     WHERE stripe_checkout_session_id = ? AND status = 'pending'`
  ).bind(nowIso(), sessionId).run();
}

async function processSubscriptionUpserted(env: Env, event: StripeEventContext) {
  const { data, eventCreated } = event;
  const subscriptionId = typeof data.id === "string" ? data.id : null;
  const status = data.status;
  const metadataUserId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
  const metadataSteamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;
  const planId = planIdFromStripe(data.metadata?.plan_id);

  if (!subscriptionId) return;
  const existing = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id, steam_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
  ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null }>();
  const userId = existing ? existing.user_id : metadataUserId;
  const steamId = existing ? existing.steam_id : metadataSteamId;
  if (!(userId || steamId)) return;

  const isPremium = stripeSubscriptionIsPremium(status);
  const period = stripeSubscriptionPeriod(data);
  // An inactive subscription legitimately has no period to record; only an
  // active one must never be stored without knowing when it ends.
  if (isPremium && !period.end) throw new Error("stripe_period_unresolved");

  await upsertSubscription(env, {
    userId,
    steamId,
    planId,
    status: isPremium ? "active" : "expired",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    stripeCustomerId: typeof data.customer === "string" ? data.customer : null,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionStatus: typeof status === "string" ? status : null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    eventCreated,
  });

  if (userId) await syncPremiumRole(env, userId, isPremium);
}

async function processSubscriptionDeleted(env: Env, event: StripeEventContext) {
  const { data } = event;
  const subscriptionId = typeof data.id === "string" ? data.id : null;
  let userId = typeof data.metadata?.user_id === "string" ? data.metadata.user_id : null;
  let steamId = validSteamId(data.metadata?.steam_id) ? data.metadata.steam_id : null;

  if (subscriptionId) {
    const subRow = await env.SUBSCRIPTION_DB.prepare(
      `SELECT user_id, steam_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
    ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null }>();
    if (subRow) {
      userId = subRow.user_id;
      steamId = subRow.steam_id;
    }
  }

  if (!userId && !steamId) return;

  const changed = await expireSubscription(env, { userId, steamId }, subscriptionId, "canceled");
  // No row matched means this event belongs to a superseded subscription — the
  // user already resubscribed and must keep their access.
  if (changed && userId) await syncPremiumRole(env, userId, false);
}

async function processInvoicePaymentSucceeded(env: Env, event: StripeEventContext) {
  const { data, eventCreated } = event;
  const subscriptionId = stripeInvoiceSubscriptionId(data);
  if (!subscriptionId) return;

  const invoiceId = typeof data.id === "string" ? data.id : crypto.randomUUID();
  const paymentIntentId = typeof data.payment_intent === "string" ? data.payment_intent : null;
  const amountPaid = typeof data.amount_paid === "number" ? data.amount_paid : 0;
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "BRL";
  const now = nowIso();

  const existing = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id, steam_id, plan_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
  ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null; plan_id: PlanId }>();

  const subInfo = await stripeRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const userId = existing ? existing.user_id : stripeMetadataString(subInfo, "user_id");
  const steamIdMeta = stripeMetadataString(subInfo, "steam_id");
  const steamId = existing ? existing.steam_id : (validSteamId(steamIdMeta) ? steamIdMeta : null);
  const planId = planIdFromStripe(stripeMetadataString(subInfo, "plan_id"), existing?.plan_id || "monthly");

  if (!userId && !steamId) return;

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
  const period = requireStripePeriod(subInfo);

  await upsertSubscription(env, {
    userId,
    steamId,
    planId,
    status: isPremium ? "active" : "expired",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    lastPaymentId: paymentRow?.id || null,
    stripeCustomerId: typeof subInfo.customer === "string" ? subInfo.customer : null,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionStatus: typeof stripeStatus === "string" ? stripeStatus : null,
    cancelAtPeriodEnd: Boolean(subInfo.cancel_at_period_end),
    eventCreated,
  });

  // A renewal can be paid with a different card than the one on file.
  await invalidateCachedPaymentMethod(env, userId, steamId);

  if (userId) await syncPremiumRole(env, userId, isPremium);
}

async function processInvoicePaymentFailed(env: Env, event: StripeEventContext) {
  const { data } = event;
  const subscriptionId = stripeInvoiceSubscriptionId(data);
  if (!subscriptionId) return;

  const invoiceId = typeof data.id === "string" ? data.id : null;
  const paymentIntentId = typeof data.payment_intent === "string" ? data.payment_intent : null;
  const amountDue = typeof data.amount_due === "number"
    ? data.amount_due
    : typeof data.amount_remaining === "number"
      ? data.amount_remaining
      : 0;
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "BRL";
  const now = nowIso();

  const subRow = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id, steam_id, plan_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1`
  ).bind(subscriptionId).first<{ user_id: string | null; steam_id: string | null; plan_id: PlanId }>();
  if (!subRow) return;

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

  const subInfo = await stripeRequest(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const status = typeof subInfo.status === "string" ? subInfo.status : "unpaid";
  // Stripe retries a failed invoice for days while the subscription stays
  // past_due; only revoke once Stripe itself gives up.
  if (stripeSubscriptionIsPremium(status)) return;

  const changed = await expireSubscription(
    env,
    { userId: subRow.user_id, steamId: subRow.steam_id },
    subscriptionId,
    status
  );
  if (changed && subRow.user_id) await syncPremiumRole(env, subRow.user_id, false);
}

async function processStripeEvent(env: Env, event: StripeEventContext) {
  switch (event.eventType) {
    case "checkout.session.completed":
      return processCheckoutSessionCompleted(env, event);
    case "checkout.session.expired":
      return processCheckoutSessionExpired(env, event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return processSubscriptionUpserted(env, event);
    case "customer.subscription.deleted":
      return processSubscriptionDeleted(env, event);
    case "invoice.payment_succeeded":
      return processInvoicePaymentSucceeded(env, event);
    case "invoice.payment_failed":
      return processInvoicePaymentFailed(env, event);
    default:
      return undefined;
  }
}

async function handleStripeWebhook(request: Request, env: Env) {
  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return jsonResponse({ error: "Stripe webhook secret is not configured" }, env, 500);
  }

  if (!(await verifyStripeWebhookSignature(signature, payload, secret))) {
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
  const eventCreated = typeof event.created === "number" ? event.created : nowSeconds();

  const inserted = await env.SUBSCRIPTION_DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, event_type, stripe_event_created, payload)
     VALUES (?, ?, ?, ?)`
  ).bind(eventId, eventType, eventCreated, payload).run();

  if ((inserted.meta.changes ?? 0) === 0) {
    const seen = await env.SUBSCRIPTION_DB.prepare(
      `SELECT processed_at FROM webhook_events WHERE id = ? LIMIT 1`
    ).bind(eventId).first<{ processed_at: string | null }>();
    // Only a *processed* event is a true duplicate. A row with no processed_at
    // is a previous attempt that failed, and this redelivery is the retry that
    // recovers it — falling through is what keeps a paid checkout from being
    // lost when Stripe or D1 hiccups mid-handler.
    if (seen?.processed_at) {
      return jsonResponse({ ok: true, note: "duplicate" }, env);
    }
  }

  const data = event.data?.object as Record<string, any> | undefined;

  if (eventType && data) {
    try {
      await processStripeEvent(env, { eventType, eventCreated, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Stripe webhook processing failed", { eventId, eventType, message });
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE webhook_events SET attempts = attempts + 1, last_error = ? WHERE id = ?`
      ).bind(message.slice(0, 500), eventId).run().catch(() => undefined);
      // 5xx is the only way to ask Stripe to redeliver.
      return jsonResponse({ error: "webhook_processing_failed" }, env, 500);
    }
  }

  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE webhook_events SET processed_at = ? WHERE id = ?`
  ).bind(nowIso(), eventId).run();

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

// ---- Account auth: provider-only (Discord / Steam) ----
//
// Email/password signup, login, change and recovery were removed, together
// with Firebase. Discord and Steam create accounts directly and are the only
// ways back in. Password-era endpoints below answer 410 so old app builds
// fail with a clear message instead of a confusing 404.

function accountResponsePayload(account: AccountRow, token: string) {
  return { token, account: publicAccount(account), disclaimer: PROVIDER_AUTH_DISCLAIMER };
}

function passwordAuthGone(env: Env) {
  return jsonResponse(
    {
      error: "password_auth_removed",
      message:
        "O acesso por e-mail/senha foi desativado. Entre com Discord ou Steam. " +
        "Se sua conta não tem provedor vinculado, ela não pode mais ser acessada.",
    },
    env,
    410
  );
}

async function handleRegister(request: Request, env: Env) {
  void request;
  return passwordAuthGone(env);
}

async function handleLogin(request: Request, env: Env) {
  void request;
  return passwordAuthGone(env);
}

async function handleChangePassword(request: Request, env: Env) {
  void request;
  return passwordAuthGone(env);
}

async function handleRecoverGone(request: Request, env: Env) {
  void request;
  return passwordAuthGone(env);
}

async function handleVerificationGone(request: Request, env: Env) {
  void request;
  return passwordAuthGone(env);
}

// ---- Account auth: Discord login / signup / DM verification ----

/** Rebuilds the provider identity a ticket was written from, so the signup and
 * link paths do not have to unpack the `discord_`-prefixed columns by hand.
 * See migration 0017 for why those names outlived Discord-only. */
function ticketIdentity(row: DiscordLoginTicketRow): ProviderIdentity {
  return {
    provider: isOAuthProvider(row.provider) ? row.provider : "discord",
    id: row.discord_user_id,
    username: row.discord_username,
    displayName: row.discord_global_name,
    avatarUrl: row.discord_avatar_url,
    email: row.discord_email,
    emailVerified: row.discord_email_verified === 1,
  };
}

async function createProviderAccount(
  env: Env,
  input: { userId: string; username: string; displayName: string | null },
  identity: ProviderIdentity
) {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO accounts (user_id, email, username, display_name, email_verified, verified_via, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`
    ).bind(input.userId, null, input.username, input.displayName, now, now),
  ];
  if (identity.provider === "discord") {
    statements.push(
      env.SUBSCRIPTION_DB.prepare(
        `DELETE FROM discord_links WHERE discord_user_id = ? AND user_id IS NULL`
      ).bind(identity.id),
      env.SUBSCRIPTION_DB.prepare(
        `INSERT INTO discord_links (
           steam_id, user_id, discord_user_id, discord_username, discord_global_name, linked_at, updated_at
         ) VALUES (NULL, ?, ?, ?, ?, ?, ?)`
      ).bind(input.userId, identity.id, identity.username, identity.displayName, now, now)
    );
  }
  statements.push(
    env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO user_connections (user_id, provider, provider_id, metadata_json, linked_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      input.userId,
      identity.provider,
      identity.id,
      JSON.stringify({
        username: identity.username,
        globalName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        email: identity.email,
        emailVerified: identity.emailVerified,
      }),
      now
    )
  );
  await env.SUBSCRIPTION_DB.batch(statements);
}

async function getProviderOwner(env: Env, identity: ProviderIdentity) {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id FROM user_connections WHERE provider = ? AND provider_id = ? LIMIT 1`
  )
    .bind(identity.provider, identity.id)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

function providerMetadata(identity: ProviderIdentity) {
  return JSON.stringify({
    username: identity.username,
    globalName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    email: identity.email,
    emailVerified: identity.emailVerified,
  });
}

/** Refresh provider profile data without changing who owns the identity. */
async function refreshProviderMetadata(env: Env, userId: string, identity: ProviderIdentity) {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    env.SUBSCRIPTION_DB.prepare(
      `UPDATE user_connections SET metadata_json = ?
       WHERE user_id = ? AND provider = ? AND provider_id = ?`
    ).bind(providerMetadata(identity), userId, identity.provider, identity.id),
  ];
  if (identity.provider === "discord") {
    statements.push(
      env.SUBSCRIPTION_DB.prepare(
        `UPDATE discord_links
         SET discord_username = ?, discord_global_name = ?, updated_at = ?
         WHERE user_id = ? AND discord_user_id = ?`
      ).bind(identity.username, identity.displayName, now, userId, identity.id)
    );
  }
  await env.SUBSCRIPTION_DB.batch(statements);
}

function providerUsernameCandidate(base: string, attempt: number) {
  if (attempt === 0) return base;
  const suffix = `_${attempt + 1}`;
  return `${base.slice(0, Math.max(3, 20 - suffix.length))}${suffix}`;
}

/** Resolves an identity against the current mapping and creates an account
 * when it is new. Database uniqueness is the final concurrency guard: if
 * another request wins the provider insert, reread that mapping and sign into
 * the winning account instead of reporting a misleading collision. */
async function getOrCreateProviderAccount(env: Env, identity: ProviderIdentity) {
  const owner = await getProviderOwner(env, identity);
  if (owner) {
    const account = await getAccountByUserId(env, owner);
    if (!account) throw new Error("provider_account_not_found");
    await refreshProviderMetadata(env, owner, identity);
    return { account, isNewAccount: false };
  }

  const base = suggestUsername(identity.displayName || identity.username, `${identity.provider}_user`);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const username = providerUsernameCandidate(base, attempt);
    if (await getAccountByUsername(env, username)) continue;

    const userId = newUserId();
    try {
      await createProviderAccount(env, { userId, username, displayName: identity.displayName || username }, identity);
    } catch (error) {
      const racedOwner = await getProviderOwner(env, identity);
      if (racedOwner) {
        const racedAccount = await getAccountByUserId(env, racedOwner);
        if (!racedAccount) throw new Error("provider_account_not_found");
        await refreshProviderMetadata(env, racedOwner, identity);
        return { account: racedAccount, isNewAccount: false };
      }
      if (await getAccountByUsername(env, username)) continue;
      throw error;
    }

    const account = await getAccountByUserId(env, userId);
    if (!account) throw new Error("provider_account_not_found");
    return { account, isNewAccount: true };
  }

  throw new Error("username_space_exhausted");
}

/** Trades the single-use ticket the OAuth callback dropped on the app's
 * loopback port for a session. The ticket's captured `user_id` is ignored:
 * provider ownership is resolved again at exchange time, so a link or unlink
 * after the callback cannot create a stale login. */
async function handleDiscordExchange(request: Request, env: Env) {
  const body = await readJson(request);
  const ticket = body?.ticket;
  const peeked = await takeDiscordLoginTicket(env, ticket);
  if (!peeked || peeked.purpose === "recover") return jsonResponse({ error: "invalid_ticket" }, env, 400);

  // A recovery ticket is not a login. Recovery through a new password no
  // longer exists — the provider itself is the way back in.
  // The ticket is consumed before account resolution so the same ticket can
  // produce at most one session.

  const consumed = await consumeDiscordLoginTicketAtomic(env, ticket);
  if (!consumed) return jsonResponse({ error: "invalid_ticket" }, env, 400);

  const identity = ticketIdentity(consumed);
  let resolved: { account: AccountRow; isNewAccount: boolean };
  try {
    resolved = await getOrCreateProviderAccount(env, identity);
  } catch (error) {
    console.error("Discord provider account resolution failed", {
      providerId: identity.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "provider_login_failed" }, env, 500);
  }

  const token = await issueSessionToken(env, resolved.account);
  await recordSecurityEvent(
    env,
    request,
    resolved.account.user_id,
    resolved.isNewAccount ? "account_created" : "login",
    identity.provider
  );
  if (resolved.isNewAccount) {
    await recordSecurityEvent(env, request, resolved.account.user_id, "provider_linked", identity.provider);
  }
  // Session shape parity with Steam login: the client keys the linked-Steam
  // restore off `steamId`, so a Discord sign-in to a doubly-linked account
  // must carry it too — otherwise the Steam profile (and the cloud-profile
  // merge that depends on it) only runs after a later `/auth/me` round-trip,
  // making avatar/banner sync depend on which provider was used to sign in.
  const steamId = await getLinkedSteamId(env, resolved.account.user_id);
  return jsonResponse(
    { ...accountResponsePayload(resolved.account, token), isNewAccount: resolved.isNewAccount, steamId },
    env,
    resolved.isNewAccount ? 201 : 200
  );
}

async function handleMe(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const session = auth.session!;
  const userId = session.userId;

  const account = auth.account;
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 404);

  const [subscription, connections, events] = await Promise.all([
    getSubscription(env, userId),
    env.SUBSCRIPTION_DB.prepare(
      `SELECT provider, provider_id, metadata_json, linked_at FROM user_connections WHERE user_id = ?`
    ).bind(userId).all<UserConnectionRow>(),
    // The replacement for the "your password was changed" email nobody
    // receives any more. Capped: this is a glance, not an audit export.
    env.SUBSCRIPTION_DB.prepare(
      `SELECT kind, provider, ip_prefix, created_at FROM security_events
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(userId).all<{ kind: string; provider: string | null; ip_prefix: string | null; created_at: string }>()
      .catch(() => ({ results: [] as Array<{ kind: string; provider: string | null; ip_prefix: string | null; created_at: string }> })),
  ]);

  // Sliding renewal. The session token was minted once at login and never
  // refreshed, so an account in daily use was still signed out on the seventh
  // day — the app has no way to tell that apart from a revoked session, and
  // dropped the user to the login modal. Anything past the halfway mark gets a
  // fresh token; the client swaps it into its stored session.
  let token: string | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (session.exp - now < CLOUD_SESSION_TTL_SECONDS / 2) {
    token = await signCloudToken(env, {
      userId,
      steamId: session.steamId ?? null,
      exp: now + CLOUD_SESSION_TTL_SECONDS,
      iat: now,
      v: account.token_version ?? 1,
    });
  }

  return jsonResponse({
    ...(token ? { token } : {}),
    account: publicAccount(account),
    subscription: publicSubscription(subscription),
    connections: (connections.results || []).map((row) => ({
      provider: row.provider,
      providerId: row.provider_id,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      linkedAt: row.linked_at,
    })),
    securityEvents: (events.results || []).map((row) => ({
      kind: row.kind,
      provider: row.provider,
      ipPrefix: row.ip_prefix,
      createdAt: row.created_at,
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

  const steamId = await validateSteamOpenId(env, callbackUrl, false);
  if (!steamId) return jsonResponse({ error: "invalid_steam_login" }, env, 401);

  const existingLink = await env.SUBSCRIPTION_DB.prepare(
    `SELECT user_id FROM user_connections WHERE provider = 'steam' AND provider_id = ? LIMIT 1`
  ).bind(steamId).first<{ user_id: string }>();

  if (existingLink && existingLink.user_id !== userId) {
    return jsonResponse({ error: "steam_already_linked" }, env, 409);
  }

  if (!existingLink) {
    try {
      await writeProviderConnection(env, userId, {
        provider: "steam",
        id: steamId,
        username: null,
        displayName: displayName || null,
        avatarUrl: avatarUrl || null,
        email: null,
        emailVerified: false,
      });
    } catch (error) {
      if (error instanceof ProviderAlreadyLinkedError) {
        return jsonResponse({ error: "steam_already_linked" }, env, 409);
      }
      throw error;
    }

    await ensureUser(env, steamId);

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

  if (!(await consumeSteamNonce(env, nonceOf(callbackUrl)))) {
    return jsonResponse({ error: "invalid_steam_login" }, env, 401);
  }

  return jsonResponse({ steamId, claimed: true }, env);
}

async function handleDisconnectProvider(request: Request, env: Env, provider: "steam" | "discord") {
  const auth = await requireSession(request, env);
  if (auth.response) return auth.response;
  const userId = auth.session!.userId;

  // One conditional write serializes concurrent unlinks. Once one provider is
  // removed, a racing request for the other no longer sees an alternative and
  // therefore cannot remove the final login method.
  const removed = await env.SUBSCRIPTION_DB.prepare(
    `DELETE FROM user_connections
     WHERE user_id = ? AND provider = ?
       AND EXISTS (SELECT 1 FROM user_connections other WHERE other.user_id = ? AND other.provider <> ?)`
  ).bind(userId, provider, userId, provider).run();
  if ((removed.meta.changes ?? 0) === 0) {
    return jsonResponse({ error: "last_connection" }, env, 409);
  }

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

  await recordSecurityEvent(env, request, userId, "provider_unlinked", provider);

  // Unlinking removes a way in, so every other device is signed out. The
  // caller gets a token on the new version so it is not logged out by its own
  // action.
  const account = await getAccountByUserId(env, userId);
  if (!account) return jsonResponse({ error: "account_not_found" }, env, 404);
  const version = await bumpTokenVersion(env, userId);
  const token = await issueSessionToken(env, { ...account, token_version: version });
  return jsonResponse({ ok: true, token }, env);
}

// ---- Security trail ----

/** The /24 only. Enough for the user to tell "that was me at home" from "that
 * was not me"; not enough to be a location log. */
function ipPrefix(ip: string): string | null {
  const match = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (match) return `${match[1]}.0`;
  // IPv6: the routing prefix, which is roughly the same granularity.
  const parts = ip.split(":").filter(Boolean);
  return parts.length >= 4 ? `${parts.slice(0, 4).join(":")}::` : null;
}

/**
 * Records something that changed who can get into this account.
 *
 * Best-effort on purpose: an audit write must never fail the action it
 * describes — a user proving themselves through a provider must not be
 * locked out to protect a log entry.
 */
async function recordSecurityEvent(
  env: Env,
  request: Request,
  userId: string,
  kind: "login" | "account_created" | "provider_linked" | "provider_unlinked",
  provider: string | null = null
) {
  try {
    await env.SUBSCRIPTION_DB.prepare(
      `INSERT INTO security_events (id, user_id, kind, provider, ip_prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), userId, kind, provider, ipPrefix(clientIp(request)), nowIso())
      .run();
  } catch (error) {
    console.warn("Security event write failed", {
      userId,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---- Steam as a sign-in method (creates the account on first login) ----

/**
 * Signs in whoever owns the Steam account the OpenID callback proves.
 *
 * No ticket and no browser bounce: Steam, unlike Discord, accepts
 * an arbitrary `return_to`, so the desktop app receives the callback straight
 * on its loopback port and posts the whole URL here.
 *
 * A SteamID with no GhostBox account gets an account created automatically
 * from the provider name, and the session comes back directly. The assertion
 * is consumed exactly once.
 */
async function handleSteamLogin(request: Request, env: Env) {
  const ip = clientIp(request);
  if (await tooManyAuthAttempts(env, ip, "steam_login", 15, 900)) {
    return jsonResponse({ error: "too_many_attempts" }, env, 429);
  }
  await recordAuthAttempt(env, ip, "steam_login");

  const body = await readJson(request);
  const callbackUrl = typeof body?.callbackUrl === "string" ? body.callbackUrl : "";

  // The SteamID is taken from what Steam itself confirms, never from the body.
  // Peek first: spending the assertion before knowing whether it logs in or
  // signs up would force the user through the browser twice.
  const steamId = await validateSteamOpenId(env, callbackUrl, false);
  if (!steamId) return jsonResponse({ error: "invalid_steam_login" }, env, 401);

  if (!(await consumeSteamNonce(env, nonceOf(callbackUrl)))) {
    return jsonResponse({ error: "invalid_steam_login" }, env, 401);
  }

  const displayName =
    typeof body?.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 60)
      : null;
  const avatarUrl =
    typeof body?.avatarUrl === "string" && body.avatarUrl.trim()
      ? body.avatarUrl.trim().slice(0, 2048)
      : null;
  const identity: ProviderIdentity = {
    provider: "steam",
    id: steamId,
    username: null,
    displayName,
    avatarUrl,
    email: null,
    emailVerified: false,
  };
  let resolved: { account: AccountRow; isNewAccount: boolean };
  try {
    resolved = await getOrCreateProviderAccount(env, identity);
  } catch (error) {
    console.error("Steam provider account resolution failed", { steamId, error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ error: "provider_login_failed" }, env, 500);
  }

  if (resolved.isNewAccount) {
    await ensureUser(env, steamId);
    for (const table of STEAM_LINKED_TABLES) {
      await env.SUBSCRIPTION_DB.prepare(
        `UPDATE OR IGNORE ${table} SET user_id = ? WHERE steam_id = ? AND user_id IS NULL`
      ).bind(resolved.account.user_id, steamId).run();
    }
  }
  const token = await issueSessionToken(env, resolved.account);
  await recordSecurityEvent(env, request, resolved.account.user_id, resolved.isNewAccount ? "account_created" : "login", "steam");
  if (resolved.isNewAccount) await recordSecurityEvent(env, request, resolved.account.user_id, "provider_linked", "steam");
  return jsonResponse(
    { ...accountResponsePayload(resolved.account, token), isNewAccount: resolved.isNewAccount, steamId },
    env,
    resolved.isNewAccount ? 201 : 200
  );
}

/** Extracts `openid.response_nonce` for explicit consumption. The login flow
 * above validates first and consumes only once the outcome is known. */
function nonceOf(callbackUrl: string): string {
  try {
    return new URL(callbackUrl).searchParams.get("openid.response_nonce") || "";
  } catch {
    return "";
  }
}

// ---- Account merge / deletion: not offered ----
//
// Uniting two accounts or deleting an account is out of scope: a provider
// identity belongs to exactly one account, conflicts are directed to support,
// and there is no self-service deletion. The handlers below were removed so
// the surface cannot be re-enabled by accident.

async function route(request: Request, env: Env, context: ExecutionContext) {
  if (request.method === "OPTIONS") return jsonResponse({}, env);

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "ghostbox-subscriptions" }, env);
  }

  if (request.method === "POST" && url.pathname === "/auth/register") return handleRegister(request, env);
  if (request.method === "POST" && url.pathname === "/auth/login") return handleLogin(request, env);
  if (request.method === "POST" && url.pathname === "/auth/change-password") return handleChangePassword(request, env);
  // Retired password flows: kept as explicit 410s so old app builds fail with
  // a clear message instead of a confusing 404.
  if (request.method === "POST" && url.pathname === "/auth/recover/exchange") return handleRecoverGone(request, env);
  if (request.method === "POST" && url.pathname === "/auth/recover/password") return handleRecoverGone(request, env);
  if (request.method === "POST" && url.pathname === "/auth/recover/discord/start") return handleRecoverGone(request, env);
  if (request.method === "POST" && url.pathname === "/auth/recover/discord/confirm") return handleRecoverGone(request, env);
  if (request.method === "POST" && url.pathname === "/auth/discord/send-code") return handleVerificationGone(request, env);
  if (request.method === "POST" && url.pathname === "/auth/discord/confirm-code") return handleVerificationGone(request, env);
  if (request.method === "GET" && url.pathname === "/auth/discord/start") return handleDiscordLoginStart(request, env);
  if (request.method === "POST" && url.pathname === "/auth/discord/exchange") return handleDiscordExchange(request, env);

  // Provider-neutral entry points. `/auth/discord/*` above stays as an alias so
  // app builds shipped before this keep signing in.
  const oauthStart = url.pathname.match(/^\/auth\/oauth\/([a-z]+)\/start$/);
  if (request.method === "GET" && oauthStart) {
    const provider = oauthStart[1];
    if (!isOAuthProvider(provider)) return jsonResponse({ error: "unknown_provider" }, env, 404);
    // `recover` was the password-recovery hand-off and no longer exists; it
    // fails closed here instead of minting a usable state.
    const purpose = url.searchParams.get("purpose") === "recover" ? "recover" : "login";
    return handleOAuthLoginStart(request, env, provider, purpose);
  }
  const oauthLink = url.pathname.match(/^\/auth\/oauth\/([a-z]+)\/link$/);
  if (request.method === "POST" && oauthLink) {
    const provider = oauthLink[1];
    if (!isOAuthProvider(provider)) return jsonResponse({ error: "unknown_provider" }, env, 404);
    return handleOAuthLinkStart(request, env, provider);
  }
  if (request.method === "POST" && url.pathname === "/auth/oauth/exchange") return handleDiscordExchange(request, env);
  if (request.method === "GET" && url.pathname === "/oauth/callback") return handleDiscordCallback(request, env);

  if (request.method === "POST" && url.pathname === "/auth/steam/login") return handleSteamLogin(request, env);
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
    return handleStripeWebhook(request, env);
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
    await pruneStaleRecords(env);
  },
};
