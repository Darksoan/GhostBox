// Firebase Identity Toolkit REST client + GhostBox account (D1) helpers.
//
// Firebase stores only the credential (uid/email/password hash); everything
// else about the account — username, connections, subscription — lives in D1
// keyed by the Firebase uid. GhostBox sends no email at all: identity is
// proved through a linked provider (Discord, Steam), never through an
// inbox.
//
// Mostly the public REST API (API key only). The one thing it cannot do is set
// a password without the old one: `accounts:update` needs an idToken, and the
// only ways to get one are the current password or an emailed oobCode. That is
// exactly the recovery case, so `mintFirebaseCustomToken` signs a custom token
// with the service account instead — `crypto.subtle` does RS256 with an
// imported PKCS#8 key, so no Admin SDK and no Node crypto is involved.

import { base64Url } from "./crypto";

export type Env = {
  SUBSCRIPTION_DB: D1Database;
  FIREBASE_API_KEY?: string;
  /** The service account JSON, verbatim. Only needed for the recovery path. */
  FIREBASE_SERVICE_ACCOUNT_KEY?: string;
};

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";

export class FirebaseAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function firebaseErrorCode(payload: unknown): string {
  const error = (payload as { error?: { message?: string } } | null)?.error;
  return error?.message || "firebase_error";
}

async function firebasePost<T = Record<string, unknown>>(
  env: Env,
  base: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const apiKey = env.FIREBASE_API_KEY?.trim();
  if (!apiKey) throw new Error("FIREBASE_API_KEY is not configured");
  const response = await fetch(`${base}/${path}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    throw new FirebaseAuthError(firebaseErrorCode(payload), response.status);
  }
  return payload as T;
}

export type FirebaseSession = {
  localId: string;
  idToken: string;
  refreshToken: string;
  email: string;
};

export async function firebaseSignUp(env: Env, email: string, password: string): Promise<FirebaseSession> {
  const payload = await firebasePost<{ localId: string; idToken: string; refreshToken: string; email: string }>(
    env,
    IDENTITY_BASE,
    "accounts:signUp",
    { email, password, returnSecureToken: true }
  );
  return payload;
}

export async function firebaseSignIn(env: Env, email: string, password: string): Promise<FirebaseSession> {
  const payload = await firebasePost<{ localId: string; idToken: string; refreshToken: string; email: string }>(
    env,
    IDENTITY_BASE,
    "accounts:signInWithPassword",
    { email, password, returnSecureToken: true }
  );
  return payload;
}

export async function firebaseDeleteAccount(env: Env, idToken: string): Promise<void> {
  await firebasePost(env, IDENTITY_BASE, "accounts:delete", { idToken });
}

// ---- Custom tokens (recovery path) ----

const CUSTOM_TOKEN_AUDIENCE =
  "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(env: Env): ServiceAccount {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  }
  return parsed as ServiceAccount;
}

/** PEM -> the raw PKCS#8 bytes `crypto.subtle.importKey` wants. The JSON keeps
 * the newlines escaped, so they have to be unescaped before the header and
 * footer lines can be stripped. */
function pkcs8Bytes(privateKeyPem: string): ArrayBuffer {
  const body = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * Signs a Firebase custom token asserting `uid`, valid for an hour.
 *
 * This is a bearer assertion for an arbitrary account, so it must only ever be
 * minted for a user who has *already* proved themselves through a linked
 * provider on this same request. Never mint one from an identifier the client
 * supplied.
 */
export async function mintFirebaseCustomToken(env: Env, uid: string): Promise<string> {
  const account = serviceAccount(env);
  const issuedAt = Math.floor(Date.now() / 1000);

  const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claims = encode({
    iss: account.client_email,
    sub: account.client_email,
    aud: CUSTOM_TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + 3600,
    uid,
  });

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );

  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

/** Signs in as `uid` without its password — the only way to reach
 * `firebaseUpdatePassword` during recovery. Same caveat as
 * `mintFirebaseCustomToken`: the caller must have proved the user first. */
export async function firebaseSignInWithCustomToken(
  env: Env,
  uid: string,
  email: string
): Promise<FirebaseSession> {
  const token = await mintFirebaseCustomToken(env, uid);
  // Unlike the password endpoints, this one answers with tokens only — no
  // localId, no email. Both are already known: the uid is what was asserted,
  // and the address comes from the account row the caller looked up.
  const payload = await firebasePost<{ idToken: string; refreshToken: string }>(
    env,
    IDENTITY_BASE,
    "accounts:signInWithCustomToken",
    { token, returnSecureToken: true }
  );
  return { localId: uid, email, idToken: payload.idToken, refreshToken: payload.refreshToken };
}

export async function firebaseLookup(env: Env, idToken: string): Promise<{ localId: string; emailVerified: boolean }> {
  const payload = await firebasePost<{ users?: Array<{ localId: string; emailVerified?: boolean }> }>(
    env,
    IDENTITY_BASE,
    "accounts:lookup",
    { idToken }
  );
  const user = payload.users?.[0];
  if (!user) throw new FirebaseAuthError("USER_NOT_FOUND", 404);
  return { localId: user.localId, emailVerified: Boolean(user.emailVerified) };
}

export async function firebaseUpdatePassword(env: Env, idToken: string, newPassword: string): Promise<void> {
  await firebasePost(env, IDENTITY_BASE, "accounts:update", { idToken, password: newPassword, returnSecureToken: false });
}

// Firebase error codes -> stable GhostBox error keys. Never surface the raw
// Firebase message to the client (implementation detail, occasionally in
// English mid-sentence and inconsistent across API versions).
const FIREBASE_ERROR_MAP: Record<string, string> = {
  EMAIL_EXISTS: "email_already_registered",
  EMAIL_NOT_FOUND: "invalid_credentials",
  INVALID_PASSWORD: "invalid_credentials",
  INVALID_LOGIN_CREDENTIALS: "invalid_credentials",
  USER_DISABLED: "account_disabled",
  WEAK_PASSWORD: "weak_password",
  TOO_MANY_ATTEMPTS_TRY_LATER: "too_many_attempts",
  INVALID_EMAIL: "invalid_email",
};

export function mapFirebaseError(error: unknown): { code: string; status: number } {
  if (error instanceof FirebaseAuthError) {
    const base = error.code.split(" : ")[0].split(":")[0].trim();
    return { code: FIREBASE_ERROR_MAP[base] || "auth_error", status: error.status };
  }
  return { code: "auth_error", status: 500 };
}

// ---- Account validation ----

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_]{3,20}$/.test(trimmed) ? trimmed : null;
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 4096;
}

// ---- D1: accounts ----

/** How the account proved itself. `email` means the address on file was
 * confirmed (Firebase link, or Discord reporting that same address as
 * verified). `discord` means a real person holds the linked Discord account,
 * but the email address is still unconfirmed. */
export type VerifiedVia = "email" | "discord";

export type AccountRow = {
  user_id: string;
  email: string;
  username: string;
  display_name: string | null;
  email_verified: number;
  verified_via: string | null;
  /** Bumped to invalidate every session token minted so far. See
   * migration 0016 and `bumpTokenVersion`. */
  token_version: number;
  created_at: string;
  updated_at: string;
};

export type PublicAccount = {
  userId: string;
  email: string;
  username: string;
  displayName: string | null;
  emailVerified: boolean;
  verifiedVia: VerifiedVia | null;
};

export function publicAccount(row: AccountRow): PublicAccount {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified),
    verifiedVia: row.verified_via === "email" || row.verified_via === "discord" ? row.verified_via : null,
  };
}

export async function getAccountByUserId(env: Env, userId: string) {
  return env.SUBSCRIPTION_DB.prepare(`SELECT * FROM accounts WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<AccountRow>();
}

export async function getAccountByUsername(env: Env, username: string) {
  return env.SUBSCRIPTION_DB.prepare(`SELECT * FROM accounts WHERE username = ? COLLATE NOCASE LIMIT 1`)
    .bind(username)
    .first<AccountRow>();
}

export async function getAccountByEmail(env: Env, email: string) {
  return env.SUBSCRIPTION_DB.prepare(`SELECT * FROM accounts WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<AccountRow>();
}

export async function insertAccount(
  env: Env,
  input: {
    userId: string;
    email: string;
    username: string;
    displayName: string | null;
    /** When a trusted source (a linked provider vouching for the address)
     * already confirmed it, the account starts verified and no email is sent. */
    emailVerified?: boolean;
  }
) {
  const now = new Date().toISOString();
  const verified = input.emailVerified ? 1 : 0;
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO accounts (user_id, email, username, display_name, email_verified, verified_via, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(input.userId, input.email, input.username, input.displayName, verified, verified ? "email" : null, now, now)
    .run();
}

/**
 * Confirms the address on file. Raise-only, deliberately.
 *
 * GhostBox no longer sends Firebase verification emails, so Firebase reports
 * `emailVerified: false` for every account forever — including the ones this
 * app confirmed itself, by matching a Discord address Discord had already
 * verified. Letting a sync write that `false` back meant a verified account
 * silently lost its badge on the next login.
 */
export async function markEmailVerified(env: Env, userId: string) {
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE accounts SET email_verified = 1, verified_via = 'email', updated_at = ? WHERE user_id = ?`
  ).bind(new Date().toISOString(), userId).run();
}

/** Drops a Discord-based proof when the Discord account moves to someone else.
 *
 * Without this a single Discord could stamp `verified_via = 'discord'` on an
 * unlimited number of accounts: link, verify, link elsewhere, verify again —
 * every account keeps the badge while only the last one still has the Discord.
 * That is exactly the account farming the check exists to stop.
 *
 * An `email` proof is left alone: that one is about the address on file, and
 * the address did not move anywhere. */
export async function revokeDiscordVerification(env: Env, userId: string) {
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE accounts SET verified_via = NULL, updated_at = ? WHERE user_id = ? AND verified_via = 'discord'`
  ).bind(new Date().toISOString(), userId).run();
}

/** Records a Discord DM PIN proof. `emailVerified` is only raised when the
 * Discord address matches the one on file — otherwise the account is a
 * confirmed person with a still-unconfirmed email. */
export async function markVerifiedViaDiscord(env: Env, userId: string, emailVerified: boolean) {
  const now = new Date().toISOString();
  if (emailVerified) {
    await env.SUBSCRIPTION_DB.prepare(
      `UPDATE accounts SET email_verified = 1, verified_via = 'email', updated_at = ? WHERE user_id = ?`
    ).bind(now, userId).run();
    return;
  }
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE accounts SET verified_via = 'discord', updated_at = ? WHERE user_id = ?`
  ).bind(now, userId).run();
}

/**
 * Invalidates every session token issued for this account so far, and returns
 * the new version so the caller can immediately mint a replacement.
 *
 * Call it on anything that changes who can get in: password changed or
 * recovered, provider linked or unlinked. The point is the recovery case — the
 * owner proves themselves through a provider and sets a new password, and
 * whoever was already inside has to be pushed out in the same breath.
 */
export async function bumpTokenVersion(env: Env, userId: string): Promise<number> {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `UPDATE accounts SET token_version = token_version + 1, updated_at = ? WHERE user_id = ?
     RETURNING token_version`
  )
    .bind(new Date().toISOString(), userId)
    .first<{ token_version: number }>();
  return row?.token_version ?? 1;
}

// ---- D1: rate limiting ----

export async function recordAuthAttempt(env: Env, ip: string, kind: string) {
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO auth_attempts (id, ip, kind, created_at) VALUES (?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), ip, kind, new Date().toISOString()).run();
}

export async function tooManyAuthAttempts(
  env: Env,
  ip: string,
  kind: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT COUNT(*) AS count FROM auth_attempts WHERE ip = ? AND kind = ? AND created_at >= ?`
  ).bind(ip, kind, since).first<{ count: number }>();
  return (row?.count ?? 0) >= limit;
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}
