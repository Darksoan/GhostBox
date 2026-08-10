-- Payment flow hardening.
--
-- webhook_events used to double as "seen" and "handled": the row was inserted
-- before the event was processed, and every handler swallowed its exception and
-- answered 200. A failure therefore burned the event permanently — Stripe saw
-- success and never retried, so a paid checkout could vanish. processed_at
-- splits the two states so a failed attempt is retried on redelivery.
ALTER TABLE webhook_events ADD COLUMN processed_at TEXT;
ALTER TABLE webhook_events ADD COLUMN stripe_event_created INTEGER;
ALTER TABLE webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN last_error TEXT;

-- Everything already stored was answered with a 200 and will never be
-- redelivered, so mark it handled instead of letting a redelivery reprocess
-- history.
UPDATE webhook_events SET processed_at = created_at WHERE processed_at IS NULL;

-- Stripe does not guarantee webhook ordering. Without a watermark a delayed
-- customer.subscription.updated can resurrect a subscription that a later
-- .deleted already cancelled.
ALTER TABLE subscriptions ADD COLUMN stripe_event_created INTEGER;

-- The subscription screen polls /subscription/status every 10s; resolving the
-- card from Stripe on each poll would hit rate limits, so it is cached here.
ALTER TABLE subscriptions ADD COLUMN stripe_payment_method_json TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_payment_method_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at);
