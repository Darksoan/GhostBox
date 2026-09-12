/**
 * A tiny stand-in for D1.
 *
 * It is not a SQL engine: each statement the tests exercise is matched by
 * shape and applied to in-memory rows. Anything unrecognised throws, so a
 * handler that starts issuing new SQL fails the test loudly instead of
 * silently doing nothing.
 */

export type Row = Record<string, any>;

type Handler = (binds: any[], db: FakeD1) => { results?: Row[]; changes: number; rowsWritten?: number };

type Rule = { pattern: RegExp; run: Handler };

export type ExecEntry = { sql: string; binds: any[]; changes: number; rowsWritten: number };
export type BatchEntry = {
  sqls: string[];
  binds: any[][];
  results: Array<{ changes: number; rowsWritten: number }>;
};

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
    pattern: /^UPDATE subscriptions SET stripe_payment_method_json = NULL, stripe_payment_method_updated_at = NULL/i,
    run: ([value], db) => {
      let changes = 0;
      for (const row of db.rows("subscriptions")) {
        if (row.user_id === value || row.steam_id === value) {
          if (row.stripe_payment_method_json !== null || row.stripe_payment_method_updated_at !== null) {
            row.stripe_payment_method_json = null;
            row.stripe_payment_method_updated_at = null;
            changes += 1;
          }
        }
      }
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^UPDATE subscriptions SET stripe_payment_method_json = \?, stripe_payment_method_updated_at = \?/i,
    run: ([json, updatedAt, value, observed], db) => {
      let changes = 0;
      const useCas = observed !== undefined;
      for (const row of db.rows("subscriptions")) {
        if (row.user_id === value || row.steam_id === value) {
          if (useCas) {
            const current = row.stripe_payment_method_updated_at ?? null;
            if (current !== observed) continue;
          }
          row.stripe_payment_method_json = json;
          row.stripe_payment_method_updated_at = updatedAt;
          changes += 1;
        }
      }
      db.count("subscriptions.payment_cache");
      return { changes, rowsWritten: changes };
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

  // ---- accounts ----
  {
    pattern: /^SELECT \* FROM accounts WHERE user_id = \?/i,
    run: ([userId], db) => {
      const row = db.rows("accounts").find((entry) => entry.user_id === userId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM accounts WHERE username = \? COLLATE NOCASE/i,
    run: ([username], db) => {
      const row = db
        .rows("accounts")
        .find((entry) => String(entry.username).toLowerCase() === String(username).toLowerCase());
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM accounts WHERE email = \?/i,
    run: ([email], db) => {
      const row = db.rows("accounts").find((entry) => entry.email === email);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^INSERT INTO accounts \(user_id, email, username, display_name, email_verified, verified_via, created_at, updated_at\)/i,
    run: ([userId, email, username, displayName, emailVerified, verifiedVia, createdAt, updatedAt], db) => {
      db.rows("accounts").push({
        user_id: userId,
        email,
        username,
        display_name: displayName,
        email_verified: emailVerified,
        verified_via: verifiedVia,
        token_version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE accounts SET token_version = token_version \+ 1, updated_at = \? WHERE user_id = \? RETURNING token_version/i,
    run: ([updatedAt, userId], db) => {
      const row = db.rows("accounts").find((entry) => entry.user_id === userId);
      if (!row) return { results: [], changes: 0 };
      row.token_version = (row.token_version ?? 1) + 1;
      row.updated_at = updatedAt;
      return { results: [{ token_version: row.token_version }], changes: 1 };
    },
  },
  {
    pattern: /^UPDATE accounts SET email_verified = 1, verified_via = 'email'/i,
    run: ([updatedAt, userId], db) => {
      const row = db.rows("accounts").find((entry) => entry.user_id === userId);
      if (!row) return { changes: 0 };
      row.email_verified = 1;
      row.verified_via = "email";
      row.updated_at = updatedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE accounts SET verified_via = 'discord'/i,
    run: ([updatedAt, userId], db) => {
      const row = db.rows("accounts").find((entry) => entry.user_id === userId);
      if (!row) return { changes: 0 };
      row.verified_via = "discord";
      row.updated_at = updatedAt;
      return { changes: 1 };
    },
  },

  {
    pattern: /^UPDATE accounts SET verified_via = NULL, updated_at = \? WHERE user_id = \? AND verified_via = 'discord'/i,
    run: ([updatedAt, userId], db) => {
      const row = db
        .rows("accounts")
        .find((entry) => entry.user_id === userId && entry.verified_via === "discord");
      if (!row) return { changes: 0 };
      row.verified_via = null;
      row.updated_at = updatedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT user_id FROM user_connections WHERE provider = 'discord' AND provider_id = \? AND user_id <> \?/i,
    run: ([providerId, userId], db) => {
      const row = db
        .rows("user_connections")
        .find(
          (entry) =>
            entry.provider === "discord" && entry.provider_id === providerId && entry.user_id !== userId
        );
      return { results: row ? [{ user_id: row.user_id }] : [], changes: 0 };
    },
  },

  // ---- security trail ----
  {
    pattern: /^INSERT INTO security_events \(id, user_id, kind, provider, ip_prefix, created_at\)/i,
    run: ([id, userId, kind, provider, ipPrefix, createdAt], db) => {
      db.rows("security_events").push({
        id,
        user_id: userId,
        kind,
        provider,
        ip_prefix: ipPrefix,
        created_at: createdAt,
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT kind, provider, ip_prefix, created_at FROM security_events WHERE user_id = \?/i,
    run: ([userId], db) => {
      const rows = db
        .rows("security_events")
        .filter((entry) => entry.user_id === userId)
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
        .slice(0, 20)
        .map(({ kind, provider, ip_prefix, created_at }) => ({ kind, provider, ip_prefix, created_at }));
      return { results: rows, changes: 0 };
    },
  },
  {
    pattern: /^DELETE FROM security_events WHERE created_at < \?/i,
    run: ([cutoff], db) => {
      const rows = db.rows("security_events");
      const kept = rows.filter((entry) => String(entry.created_at) >= String(cutoff));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },

  // ---- auth rate limiting ----
  {
    pattern: /^INSERT INTO auth_attempts \(id, ip, kind, created_at\)/i,
    run: ([id, ip, kind, createdAt], db) => {
      db.rows("auth_attempts").push({ id, ip, kind, created_at: createdAt });
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT COUNT\(\*\) AS count FROM auth_attempts WHERE ip = \? AND kind = \? AND created_at >= \?/i,
    run: ([ip, kind, since], db) => {
      const count = db
        .rows("auth_attempts")
        .filter((entry) => entry.ip === ip && entry.kind === kind && String(entry.created_at) >= String(since)).length;
      return { results: [{ count }], changes: 0 };
    },
  },

  // ---- Discord login tickets ----
  {
    pattern: /^INSERT INTO discord_login_tickets \(/i,
    run: (binds, db) => {
      const [
        ticketHash,
        userId,
        provider,
        purpose,
        appNonce,
        discordUserId,
        discordUsername,
        discordGlobalName,
        discordEmail,
        discordEmailVerified,
        expiresAt,
        createdAt,
      ] = binds;
      db.rows("discord_login_tickets").push({
        ticket_hash: ticketHash,
        user_id: userId,
        provider,
        purpose,
        app_nonce: appNonce,
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        discord_global_name: discordGlobalName,
        discord_email: discordEmail,
        discord_email_verified: discordEmailVerified,
        expires_at: expiresAt,
        consumed_at: null,
        created_at: createdAt,
      });
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT \* FROM discord_login_tickets WHERE ticket_hash = \?/i,
    run: ([ticketHash], db) => {
      const row = db.rows("discord_login_tickets").find((entry) => entry.ticket_hash === ticketHash);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE discord_login_tickets SET consumed_at = \? WHERE ticket_hash = \? AND consumed_at IS NULL/i,
    run: ([consumedAt, ticketHash], db) => {
      const row = db
        .rows("discord_login_tickets")
        .find((entry) => entry.ticket_hash === ticketHash && !entry.consumed_at);
      if (!row) return { changes: 0 };
      row.consumed_at = consumedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE discord_login_tickets SET expires_at = \? WHERE ticket_hash = \?/i,
    run: ([expiresAt, ticketHash], db) => {
      const row = db.rows("discord_login_tickets").find((entry) => entry.ticket_hash === ticketHash);
      if (!row) return { changes: 0 };
      row.expires_at = expiresAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^DELETE FROM discord_login_tickets WHERE expires_at < \?/i,
    run: ([cutoff], db) => {
      const rows = db.rows("discord_login_tickets");
      const kept = rows.filter((entry) => String(entry.expires_at) >= String(cutoff));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },

  // ---- Discord DM verification codes ----
  {
    pattern: /^INSERT INTO discord_verification_codes \(/i,
    run: ([userId, codeHash, discordUserId, expiresAt, createdAt], db) => {
      const rows = db.rows("discord_verification_codes");
      const existing = rows.find((entry) => entry.user_id === userId);
      const next = {
        user_id: userId,
        code_hash: codeHash,
        discord_user_id: discordUserId,
        attempts: 0,
        expires_at: expiresAt,
        created_at: createdAt,
      };
      if (existing) Object.assign(existing, next);
      else rows.push(next);
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT \* FROM discord_verification_codes WHERE user_id = \?/i,
    run: ([userId], db) => {
      const row = db.rows("discord_verification_codes").find((entry) => entry.user_id === userId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE discord_verification_codes SET attempts = attempts \+ 1 WHERE user_id = \?/i,
    run: ([userId], db) => {
      const row = db.rows("discord_verification_codes").find((entry) => entry.user_id === userId);
      if (!row) return { changes: 0 };
      row.attempts += 1;
      return { changes: 1 };
    },
  },
  {
    pattern: /^DELETE FROM discord_verification_codes WHERE user_id = \?/i,
    run: ([userId], db) => {
      const rows = db.rows("discord_verification_codes");
      const kept = rows.filter((entry) => entry.user_id !== userId);
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },
  {
    pattern: /^DELETE FROM discord_verification_codes WHERE expires_at < \?/i,
    run: ([cutoff], db) => {
      const rows = db.rows("discord_verification_codes");
      const kept = rows.filter((entry) => String(entry.expires_at) >= String(cutoff));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },

  {
    pattern: /^SELECT provider FROM user_connections WHERE user_id = \?$/i,
    run: ([userId], db) => {
      const rows = db
        .rows("user_connections")
        .filter((entry) => entry.user_id === userId)
        .map((entry) => ({ provider: entry.provider }));
      return { results: rows, changes: 0 };
    },
  },
  {
    // The provider-neutral lookup: same shape as the Discord-only rule above,
    // but the provider arrives as a bind rather than baked into the SQL.
    pattern: /^SELECT \* FROM user_connections WHERE provider = \? AND provider_id = \?/i,
    run: ([provider, providerId], db) => {
      const row = db
        .rows("user_connections")
        .find((entry) => entry.provider === provider && entry.provider_id === providerId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^UPDATE user_connections SET metadata_json = \? WHERE user_id = \? AND provider = \? AND provider_id = \?/i,
    run: ([metadataJson, userId, provider, providerId], db) => {
      const row = db.rows("user_connections").find(
        (entry) =>
          entry.user_id === userId &&
          entry.provider === provider &&
          entry.provider_id === providerId,
      );
      if (!row) return { changes: 0 };
      row.metadata_json = metadataJson;
      return { changes: 1 };
    },
  },
  {
    pattern: /^UPDATE discord_links SET discord_username = \?, discord_global_name = \?, updated_at = \? WHERE user_id = \? AND discord_user_id = \?/i,
    run: ([username, globalName, updatedAt, userId, discordUserId], db) => {
      const row = db.rows("discord_links").find(
        (entry) => entry.user_id === userId && entry.discord_user_id === discordUserId,
      );
      if (!row) return { changes: 0 };
      row.discord_username = username;
      row.discord_global_name = globalName;
      row.updated_at = updatedAt;
      return { changes: 1 };
    },
  },
  {
    pattern: /^SELECT user_id FROM user_connections WHERE provider = 'steam' AND provider_id = \?/i,
    run: ([providerId], db) => {
      const row = db
        .rows("user_connections")
        .find((entry) => entry.provider === "steam" && entry.provider_id === providerId);
      return { results: row ? [{ user_id: row.user_id }] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT provider, provider_id, metadata_json, linked_at FROM user_connections WHERE user_id = \?/i,
    run: ([userId], db) => {
      const rows = db.rows("user_connections").filter((entry) => entry.user_id === userId);
      return { results: rows, changes: 0 };
    },
  },
  {
    pattern: /^DELETE FROM user_connections WHERE user_id = \? AND provider = \?/i,
    run: ([userId, provider], db) => {
      const rows = db.rows("user_connections");
      const kept = rows.filter((entry) => !(entry.user_id === userId && entry.provider === provider));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },
  {
    pattern: /^DELETE FROM discord_links WHERE user_id = \?/i,
    run: ([userId], db) => {
      const rows = db.rows("discord_links");
      const kept = rows.filter((entry) => entry.user_id !== userId);
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes };
    },
  },

  // ---- Discord connections lookup ----
  {
    pattern: /^SELECT \* FROM user_connections WHERE provider = 'discord' AND provider_id = \?/i,
    run: ([providerId], db) => {
      const row = db
        .rows("user_connections")
        .find((entry) => entry.provider === "discord" && entry.provider_id === providerId);
      return { results: row ? [row] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM user_connections WHERE user_id = \? AND provider = 'discord'/i,
    run: ([userId], db) => {
      const row = db
        .rows("user_connections")
        .find((entry) => entry.user_id === userId && entry.provider === "discord");
      return { results: row ? [row] : [], changes: 0 };
    },
  },

  // ---- cloud profile reads ----
  {
    pattern: /^SELECT \* FROM user_profile_cloud WHERE user_id = \? LIMIT 1/i,
    run: ([userId], db) => {
      const row = db.rows("user_profile_cloud").find((entry) => entry.user_id === userId);
      return { results: row ? [{ ...row }] : [], changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM user_collections_cloud WHERE user_id = \? ORDER BY sort_order ASC, name ASC/i,
    run: ([userId], db) => {
      const rows = db
        .rows("user_collections_cloud")
        .filter((entry) => entry.user_id === userId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));
      return { results: rows.map((row) => ({ ...row })), changes: 0 };
    },
  },
  {
    pattern: /^SELECT \* FROM user_collection_games_cloud WHERE user_id = \? ORDER BY sort_order ASC/i,
    run: ([userId], db) => {
      const rows = db
        .rows("user_collection_games_cloud")
        .filter((entry) => entry.user_id === userId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      return { results: rows.map((row) => ({ ...row })), changes: 0 };
    },
  },
  {
    pattern: /^SELECT game_id FROM user_favorite_games_cloud WHERE user_id = \? ORDER BY sort_order ASC/i,
    run: ([userId], db) => {
      const rows = db
        .rows("user_favorite_games_cloud")
        .filter((entry) => entry.user_id === userId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      return { results: rows.map((row) => ({ game_id: row.game_id })), changes: 0 };
    },
  },

  // ---- cloud profile set-based writes ----
  {
    pattern: /^INSERT INTO user_profile_cloud \(/i,
    run: ([steamId, userId, displayName, avatarUrl, bannerUrl, x, y, scale, hiddenGameIds, updatedAt], db) => {
      const rows = db.rows("user_profile_cloud");
      const existing = rows.find((entry) => entry.user_id === userId);
      if (!existing) {
        rows.push({
          steam_id: steamId,
          user_id: userId,
          display_name: displayName,
          avatar_url: avatarUrl,
          banner_url: bannerUrl,
          banner_position_x: x,
          banner_position_y: y,
          banner_position_scale: scale,
          hidden_game_ids: hiddenGameIds,
          updated_at: updatedAt,
        });
        return { changes: 1, rowsWritten: 1 };
      }
      existing.steam_id = steamId ?? existing.steam_id;
      existing.display_name = displayName;
      existing.avatar_url = avatarUrl;
      existing.banner_url = bannerUrl;
      existing.banner_position_x = x;
      existing.banner_position_y = y;
      existing.banner_position_scale = scale;
      existing.hidden_game_ids = hiddenGameIds;
      existing.updated_at = updatedAt;
      return { changes: 1, rowsWritten: 1 };
    },
  },
  {
    pattern: /^DELETE FROM user_favorite_games_cloud WHERE user_id = \? AND NOT EXISTS \(SELECT 1 FROM json_each\(\?\)/i,
    run: ([userId, favoritesJson], db) => {
      const wanted = new Set<string>(JSON.parse(String(favoritesJson || "[]")));
      const rows = db.rows("user_favorite_games_cloud");
      const kept = rows.filter((entry) => entry.user_id !== userId || wanted.has(entry.game_id));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^INSERT INTO user_favorite_games_cloud \(steam_id, user_id, game_id, sort_order\)/i,
    run: ([steamId, userId, favoritesJson], db) => {
      const list = JSON.parse(String(favoritesJson || "[]")) as string[];
      const rows = db.rows("user_favorite_games_cloud");
      let changes = 0;
      list.forEach((gameId, index) => {
        const existing = rows.find((entry) => entry.user_id === userId && entry.game_id === gameId);
        if (!existing) {
          rows.push({ steam_id: steamId, user_id: userId, game_id: gameId, sort_order: index });
          changes += 1;
          return;
        }
        const steamChanged = steamId != null && existing.steam_id !== steamId;
        if (existing.sort_order !== index || steamChanged) {
          existing.sort_order = index;
          if (steamId != null) existing.steam_id = steamId;
          changes += 1;
        }
      });
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^DELETE FROM user_collection_games_cloud WHERE user_id = \? AND NOT EXISTS \(\s*SELECT 1 FROM json_each\(\?\)/i,
    run: ([userId, collectionsJson], db) => {
      const list = JSON.parse(String(collectionsJson || "[]")) as Array<{ id: string; games: string[] }>;
      const wanted = new Set(list.flatMap((entry) => entry.games.map((gameId) => `${entry.id}|${gameId}`)));
      const rows = db.rows("user_collection_games_cloud");
      const kept = rows.filter(
        (entry) => entry.user_id !== userId || wanted.has(`${entry.collection_id}|${entry.game_id}`)
      );
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^DELETE FROM user_collections_cloud WHERE user_id = \? AND NOT EXISTS \(SELECT 1 FROM json_each\(\?\)/i,
    run: ([userId, collectionsJson], db) => {
      const list = JSON.parse(String(collectionsJson || "[]")) as Array<{ id: string }>;
      const wanted = new Set(list.map((entry) => entry.id));
      const rows = db.rows("user_collections_cloud");
      const kept = rows.filter((entry) => entry.user_id !== userId || wanted.has(entry.id));
      const changes = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^INSERT INTO user_collections_cloud \(id, steam_id, user_id, name, sort_order, updated_at\)/i,
    run: ([steamId, userId, updatedAt, collectionsJson], db) => {
      const list = JSON.parse(String(collectionsJson || "[]")) as Array<{ id: string; name: string; o: number }>;
      const rows = db.rows("user_collections_cloud");
      let changes = 0;
      for (const entry of list) {
        const existing = rows.find((row) => row.user_id === userId && row.id === entry.id);
        if (!existing) {
          rows.push({
            id: entry.id,
            steam_id: steamId,
            user_id: userId,
            name: entry.name,
            sort_order: entry.o,
            updated_at: updatedAt,
          });
          changes += 1;
          continue;
        }
        const steamChanged = steamId != null && existing.steam_id !== steamId;
        if (existing.name !== entry.name || existing.sort_order !== entry.o || steamChanged) {
          existing.name = entry.name;
          existing.sort_order = entry.o;
          if (steamId != null) existing.steam_id = steamId;
          existing.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { changes, rowsWritten: changes };
    },
  },
  {
    pattern: /^INSERT INTO user_collection_games_cloud \(steam_id, user_id, collection_id, game_id, sort_order\)/i,
    run: ([steamId, userId, collectionsJson], db) => {
      const collections = JSON.parse(String(collectionsJson || "[]")) as Array<{ id: string; games: string[] }>;
      const list = collections.flatMap((collection) =>
        collection.games.map((gameId, order) => ({ c: collection.id, g: gameId, o: order }))
      );
      const rows = db.rows("user_collection_games_cloud");
      let changes = 0;
      for (const entry of list) {
        const existing = rows.find(
          (row) => row.user_id === userId && row.collection_id === entry.c && row.game_id === entry.g
        );
        if (!existing) {
          rows.push({
            steam_id: steamId,
            user_id: userId,
            collection_id: entry.c,
            game_id: entry.g,
            sort_order: entry.o,
          });
          changes += 1;
          continue;
        }
        const steamChanged = steamId != null && existing.steam_id !== steamId;
        if (existing.sort_order !== entry.o || steamChanged) {
          existing.sort_order = entry.o;
          if (steamId != null) existing.steam_id = steamId;
          changes += 1;
        }
      }
      return { changes, rowsWritten: changes };
    },
  },
];

export class FakeD1 {
  private tables = new Map<string, Row[]>();
  private counters = new Map<string, number>();
  /** Every statement executed, for assertions about what did or did not run. */
  readonly executed: string[] = [];
  readonly execLog: ExecEntry[] = [];
  readonly batches: BatchEntry[] = [];
  private failPatterns: Array<{ pattern: RegExp; error: Error; once: boolean }> = [];
  private failBatchIndex: number | null = null;
  private failBatchError: Error | null = null;

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

  failNext(pattern: RegExp, message = "injected D1 failure") {
    this.failPatterns.push({ pattern, error: new Error(message), once: true });
  }

  failBatchAt(index: number, message = "injected batch failure") {
    this.failBatchIndex = index;
    this.failBatchError = new Error(message);
  }

  snapshotTables(): Map<string, Row[]> {
    const copy = new Map<string, Row[]>();
    for (const [table, rows] of this.tables.entries()) {
      copy.set(table, rows.map((row) => ({ ...row })));
    }
    return copy;
  }

  restoreTables(snapshot: Map<string, Row[]>) {
    this.tables = snapshot;
  }

  prepare(sql: string) {
    const normalized = normalize(sql);
    const self = this;
    let binds: any[] = [];

    const statement: any = {
      __sql: normalized,
      __binds: [] as any[],
      bind(...args: any[]) {
        binds = args;
        statement.__binds = args;
        return statement;
      },
      async run() {
        const { changes, rowsWritten } = self.execute(normalized, binds);
        return { success: true, meta: { changes, rows_written: rowsWritten, rows_read: 0 } };
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

  async batch(statements: any[]) {
    const snapshot = this.snapshotTables();
    const sqls: string[] = [];
    const binds: any[][] = [];
    const results: Array<{ changes: number; rowsWritten: number }> = [];
    const batchResults: any[] = [];
    try {
      for (let index = 0; index < statements.length; index += 1) {
        const entry = statements[index] as { __sql?: string; __binds?: any[] };
        const sql = entry.__sql || "";
        const args = entry.__binds || [];
        sqls.push(sql);
        binds.push(args);
        if (this.failBatchIndex !== null && index === this.failBatchIndex && this.failBatchError) {
          throw this.failBatchError;
        }
        const outcome = this.execute(sql, args);
        const changes = outcome.changes ?? 0;
        const rowsWritten = outcome.rowsWritten ?? changes;
        results.push({ changes, rowsWritten });
        batchResults.push({
          success: true,
          meta: { changes, rows_written: rowsWritten, rows_read: 0 },
          results: outcome.results || [],
        });
      }
      this.batches.push({ sqls, binds, results });
      return batchResults;
    } catch (error) {
      this.restoreTables(snapshot);
      throw error;
    } finally {
      this.failBatchIndex = null;
      this.failBatchError = null;
    }
  }

  private execute(sql: string, binds: any[]) {
    this.executed.push(sql);
    for (const failure of this.failPatterns) {
      if (failure.pattern.test(sql)) {
        if (failure.once) {
          this.failPatterns = this.failPatterns.filter((entry) => entry !== failure);
        }
        throw failure.error;
      }
    }
    const rule = rules.find((entry) => entry.pattern.test(sql));
    if (!rule) throw new Error(`FakeD1: unhandled statement\n${sql}`);
    const outcome = rule.run(binds, this);
    const changes = outcome.changes ?? 0;
    const rowsWritten = outcome.rowsWritten ?? changes;
    this.execLog.push({ sql, binds: [...binds], changes, rowsWritten });
    return { ...outcome, changes, rowsWritten };
  }
}

export function fakeD1(seed: Record<string, Row[]> = {}) {
  return new FakeD1(seed) as unknown as D1Database & FakeD1;
}
