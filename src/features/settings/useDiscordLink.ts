import { useCallback, useEffect, useState } from "react";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { DiscordLinkStatus } from "../../lib/ghostboxApi.types";
import { useAuth } from "../../context/AuthContext";

/** Shared Discord connection flow: open the signed OAuth URL in the system
 * browser, then re-poll link status a few seconds later once the user
 * finishes in the browser. Used by both the Connections settings tab and
 * the Premium subscription panel's "link Discord" CTA. */
export function useDiscordLink() {
  const { refreshAccount } = useAuth();
  const [status, setStatus] = useState<DiscordLinkStatus | null>(() =>
    ghostboxApi.getCachedDiscordLinkStatus(),
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void ghostboxApi.getDiscordLinkStatus().then((next) => setStatus(next));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  /** Resolves to the link status once the browser hand-off settles, so a
   * caller that needs to act on the fresh link (verification does) does not
   * have to re-read it or wait for a re-render. */
  const connect = useCallback(async (): Promise<DiscordLinkStatus | null> => {
    setBusy(true);
    try {
      const url = await ghostboxApi.getDiscordLinkUrl();
      if (!url) return null;

      try {
        await ghostboxApi.openExternalUrl(url);
      } catch {
        // Navegador não abriu (ou a URL não passou na allowlist): sem a volta
        // do OAuth não há o que aguardar, e `null` já é o "cancelado" que os
        // chamadores tratam.
        return null;
      }

      // The browser hand-off means we don't know when the user finishes
      // (or abandons) the OAuth flow, so poll for a while instead of a
      // single fixed-delay check.
      const deadline = Date.now() + 120_000;
      let next: DiscordLinkStatus | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        next = await ghostboxApi.getDiscordLinkStatus();
        setStatus(next);
        if (next?.linked) {
          await refreshAccount();
          break;
        }
      }
      return next;
    } finally {
      setBusy(false);
    }
  }, [refreshAccount]);

  /**
   * Rejects with `last_connection` when this is the account's only linked
   * provider: the provider account IS the sign-in now, so the worker never
   * lets an account drop to zero providers. The caller shows the warning and
   * nothing else can talk past the refusal.
   */
  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await ghostboxApi.disconnectConnection("discord");
      ghostboxApi.clearDiscordLinkCache();
      setStatus(null);
      await refreshAccount();
    } finally {
      setBusy(false);
    }
  }, [refreshAccount]);

  return { status, busy, connect, disconnect, refresh };
}
