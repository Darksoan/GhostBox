import { useCallback, useEffect, useState } from "react";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { DiscordLinkStatus } from "../../lib/ghostboxApi.types";

/** Shared Discord connection flow: open the signed OAuth URL in the system
 * browser, then re-poll link status a few seconds later once the user
 * finishes in the browser. Used by both the Connections settings tab and
 * the Premium subscription panel's "link Discord" CTA. */
export function useDiscordLink() {
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

      await ghostboxApi.openExternalUrl(url);

      // The browser hand-off means we don't know when the user finishes
      // (or abandons) the OAuth flow, so poll for a while instead of a
      // single fixed-delay check.
      const deadline = Date.now() + 120_000;
      let next: DiscordLinkStatus | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        next = await ghostboxApi.getDiscordLinkStatus();
        setStatus(next);
        if (next?.linked) break;
      }
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * `confirm` is what the worker demands when this is the account's last
   * connection. GhostBox sends no recovery emails and issues no backup codes,
   * so removing the last one means a forgotten password can never be
   * recovered — the caller has to say that to the user and pass `true` only
   * after they agree.
   *
   * Rejects with `last_connection` when the confirmation is still missing, so
   * the caller can show the warning and retry.
   */
  const disconnect = useCallback(async (confirm = false) => {
    setBusy(true);
    try {
      await ghostboxApi.disconnectConnection("discord", confirm);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, connect, disconnect, refresh };
}
