// Firebase Identity Toolkit REST client + GhostBox account (D1) helpers.
// Deliberately uses the public REST API (API key only) instead of the Admin
// SDK: no service-account private key to manage as a Workers secret, and the
// Workers runtime has no Node crypto for RSA JWT signing anyway. Firebase
// only stores the credential (uid/email/password hash/verified flag) and
// sends the verification/reset emails; everything else about the account
// (username, connections, subscription) lives in D1 keyed by the Firebase uid.

export type Env = {
  SUBSCRIPTION_DB: D1Database;
  FIREBASE_API_KEY?: string;
};

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";
const SECURE_TOKEN_BASE = "https://securetoken.googleapis.com/v1";

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

export async function firebaseSendPasswordReset(env: Env, email: string): Promise<void> {
  await firebasePost(env, IDENTITY_BASE, "accounts:sendOobCode", {
    requestType: "PASSWORD_RESET",
    email,
  });
}

export async function firebaseSendEmailVerification(env: Env, idToken: string): Promise<void> {
  await firebasePost(env, IDENTITY_BASE, "accounts:sendOobCode", {
    requestType: "VERIFY_EMAIL",
    idToken,
  });
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

export async function firebaseExchangeRefreshToken(
  env: Env,
  refreshToken: string
): Promise<{ idToken: string; refreshToken: string; userId: string }> {
  const apiKey = env.FIREBASE_API_KEY?.trim();
  if (!apiKey) throw new Error("FIREBASE_API_KEY is not configured");
  const response = await fetch(`${SECURE_TOKEN_BASE}/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const payload = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    throw new FirebaseAuthError(firebaseErrorCode(payload), response.status);
  }
  return {
    idToken: String(payload.id_token),
    refreshToken: String(payload.refresh_token),
    userId: String(payload.user_id),
  };
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

export type AccountRow = {
  user_id: string;
  email: string;
  username: string;
  display_name: string | null;
  email_verified: number;
  created_at: string;
  updated_at: string;
};

export type PublicAccount = {
  userId: string;
  email: string;
  username: string;
  displayName: string | null;
  emailVerified: boolean;
};

export function publicAccount(row: AccountRow): PublicAccount {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified),
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
  input: { userId: string; email: string; username: string; displayName: string | null }
) {
  const now = new Date().toISOString();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO accounts (user_id, email, username, display_name, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).bind(input.userId, input.email, input.username, input.displayName, now, now).run();
}

export async function touchAccountVerified(env: Env, userId: string, emailVerified: boolean) {
  await env.SUBSCRIPTION_DB.prepare(
    `UPDATE accounts SET email_verified = ?, updated_at = ? WHERE user_id = ?`
  ).bind(emailVerified ? 1 : 0, new Date().toISOString(), userId).run();
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
