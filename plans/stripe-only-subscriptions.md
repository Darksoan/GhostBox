# Stripe-Only Subscriptions Plan

## Goal

Make GhostBox Premium subscriptions 100% Stripe-based in sandbox first, then production later.

This migration must remove SumUp from the subscription flow entirely. Stripe becomes the only payment, subscription, renewal, cancellation, refund, portal, and payment-method provider.

## Current Findings

- The app checkout currently calls `POST /subscription/checkouts`.
- The Worker currently creates SumUp checkouts in `workers/subscriptions/src/index.ts`.
- The settings subscription buttons already call the Stripe Billing Portal endpoint:
  - `openBillingPortal("manage")`
  - `openBillingPortal("payment_method_update")`
- The Worker already exposes `POST /subscription/portal` for Stripe Billing Portal.
- Remote Wrangler secret list does not include `STRIPE_SECRET_KEY` yet.
- Remote D1 already has `subscriptions.stripe_customer_id` from migration `0005_stripe_customer.sql`.
- Remote D1 does not have `stripe_subscription_id` yet.
- Remote D1 has `13` payment rows and `0` paid rows.
- Remote D1 has `1` active subscription row.
- The frontend copy still mentions SumUp in `src/i18n.ts`.
- `POLICIES.md` already refers to Stripe, so legal/policy copy is closer to the desired state than the UI copy.

## Non-Goals

- Do not support SumUp fallback.
- Do not keep dual-provider compatibility unless explicitly required for existing paid users.
- Do not add Stripe Price IDs for the sandbox phase.
- Do not implement production Stripe setup in this phase.

## Payment Model

Use Stripe Checkout Sessions in `subscription` mode with inline `price_data`.

Initial prices:

- Monthly: `699` cents, `BRL`, recurring interval `month`, interval count `1`.
- Quarterly: `1499` cents, `BRL`, recurring interval `month`, interval count `3`.

Product naming:

- Monthly: `GhostBox Premium Mensal`.
- Quarterly: `GhostBox Premium Trimestral`.

Checkout metadata:

- `steam_id`
- `plan_id`
- internal payment/session id if needed

Subscription metadata:

- `steam_id`
- `plan_id`

Customer metadata:

- `steam_id`

## Required Stripe Configuration

Configure these Worker secrets for sandbox:

```powershell
npx wrangler secret put STRIPE_SECRET_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config workers/subscriptions/wrangler.toml
```

Optional variable/secret:

```powershell
npx wrangler secret put STRIPE_PORTAL_RETURN_URL --config workers/subscriptions/wrangler.toml
```

Stripe Dashboard setup:

- Enable/test Customer Portal in sandbox.
- Configure allowed portal features:
  - cancel subscription
  - update payment method
  - view invoices/payment history if desired
- Add webhook endpoint:
  - `https://ghostbox-subscriptions.hella.workers.dev/stripe/webhook`
- Subscribe to events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - optionally `invoice.paid`

## Database Changes

Add a new D1 migration, likely `workers/subscriptions/migrations/0007_stripe_subscriptions.sql`.

Required `subscriptions` columns:

- `stripe_subscription_id TEXT`
- optionally `stripe_subscription_status TEXT`
- optionally `cancel_at_period_end INTEGER NOT NULL DEFAULT 0`

Required indexes:

- `idx_subscriptions_stripe_subscription_id`

Update `payments` away from SumUp-specific fields. Minimal approach:

- Keep the table name to reduce app churn.
- Add Stripe-specific nullable columns:
  - `stripe_checkout_session_id TEXT`
  - `stripe_invoice_id TEXT`
  - `stripe_payment_intent_id TEXT`
  - `stripe_subscription_id TEXT`
  - `provider TEXT NOT NULL DEFAULT 'stripe'`
  - `provider_payload TEXT`
- Stop writing `sumup_payload` for new records.
- Keep old SumUp columns only as historical dead schema unless a later cleanup migration recreates the table.

Indexes:

- `idx_payments_stripe_checkout_session_id`
- `idx_payments_stripe_invoice_id`
- `idx_payments_stripe_subscription_id`

Webhook events:

- Reuse `webhook_events`, but store Stripe event ids in `id` and Stripe event type in `event_type`.
- Ensure duplicate Stripe webhooks are ignored via `INSERT OR IGNORE`.

## Worker Changes

File: `workers/subscriptions/src/index.ts`

Remove or retire SumUp code paths:

- Remove `SUMUP_API_KEY` and `SUMUP_MERCHANT_CODE` from `Env`.
- Remove `SUMUP_BASE_URL` usage.
- Remove SumUp helper functions:
  - `getSumUpBaseUrl`
  - `sumupRequest`
  - `hostedCheckoutUrl` if no longer needed generically
  - `unwrapSumUpCheckout`
  - `hasPixTransaction`
  - `createSumUpCheckout`
  - `processSumUpPixCheckout`
  - `getSumUpCheckout`
  - `normalizeSumUpStatus` if replaced by Stripe status mapping
  - `pixArtefacts`
  - `pixDetails`
  - `handlePixQr`
  - SumUp-specific webhook handling
- Remove `/sumup/webhook` route.
- Remove `/subscription/pix-qr` route.
- Replace `/subscription/refresh` behavior so it refreshes from Stripe by checkout session id, subscription id, or invoice id if still needed.

Add/keep Stripe helpers:

- Keep existing `stripeRequest` for form-encoded Stripe API calls.
- Add `stripeJsonRequest` only if needed for webhook/session retrieval, otherwise continue with form requests.
- Add `constructStripeCheckoutSession` using `/v1/checkout/sessions`.
- Add `retrieveStripeSubscription` using `/v1/subscriptions/:id`.
- Add `retrieveStripeCheckoutSession` using `/v1/checkout/sessions/:id`.
- Add `verifyStripeWebhookSignature` using Web Crypto HMAC SHA-256 and `STRIPE_WEBHOOK_SECRET`.

Replace `handleCreateCheckout`:

- Validate Steam ID and plan id.
- Ensure user exists.
- Resolve or create Stripe customer using existing `resolveStripeCustomerId`.
- Create Stripe Checkout Session:
  - `mode=subscription`
  - `customer=<customerId>`
  - `success_url=<returnUrl>?session_id={CHECKOUT_SESSION_ID}`
  - `cancel_url=<returnUrl>?cancelled=1`
  - `line_items[0][price_data][currency]=brl`
  - `line_items[0][price_data][product_data][name]=...`
  - `line_items[0][price_data][recurring][interval]=month`
  - `line_items[0][price_data][recurring][interval_count]=1|3`
  - `line_items[0][unit_amount]=699|1499`
  - `line_items[0][quantity]=1`
  - metadata fields for Steam and plan
  - subscription metadata fields for Steam and plan
- Insert a pending `payments` row with:
  - Stripe checkout session id
  - hosted checkout URL from Stripe session `url`
  - status `pending`
  - provider `stripe`
- Return the same frontend-compatible shape:
  - `{ payment: { hostedCheckoutUrl, status, amountCents, currency, planId, ... } }`

Update subscription activation:

- Replace SumUp payment status activation with Stripe subscription status activation.
- Active statuses should include at least:
  - `active`
  - possibly `trialing` if trials are later enabled
- Non-active statuses:
  - `canceled`
  - `incomplete_expired`
  - `unpaid`
  - optionally `past_due` should probably not be Premium unless intentionally allowed.

Webhook handling:

- Add route `POST /stripe/webhook`.
- Verify signature from `Stripe-Signature` header.
- Store event in `webhook_events` before/while processing to make handling idempotent.
- On `checkout.session.completed`:
  - read `steam_id`, `plan_id`, `customer`, `subscription`, `payment_status`, and `url/session id`.
  - retrieve subscription if needed for period dates.
  - write `stripe_customer_id` and `stripe_subscription_id` to `subscriptions`.
  - activate subscription if Stripe subscription is active or paid enough for access.
  - update payment row to `paid` or appropriate status.
  - sync Discord Premium role.
- On `customer.subscription.updated`:
  - find by `stripe_subscription_id` or metadata `steam_id`.
  - update plan/status/current period dates/cancel-at-period-end.
  - grant/revoke Discord role based on active state.
- On `customer.subscription.deleted`:
  - mark subscription expired/cancelled according to Stripe status and period end.
  - revoke Discord role when access is no longer active.
- On `invoice.payment_succeeded`:
  - update or insert payment row for the invoice.
  - ensure subscription remains active.
- On `invoice.payment_failed`:
  - update payment row to failed.
  - update subscription status if Stripe subscription is not active.

Update Billing Portal:

- Keep `/subscription/portal`.
- Require active Premium subscription before opening portal, as currently implemented.
- Use stored `stripe_customer_id` or resolve by Steam metadata.
- For `payment_method_update`, continue setting `flow_data[type]=payment_method_update`.
- For manage flow, use a normal portal session.

Update status endpoint:

- `GET /subscription/status` should report status from D1, which is maintained by Stripe webhooks.
- Optionally reconcile with Stripe when a stored subscription exists and the row is stale.
- Return latest Stripe payment/invoice info using the existing `latestPayment` frontend shape.

Update return page:

- Remove SumUp wording.
- Message should say Stripe checkout completed/cancelled and instruct the user to return to GhostBox.

## Frontend Changes

File: `src/components/subscription/SubscriptionPlans.tsx`

- Keep checkout button behavior because it already opens `payment.hostedCheckoutUrl`.
- Remove PIX-specific branch because Stripe Checkout URL should always exist.
- Keep portal button behavior.
- Improve error handling if Stripe returns no URL.

File: `src/lib/ghostboxApi.types.ts`

- Update `SubscriptionPayment` fields to be Stripe-neutral/Stripe-specific.
- Remove `pixCode` and `pixQrCodeUrl` from active usage.
- Add optional fields:
  - `provider?: "stripe"`
  - `stripeCheckoutSessionId?: string | null`
  - `stripeInvoiceId?: string | null`
  - `stripeSubscriptionId?: string | null`

File: `src/lib/ghostboxApi.tauri.ts`

- Existing `createSubscriptionCheckout()` can remain because endpoint path and result shape stay compatible.
- No SumUp-specific logic should remain.

File: `src/i18n.ts`

Replace all user-facing SumUp strings with Stripe:

- `Checkout seguro via SumUp` -> `Checkout seguro via Stripe`
- `Secure checkout via SumUp` -> `Secure checkout via Stripe`
- payment/refund/provider copy should say Stripe.
- billing copy should say terms appear in Stripe Checkout.
- receipt copy should say receipts/status/refunds are linked to Stripe.

File: `POLICIES.md`

- Confirm it contains only Stripe wording for subscriptions and refunds.
- Remove SumUp if any remains.

## Tauri Changes

File: `src-tauri/src/subscription.rs`

- Keep command names stable:
  - `subscription_create_checkout`
  - `subscription_get_status`
  - `subscription_refresh_status`
- Update `SubscriptionPayment` struct:
  - remove or make optional old PIX fields.
  - add optional Stripe fields.
- Ensure `hosted_checkout_url` still deserializes from `hostedCheckoutUrl`.
- `subscription_refresh_status` may remain for checkout session refresh, but should call a Stripe-backed endpoint.

## Documentation Changes

File: `workers/subscriptions/README.md`

- Remove SumUp secrets.
- Add Stripe secrets.
- Document `/stripe/webhook`.
- Document Customer Portal setup.
- Document sandbox-to-production migration steps.

File: `workers/subscriptions/wrangler.toml`

- Remove SumUp variables if any are added later.
- Keep only non-secret static Stripe return URL if desired.

## Remote Cleanup After Implementation

After implementation is merged and deployed:

1. Apply D1 migration remotely:

```powershell
npx wrangler d1 migrations apply ghostbox-subscriptions --remote --config workers/subscriptions/wrangler.toml
```

2. Set sandbox Stripe secrets:

```powershell
npx wrangler secret put STRIPE_SECRET_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config workers/subscriptions/wrangler.toml
```

3. Remove SumUp secrets from the Worker after confirming Stripe works:

```powershell
npx wrangler secret delete SUMUP_API_KEY --config workers/subscriptions/wrangler.toml
npx wrangler secret delete SUMUP_MERCHANT_CODE --config workers/subscriptions/wrangler.toml
```

4. Deploy Worker:

```powershell
npx wrangler deploy --config workers/subscriptions/wrangler.toml
```

5. Configure Stripe sandbox webhook endpoint in the Stripe dashboard.

6. Run a full sandbox purchase test.

## Verification Checklist

Local/static verification:

- `npm run build`
- TypeScript passes.
- Tauri Rust compile passes via normal Tauri build path if feasible.
- Grep confirms no user-facing SumUp text remains:

```powershell
rg -i "sumup" src workers/subscriptions POLICIES.md README.md
```

Allowed temporary SumUp matches after first implementation should be only historical migration comments or deliberately retained old DB column names. Final target is no active SumUp code path.

Remote verification:

- `GET /health` returns ok.
- `POST /subscription/checkouts` returns Stripe checkout URL.
- Stripe checkout opens in sandbox.
- Completing sandbox payment triggers `/stripe/webhook`.
- `GET /subscription/status?steamId=...` returns active Premium.
- Discord Premium role sync still works.
- Settings button `Gerenciar assinatura` opens Stripe Billing Portal.
- Settings button `Alterar método de pagamento` opens Stripe payment method update flow.
- Cancelling in Stripe Portal keeps Premium active until period end.
- After period end or subscription deletion, Premium expires and Discord role is revoked.

## Risks And Decisions

- Existing active D1 subscription: there is currently one active row. Decide whether to migrate it manually to Stripe sandbox, expire it, or leave it until replaced by a real Stripe checkout.
- Existing `payments` rows: there are 13 old unpaid rows. They can remain as historical data but should not influence Stripe subscription status.
- `price_data` is good for sandbox and early production, but Stripe Dashboard Price IDs are cleaner for long-term analytics and product management.
- Webhook signature verification is mandatory before production.
- Billing Portal requires Stripe Customer Portal configuration in the Stripe dashboard, even if API code is correct.
