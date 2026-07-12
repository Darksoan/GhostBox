-- Stripe customer id for Billing Portal (manage subscription / payment method).
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
  ON subscriptions(stripe_customer_id);
