-- Pix arrives through Cakto while cards stay on Stripe, so a row can no longer
-- be assumed to belong to Stripe.
--
-- `subscriptions.provider` is what the app reads to decide which panel to
-- render: a Stripe subscription shows "next billing" and the billing portal,
-- while a Pix period shows "access until" and a renew button — Cakto has no
-- portal and Pix here never renews itself. NULL means a row written before this
-- migration, which is always a Stripe card.
ALTER TABLE subscriptions ADD COLUMN provider TEXT;

-- Cakto's order id. Kept in its own column instead of reusing checkout_id
-- because the webhook and the app's poll both look a payment up by it, and a
-- shared column would need an OR across two providers' id spaces.
ALTER TABLE payments ADD COLUMN cakto_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_cakto_order_id ON payments(cakto_order_id);
