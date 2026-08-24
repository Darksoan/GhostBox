/**
 * A tiny stand-in for D1.
 *
 * It is not a SQL engine: each statement the tests exercise is matched by
 * shape and applied to in-memory rows. Anything unrecognised throws, so a
 * handler that starts issuing new SQL fails the test loudly instead of
 * silently doing nothing.
 */

export type Row = Record<string, any>;

type Handler = (binds: any[], db: FakeD1) => { results?: Row[]; changes: number };

type Rule = { pattern: RegExp; run: Handler };

function normalize(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

const rules: Rule[] = [
  {
    pattern: /^INSERT OR IGNORE INTO webhook_events \(id, event_type, stripe_event_created, payload\)/i,
    run: ([id, eventType, eventCreated, payload], db) => {
      if (db.rows("webhook_events").some((row) => row.id === id)) return { changes: 0 };
      db.rows("webhook_events").push({
        id,
        event_type: eventType,
        stripe_event_created: eventCreated,
        payload,
        processed_at: null,
        attempts: 0,
        last_error: null,
        created_at: new Date().toISOString(),
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT processed_at FROM webhook_events WHERE id = \?/i,
    run: ([id], db) => {
      const row = db.rows("webhook_events").find((entry) => entry.id === id);
      return { results: row ? [{ processed_at: row.processed_at }] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE webhook_events SET attempts = attempts \+ 1, last_error = \?/i,
    run: ([lastError, id], db) => {
      const row = db.rows("webhook_events").find((entry) => entry.id === id);
      if (!row) return { changes: 0 };
      row.attempts += 1;
      row.last_error = lastError;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE webhook_events SET processed_at = \?/i,
    run: ([processedAt, id], db) => {
      const row = db.rows("webhook_events").find((entry) => entry.id === id);
      if (!row) return { changes: 0 };
      row.processed_at = processedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE payments SET status = 'expired', updated_at = \? WHERE stripe_checkout_session_id = \? AND status = 'pending'/i,
    run: ([updatedAt, sessionId], db) => {
      let changes = 0;
      for (const row of db.rows("payments")) {
        if (row.stripe_checkout_session_id === sessionId && row.status === "pending") {
          row.status = "expired";
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      db.count("payments.expire");
      return { changes };
    },
  },
  {
    pattern: /^UPDATE payments SET status = 'paid', confirmed_at = \?, updated_at = \?, stripe_subscription_id = COALESCE/i,
    run: ([confirmedAt, updatedAt, subscriptionId, sessionId], db) => {
      let changes = 0;
      for (const row of db.rows("payments")) {
        if (row.stripe_checkout_session_id === sessionId && row.status !== "paid") {
          row.status = "paid";
          row.confirmed_at = confirmedAt;
          row.updated_at = updatedAt;
          row.stripe_subscription_id = row.stripe_subscription_id ?? subscriptionId;
          row.provider = "stripe";
          changes += 1;
        }
      }
      db.count("payments.pay");
      return { changes };
    },
  },
  {
    pattern: /^UPDATE payments SET status = 'paid', provider = 'stripe', confirmed_at = \?, updated_at = \?, stripe_subscription_id = COALESCE\(stripe_subscription_id, \?\) WHERE id = \?/i,
    run: ([confirmedAt, updatedAt, subscriptionId, paymentId], db) => {
      const row = db.rows("payments").find((entry) => entry.id === paymentId);
      if (!row) return { changes: 0 };
      row.status = "paid";
      row.provider = "stripe";
      row.confirmed_at = confirmedAt;
      row.updated_at = updatedAt;
      row.stripe_subscription_id = row.stripe_subscription_id ?? subscriptionId;
      db.count("payments.pay");
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT id FROM payments WHERE stripe_checkout_session_id = \?/i,
    run: ([sessionId], db) => {
      const row = db.rows("payments").find((entry) => entry.stripe_checkout_session_id === sessionId);
      return { results: row ? [{ id: row.id }] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM payments WHERE checkout_id = \? OR checkout_reference = \? OR stripe_checkout_session_id = \?/i,
    run: ([checkoutId, reference, sessionId], db) => {
      const row = db.rows("payments").find(
        (entry) =>
          entry.checkout_id === checkoutId ||
          entry.checkout_reference === reference ||
          entry.stripe_checkout_session_id === sessionId
      );
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE subscriptions SET user_id = \?, updated_at = \? WHERE steam_id = \? AND user_id IS NULL/i,
    run: ([userId, updatedAt, steamId], db) => {
      let changes = 0;
      for (const row of db.rows("subscriptions")) {
        if (row.steam_id === steamId && !row.user_id) {
          row.user_id = userId;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { changes };
    },
  },
  {
    pattern: /^INSERT INTO subscriptions \(/i,
    run: (binds, db) => {
      const [
        steamId,
        userId,
        planId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        lastPaymentId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeSubscriptionStatus,
        cancelAtPeriodEnd,
        eventCreated,
        createdAt,
        updatedAt,
      ] = binds;

      const existing = db
        .rows("subscriptions")
        .find((row) => (userId ? row.user_id === userId : row.steam_id === steamId));

      if (!existing) {
        db.rows("subscriptions").push({
          steam_id: steamId,
          user_id: userId,
          plan_id: planId,
          status,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          last_payment_id: lastPaymentId,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          stripe_subscription_status: stripeSubscriptionStatus,
          cancel_at_period_end: cancelAtPeriodEnd,
          stripe_event_created: eventCreated,
          stripe_payment_method_json: null,
          stripe_payment_method_updated_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { changes: 1 };
      }

      // Mirrors the WHERE guard on the ON CONFLICT clause: an older event must
      // not overwrite newer state.
      if ((existing.stripe_event_created ?? 0) > eventCreated) return { changes: 0 };

      existing.steam_id = steamId ?? existing.steam_id;
      existing.user_id = userId ?? existing.user_id;
      existing.plan_id = planId;
      existing.status = status;
      existing.current_period_start = currentPeriodStart ?? existing.current_period_start;
      existing.current_period_end = currentPeriodEnd ?? existing.current_period_end;
      existing.last_payment_id = lastPaymentId ?? existing.last_payment_id;
      existing.stripe_customer_id = stripeCustomerId ?? existing.stripe_customer_id;
      existing.stripe_subscription_id = stripeSubscriptionId ?? existing.stripe_subscription_id;
      existing.stripe_subscription_status = stripeSubscriptionStatus ?? existing.stripe_subscription_status;
      existing.cancel_at_period_end = cancelAtPeriodEnd;
      existing.stripe_event_created = eventCreated;
      existing.updated_at = updatedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE subscriptions SET status = 'expired', stripe_subscription_status = \?, updated_at = \? WHERE user_id = \?/i,
    run: ([stripeStatus, updatedAt, userId, stripeSubscriptionId], db) => {
      let changes = 0;
      for (const row of db.rows("subscriptions")) {
        const matchesSubscription =
          row.stripe_subscription_id === stripeSubscriptionId || row.stripe_subscription_id == null;
        if (row.user_id === userId && matchesSubscription) {
          row.status = "expired";
          row.stripe_subscription_status = stripeStatus;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { changes };
    },
  },
  {
    pattern: /^SELECT \* FROM subscriptions WHERE user_id = \?/i,
    run: ([userId], db) => {
      const row = db.rows("subscriptions").find((entry) => entry.user_id === userId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT user_id, steam_id(, plan_id)? FROM subscriptions WHERE stripe_subscription_id = \?/i,
    run: ([subscriptionId], db) => {
      const row = db.rows("subscriptions").find((entry) => entry.stripe_subscription_id === subscriptionId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE subscriptions SET status = 'expired', updated_at = \? WHERE user_id = \?/i,
    run: ([updatedAt, userId], db) => {
      let changes = 0;
      for (const row of db.rows("subscriptions")) {
        if (row.user_id === userId) {
          row.status = "expired";
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { changes };
    },
  },
  {
    pattern: /^UPDATE subscriptions SET stripe_payment_method_json = \?, stripe_payment_method_updated_at = \?/i,
    run: ([json, updatedAt, value], db) => {
      let changes = 0;
      for (const row of db.rows("subscriptions")) {
        if (row.user_id === value || row.steam_id === value) {
          row.stripe_payment_method_json = json;
          row.stripe_payment_method_updated_at = updatedAt;
          changes += 1;
        }
      }
      return { changes };
    },
  },
  {
    pattern: /^DELETE FROM discord_links WHERE discord_user_id = \? AND \(user_id IS NULL OR user_id <> \?\)/i,
    run: ([discordUserId, userId], db) => {
      const rows = db.rows("discord_links");
      const kept = rows.filter(
        (entry) => !(entry.discord_user_id === discordUserId && entry.user_id !== userId)
      );
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },
  {
    pattern: /^INSERT INTO discord_links \(/i,
    run: ([userId, discordUserId, username, globalName, linkedAt, updatedAt], db) => {
      // discord_user_id is UNIQUE in the schema and the ON CONFLICT clause only
      // covers user_id, so a row holding this Discord under another account
      // makes the real INSERT fail. Reproduced here on purpose.
      const conflicting = db
        .rows("discord_links")
        .find((entry) => entry.discord_user_id === discordUserId && entry.user_id !== userId);
      if (conflicting) {
        throw new Error("UNIQUE constraint failed: discord_links.discord_user_id");
      }

      const existing = db.rows("discord_links").find((entry) => entry.user_id === userId);
      if (existing) {
        existing.discord_user_id = discordUserId;
        existing.discord_username = username;
        existing.discord_global_name = globalName;
        existing.linked_at = linkedAt;
        existing.updated_at = updatedAt;
        return { changes: 1 };
      }

      db.rows("discord_links").push({
        steam_id: null,
        user_id: userId,
        discord_user_id: discordUserId,
        discord_username: username,
        discord_global_name: globalName,
        linked_at: linkedAt,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^DELETE FROM user_connections WHERE provider = 'discord' AND provider_id = \? AND user_id <> \?/i,
    run: ([providerId, userId], db) => {
      const rows = db.rows("user_connections");
      const kept = rows.filter(
        (entry) =>
          !(entry.provider === "discord" && entry.provider_id === providerId && entry.user_id !== userId)
      );
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },
  {
    // Only the Discord upsert: the Steam one shares this shape but writes a
    // different provider, so it needs its own rule if a test ever exercises it.
    pattern: /^INSERT INTO user_connections \(user_id, provider, provider_id, metadata_json, linked_at\) VALUES \(\?, 'discord'/i,
    run: ([userId, providerId, metadataJson, linkedAt], db) => {
      const existing = db
        .rows("user_connections")
        .find((entry) => entry.user_id === userId && entry.provider === "discord");
      if (existing) {
        existing.provider_id = providerId;
        existing.metadata_json = metadataJson;
        existing.linked_at = linkedAt;
        return { changes: 1 };
      }

      db.rows("user_connections").push({
        user_id: userId,
        provider: "discord",
        provider_id: providerId,
        metadata_json: metadataJson,
        linked_at: linkedAt,
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT \* FROM discord_links WHERE user_id = \?/i,
    run: ([userId], db) => {
      const row = db.rows("discord_links").find((entry) => entry.user_id === userId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT provider_id FROM user_connections WHERE user_id = \? AND provider = 'steam'/i,
    run: ([userId], db) => {
      const row = db
        .rows("user_connections")
        .find((entry) => entry.user_id === userId && entry.provider === "steam");
      return { results: row ? [{ provider_id: row.provider_id }] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM payments WHERE user_id = \? ORDER BY created_at DESC/i,
    run: ([userId], db) => {
      const rows = db
        .rows("payments")
        .filter((entry) => entry.user_id === userId)
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
      return { results: rows.slice(0, 1), changes: 0 };
    },
  },
];

export class FakeD1 {
  private tables = new Map<string, Row[]>();
  private counters = new Map<string, number>();
  /** Every statement executed, for assertions about what did or did not run. */
  readonly executed: string[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(table, rows.map((row) => ({ ...row })));
    }
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  count(key: string) {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  counted(key: string) {
    return this.counters.get(key) ?? 0;
  }

  prepare(sql: string) {
    const normalized = normalize(sql);
    const self = this;
    let binds: any[] = [];

    const statement = {
      bind(...args: any[]) {
        binds = args;
        return statement;
      },
      async run() {
        const { changes } = self.execute(normalized, binds);
        return { success: true, meta: { changes } };
      },
      async first<T = Row>() {
        const { results } = self.execute(normalized, binds);
        return (results?.[0] as T) ?? null;
      },
      async all<T = Row>() {
        const { results } = self.execute(normalized, binds);
        return { results: (results ?? []) as T[], success: true };
      },
    };

    return statement;
  }

  private execute(sql: string, binds: any[]) {
    this.executed.push(sql);
    const rule = rules.find((entry) => entry.pattern.test(sql));
    if (!rule) throw new Error(`FakeD1: unhandled statement\n${sql}`);
    return rule.run(binds, this);
  }
}

export function fakeD1(seed: Record<string, Row[]> = {}) {
  return new FakeD1(seed) as unknown as D1Database & FakeD1;
}
