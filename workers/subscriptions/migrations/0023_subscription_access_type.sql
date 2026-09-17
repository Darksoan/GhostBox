-- Lifetime grants are entitlements, not Stripe subscriptions. Keep that
-- distinction explicit so billing actions are never inferred from a far-away
-- period end date at runtime.
ALTER TABLE subscriptions ADD COLUMN access_type TEXT NOT NULL DEFAULT 'stripe'
  CHECK (access_type IN ('stripe', 'lifetime'));

-- Existing lifetime grants used 2099 as their sentinel and have no confirmed
-- payment. Remove stale test-mode Stripe links while preserving Premium access.
UPDATE subscriptions
SET access_type = 'lifetime',
    stripe_customer_id = NULL,
    stripe_subscription_id = NULL,
    stripe_subscription_status = NULL,
    stripe_payment_method_json = NULL,
    stripe_payment_method_updated_at = NULL,
    cancel_at_period_end = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'active'
  AND current_period_end >= '2099-01-01T00:00:00.000Z'
  AND last_payment_id IS NULL;
