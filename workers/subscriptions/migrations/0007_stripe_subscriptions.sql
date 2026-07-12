-- Migration to add Stripe subscription and payment columns
ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_subscription_status TEXT;
ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
  ON subscriptions(stripe_subscription_id);

ALTER TABLE payments ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE payments ADD COLUMN stripe_invoice_id TEXT;
ALTER TABLE payments ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE payments ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE payments ADD COLUMN provider TEXT;
ALTER TABLE payments ADD COLUMN provider_payload TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_session_id
  ON payments(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_invoice_id
  ON payments(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscription_id
  ON payments(stripe_subscription_id);
