// Provider-only identity: Discord and Steam are the only ways in.
// Email/password signup, login, change and recovery were removed, along with
// the entire Firebase credential layer. Firebase stores nothing for GhostBox
// anymore; the account row in D1 plus its provider connections in
// `user_connections` are the whole identity.
//
// Every account must hold at least one provider connection. The server
// refuses to drop the last one (`last_connection`), so there is always a way
// back in through the provider itself — never through an inbox, because
// GhostBox still sends no email at all.

import { base64Url } from "./crypto";

export type Env = {
  SUBSCRIPTION_DB: D1Database;
};

// ---- Validation ----

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

/** Builds a usable fallback username from a provider identity when the user
 * has not typed one yet. The caller must still check uniqueness. */
export function suggestUsername(raw: unknown, fallback: string): string {
  const cleaned =
    typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") : "";
  const base = (cleaned || fallback).slice(0, 15);
  return base.length >= 3 ? base : fallback;
}

// ---- D1: accounts ----

export type AccountRow = {
  user_id: string;
  /** NULL for provider-created accounts that never had an address on file. */
  email: string | null;
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
  email: string | null;
  username: string;
  displayName: string | null;
};

export function publicAccount(row: AccountRow): PublicAccount {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
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
    email: string | null;
    username: string;
    displayName: string | null;
  }
) {
  const now = new Date().toISOString();
  await env.SUBSCRIPTION_DB.prepare(
    `INSERT INTO accounts (user_id, email, username, display_name, email_verified, verified_via, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`
  )
    .bind(input.userId, input.email, input.username, input.displayName, now, now)
    .run();
}

/**
 * Invalidates every session token issued for this account so far, and returns
 * the new version so the caller can immediately mint a replacement.
 *
 * Call it on anything that changes who can get in: provider linked or
 * unlinked, accounts merged, account recovered through a provider. Whoever
 * was already inside on another device has to prove themselves again.
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

/** True when the account holds at least one provider connection. */
export async function hasProviderConnection(env: Env, userId: string): Promise<boolean> {
  const row = await env.SUBSCRIPTION_DB.prepare(
    `SELECT 1 AS ok FROM user_connections WHERE user_id = ? LIMIT 1`
  )
    .bind(userId)
    .first<{ ok: number }>();
  return Boolean(row);
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

/** base64url of random bytes — internal ids are never a provider id. */
export function newUserId(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}
