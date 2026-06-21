type Env = {
  SUBSCRIPTION_DB: D1Database;
  SUMUP_API_KEY: string;
  SUMUP_MERCHANT_CODE: string;
  SUMUP_BASE_URL?: string;
  CHECKOUT_RETURN_URL?: string;
  ALLOWED_ORIGIN?: string;
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

async function readJson(request: Request) {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
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
    return { ...row, status: "expired" as SubscriptionStatus, updated_at: updatedAt };
  }

  return row;
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

  return jsonResponse({
    steamId,
    subscription: publicSubscription(subscription),
    latestPayment: latestPayment ? publicPayment(latestPayment, origin) : null,
  }, env);
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
  if (request.method === "POST" && url.pathname === "/subscription/checkouts") {
    return handleCreateCheckout(request, env);
  }
  if (request.method === "GET" && url.pathname === "/subscription/status") {
    return handleStatus(request, env);
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
};
