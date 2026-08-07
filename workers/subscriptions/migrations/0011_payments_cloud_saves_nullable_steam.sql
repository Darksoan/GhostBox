-- payments.steam_id and cloud_saves.steam_id were declared NOT NULL, which
-- blocks a Firebase-only account (no Steam connection) from ever buying
-- Premium or storing a save. SQLite can't ALTER a column's NOT NULL, so
-- rebuild both tables with steam_id optional and user_id added directly.

CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  checkout_reference TEXT NOT NULL UNIQUE,
  checkout_id TEXT UNIQUE,
  steam_id TEXT,
  user_id TEXT,
  plan_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  hosted_checkout_url TEXT,
  sumup_payload TEXT,
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_subscription_id TEXT,
  provider TEXT,
  provider_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at TEXT
);

INSERT INTO payments_new (
  id, checkout_reference, checkout_id, steam_id, plan_id, amount_cents, currency, status,
  hosted_checkout_url, sumup_payload, stripe_checkout_session_id, stripe_invoice_id,
  stripe_payment_intent_id, stripe_subscription_id, provider, provider_payload,
  created_at, updated_at, confirmed_at
)
SELECT
  id, checkout_reference, checkout_id, steam_id, plan_id, amount_cents, currency, status,
  hosted_checkout_url, sumup_payload, stripe_checkout_session_id, stripe_invoice_id,
  stripe_payment_intent_id, stripe_subscription_id, provider, provider_payload,
  created_at, updated_at, confirmed_at
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

CREATE INDEX IF NOT EXISTS idx_payments_steam_id ON payments(steam_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_checkout_id ON payments(checkout_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_session_id ON payments(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_invoice_id ON payments(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscription_id ON payments(stripe_subscription_id);

CREATE TABLE cloud_saves_new (
  id TEXT PRIMARY KEY,
  steam_id TEXT,
  user_id TEXT,
  app_id TEXT NOT NULL,
  game_title TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  manifest_json TEXT,
  device_name TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO cloud_saves_new (
  id, steam_id, app_id, game_title, storage_path, size_bytes, sha256, manifest_json,
  device_name, pinned, created_at, updated_at
)
SELECT
  id, steam_id, app_id, game_title, storage_path, size_bytes, sha256, manifest_json,
  device_name, pinned, created_at, updated_at
FROM cloud_saves;

DROP TABLE cloud_saves;
ALTER TABLE cloud_saves_new RENAME TO cloud_saves;

CREATE INDEX IF NOT EXISTS idx_cloud_saves_steam_app ON cloud_saves(steam_id, app_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_saves_steam_updated ON cloud_saves(steam_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_saves_user_app ON cloud_saves(user_id, app_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_saves_user_updated ON cloud_saves(user_id, updated_at DESC);
