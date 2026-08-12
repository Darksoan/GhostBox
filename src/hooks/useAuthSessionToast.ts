import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useOverlay } from "../context/OverlayContext";
import { useSettings } from "../context/settings";
import { resolveSessionToastEvent } from "../lib/authSessionToast";

/**
 * Toasts the account session changing. Lives in the app shell rather than in
 * AuthContext because the toast state belongs to OverlayProvider, which is
 * mounted below the auth provider.
 */
export function useAuthSessionToast() {
  const { status, account } = useAuth();
  const { showToast } = useOverlay();
  const { t } = useSettings();
  const previousStatusRef = useRef(status);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;

    const event = resolveSessionToastEvent(previous, status);
    if (!event) return;

    if (event === "signed-out") {
      showToast(
        t("auth.toast.signedOutTitle"),
        t("auth.toast.signedOutMessage"),
      );
      return;
    }

    const name =
      account?.displayName?.trim() || account?.username?.trim() || "";
    showToast(
      t("auth.toast.signedInTitle"),
      name
        ? t("auth.toast.signedInMessage", { name })
        : t("auth.toast.signedInMessageGeneric"),
    );
  }, [account, showToast, status, t]);
}
