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

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const url = await ghostboxApi.getDiscordLinkUrl();
      if (url) {
        await ghostboxApi.openExternalUrl(url);

        // The browser hand-off means we don't know when the user finishes
        // (or abandons) the OAuth flow, so poll for a while instead of a
        // single fixed-delay check.
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          const next = await ghostboxApi.getDiscordLinkStatus();
          setStatus(next);
          if (next?.linked) break;
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await ghostboxApi.disconnectConnection("discord");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, connect, disconnect, refresh };
}
