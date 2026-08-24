// Cakto is the Pix provider; Stripe stays on cards. The two never touch the
// same payment: a row in `payments` is one or the other, told apart by
// `provider`.
//
// The pure helpers here (status mapping, document validation) are unit tested
// in test/cakto-pix.test.ts for the same reason the Stripe ones are: misreading
// a status is how a paying user silently loses Premium.

export type CaktoEnv = {
  CAKTO_CLIENT_ID?: string;
  CAKTO_CLIENT_SECRET?: string;
  CAKTO_WEBHOOK_SECRET?: string;
  CAKTO_OFFER_MONTHLY?: string;
  CAKTO_OFFER_QUARTERLY?: string;
  CAKTO_API_URL?: string;
};

export const CAKTO_API_URL = "https://api.cakto.com.br";

/**
 * The only state that means the money arrived.
 *
 * `authorized` is deliberately excluded: Pix has no manual capture, so an
 * authorized-but-unsettled order would be granting Premium against money that
 * has not cleared.
 */
const PAID_STATUSES = new Set(["paid"]);

/**
 * States that revoke access. `refund_requested` is deliberately absent: it is
 * only a request awaiting approval, and cutting Premium there would punish a
 * user whose refund is later denied.
 */
const REVERSED_STATUSES = new Set(["refunded", "chargedback", "in_settlement"]);

export type CaktoOrder = {
  id: string;
  refId?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  amount?: string | number | null;
  checkoutUrl?: string | null;
  pix?: {
    qrCode?: string | null;
    qrCodeBase64?: string | null;
    expiresAt?: string | null;
  } | null;
};

export function caktoOrderIsPaid(order: { status?: string | null } | null) {
  return Boolean(order?.status && PAID_STATUSES.has(order.status));
}

export function caktoOrderIsReversed(order: { status?: string | null } | null) {
  return Boolean(order?.status && REVERSED_STATUSES.has(order.status));
}

/** Digits only, as every Cakto document/phone field expects. */
export function onlyDigits(value: string) {
  return value.replace(/\D+/g, "");
}

/**
 * CPF check digits (mod 11).
 *
 * Validated here rather than left to Cakto because a rejected charge still
 * costs an API call and a `payments` row, and the user only finds out after
 * staring at a QR code that will never be paid.
 */
export function isValidCpf(value: string) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  // Repdigits pass the checksum but are never real documents.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  for (const [length, position] of [[9, 10], [10, 11]] as const) {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (position - index);
    }
    const remainder = (sum * 10) % 11;
    const expected = remainder === 10 ? 0 : remainder;
    if (expected !== Number(digits[length])) return false;
  }

  return true;
}

/** Brazilian phone with area code, landline (10) or mobile (11). */
export function isValidBrazilianPhone(value: string) {
  const digits = onlyDigits(value);
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return national.length === 10 || national.length === 11;
}

/**
 * Amount actually charged, in cents.
 *
 * The offer price is the base; Cakto adds its R$ 0,99 service fee on top at
 * checkout, so the plan's own `amountCents` would understate what the customer
 * paid. `amount` comes back as a decimal string in reais ("14.99").
 */
export function caktoAmountCents(order: { amount?: string | number | null } | null) {
  const raw = order?.amount;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function caktoOfferId(env: CaktoEnv, planId: "monthly" | "quarterly") {
  const offer = planId === "quarterly" ? env.CAKTO_OFFER_QUARTERLY : env.CAKTO_OFFER_MONTHLY;
  return offer?.trim() || null;
}

export function caktoConfigured(env: CaktoEnv) {
  return Boolean(env.CAKTO_CLIENT_ID?.trim() && env.CAKTO_CLIENT_SECRET?.trim());
}

type CachedToken = { token: string; expiresAt: number };

// Per-isolate cache. Cloudflare recycles isolates freely, so this is a best
// effort at not re-authenticating on every charge — never a correctness
// assumption.
let cachedToken: CachedToken | null = null;

export function resetCaktoTokenCache() {
  cachedToken = null;
}

function caktoBaseUrl(env: CaktoEnv) {
  return (env.CAKTO_API_URL?.trim() || CAKTO_API_URL).replace(/\/+$/, "");
}

export async function caktoAccessToken(env: CaktoEnv) {
  const clientId = env.CAKTO_CLIENT_ID?.trim();
  const clientSecret = env.CAKTO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Cakto is not configured");

  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const response = await fetch(`${caktoBaseUrl(env)}/public_api/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    // No `grant_type`: Cakto's token endpoint answers 400
    // `unsupported_grant_type` when it is sent, even with the value the OAuth2
    // client-credentials spec calls for.
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const payload = await response.json<Record<string, any>>().catch(() => null);
  const token = typeof payload?.access_token === "string" ? payload.access_token : null;
  if (!response.ok || !token) {
    throw new Error(payload?.error_description || payload?.error || `Cakto auth failed (HTTP ${response.status})`);
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  // Expire the cache a minute early so a token never dies mid-request.
  cachedToken = { token, expiresAt: Date.now() + Math.max(expiresIn - 60, 30) * 1000 };
  return token;
}

export class CaktoApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "CaktoApiError";
  }
}

export async function caktoRequest(
  env: CaktoEnv,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<Record<string, any>> {
  const token = await caktoAccessToken(env);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;

  const response = await fetch(`${caktoBaseUrl(env)}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  const payload = text ? safeJson(text) : {};

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new CaktoApiError(
      response.status,
      caktoErrorMessage(payload) || `Cakto respondeu HTTP ${response.status}`,
      Number.isFinite(retryAfter) ? retryAfter : null
    );
  }

  return payload;
}

function safeJson(text: string): Record<string, any> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { message: text };
  } catch {
    return { message: text };
  }
}

function caktoErrorMessage(payload: Record<string, any>): string | null {
  for (const key of ["detail", "message", "error", "error_description"]) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // DRF-style field errors: { "customer": ["This field is required."] }
  for (const value of Object.values(payload || {})) {
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return null;
}

export type CaktoPixPayer = {
  name: string;
  email: string;
  phone: string;
  document: string;
  documentType: "cpf" | "cnpj";
  fingerprint: string;
  ip?: string | null;
};

export async function createCaktoPixCharge(
  env: CaktoEnv,
  input: {
    offerId: string;
    payer: CaktoPixPayer;
    idempotencyKey: string;
    /** Carries the GhostBox userId back on the webhook; `sck` is the only free-form field Cakto exposes. */
    trackingReference?: string | null;
    expiresInSeconds?: number;
  }
): Promise<CaktoOrder> {
  const { payer } = input;
  const body: Record<string, unknown> = {
    paymentMethod: "pix",
    customer: {
      name: payer.name,
      email: payer.email,
      phone: onlyDigits(payer.phone),
      fingerprint: payer.fingerprint,
      docType: payer.documentType,
      docNumber: onlyDigits(payer.document),
      ...(payer.ip ? { ip: payer.ip } : {}),
    },
    items: [{ offerId: input.offerId, quantity: 1, offerType: "main" }],
  };
  if (input.trackingReference) body.metadata = { sck: input.trackingReference };
  if (input.expiresInSeconds) body.pixExpiresIn = input.expiresInSeconds;

  const order = await caktoRequest(env, "/public_api/payments/", {
    method: "POST",
    body,
    idempotencyKey: input.idempotencyKey,
  });

  return order as CaktoOrder;
}

export async function getCaktoOrder(env: CaktoEnv, orderId: string): Promise<CaktoOrder | null> {
  try {
    return (await caktoRequest(env, `/public_api/orders/${encodeURIComponent(orderId)}/`)) as CaktoOrder;
  } catch (error) {
    if (error instanceof CaktoApiError && error.status === 404) return null;
    throw error;
  }
}
