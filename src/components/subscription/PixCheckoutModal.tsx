import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { PixCharge, SubscriptionPlanId } from "../../lib/ghostboxApi.types";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";
import "./PixCheckoutModal.scss";

type PixCheckoutModalProps = {
  open: boolean;
  planId: SubscriptionPlanId;
  priceLabel: string;
  onClose: () => void;
  /** Fired once the charge is confirmed, so the panel can re-read the subscription. */
  onPaid: () => void;
};

/** The QR code dies on its own; polling past that only burns worker calls. */
const POLL_INTERVAL_MS = 5000;

function formatCpf(value: string) {
  const digits = value.replace(/\D+/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

function formatPhone(value: string) {
  const digits = value.replace(/\D+/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  const areaCode = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${areaCode}) ${rest}`;
  const split = rest.length > 8 ? 5 : 4;
  return `(${areaCode}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

function digitsOf(value: string) {
  return value.replace(/\D+/g, "");
}

function secondsUntil(expiresAt: string | null) {
  if (!expiresAt) return null;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((timestamp - Date.now()) / 1000));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PixCheckoutModal({ open, planId, priceLabel, onClose, onPaid }: PixCheckoutModalProps) {
  const { appearance, t } = useSettings();
  const { account } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [charge, setCharge] = useState<PixCharge | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // Boolean rather than `remainingSeconds === 0`: the countdown ticks every
  // second, and depending on it directly would restart the 5s poll each tick.
  const [expired, setExpired] = useState(false);
  const paidRef = useRef(false);
  const language = appearance.language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);

  const defaultName = account?.displayName || account?.username || "";

  useEffect(() => {
    if (!open) return;
    // Fresh charge per opening: a QR from a previous session has likely expired.
    paidRef.current = false;
    setCharge(null);
    setError(null);
    setCopied(false);
    setExpired(false);
    setName(defaultName);
    setPhone("");
    setCpf("");
  }, [defaultName, open]);

  const canSubmit = useMemo(
    () => name.trim().length >= 3 && digitsOf(phone).length >= 10 && digitsOf(cpf).length === 11 && !creating,
    [cpf, creating, name, phone],
  );

  const fallbackError =
    language === "en" ? "Could not generate the Pix charge." : "Não foi possível gerar o Pix.";

  const handleCreate = useCallback(async () => {
    if (!canSubmit || !account?.email) return;

    setCreating(true);
    setError(null);
    try {
      const result = await ghostboxApi.createPixCharge(planId, {
        name: name.trim(),
        email: account.email,
        phone: digitsOf(phone),
        document: digitsOf(cpf),
        fingerprint: ghostboxApi.getPaymentFingerprint(),
      });
      if (!result?.charge?.qrCode) {
        throw new Error(fallbackError);
      }
      setCharge(result.charge);
    } catch (createError) {
      setError(
        createError instanceof Error && createError.message
          ? createError.message
          : fallbackError,
      );
    } finally {
      setCreating(false);
    }
  }, [account?.email, canSubmit, cpf, fallbackError, name, phone, planId]);

  // Kept in a ref so the poll below can depend on the charge id alone. With
  // `onPaid` (a fresh closure from a parent that re-renders every 10s) or the
  // 1s countdown's re-render in the dep array, the 5s interval was torn down
  // and restarted before it ever fired — the poll never ran.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  const paymentId = charge?.paymentId ?? null;
  const chargeSettled = charge?.status === "paid" || charge?.status === "cancelled" || charge?.status === "failed";

  // Poll while the QR code is on screen: the webhook is the normal path to
  // Premium, this is what covers it being delayed or dropped.
  useEffect(() => {
    // An expired QR code can never be paid; polling on would just burn calls.
    if (!open || !paymentId || chargeSettled || expired) return;

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void ghostboxApi.getPixCharge(paymentId).then((result) => {
        const next = result?.charge;
        // A failed read returns null; keep showing the QR instead of claiming
        // the payment died.
        if (cancelled || !next) return;

        if (next.status === "paid") {
          if (paidRef.current) return;
          paidRef.current = true;
          onPaidRef.current();
          return;
        }
        if (next.status === "cancelled" || next.status === "failed") {
          setError(language === "en" ? "This charge was cancelled." : "Esta cobrança foi cancelada.");
          setCharge((current) => (current ? { ...current, status: next.status } : current));
        }
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [chargeSettled, expired, language, open, paymentId]);

  useEffect(() => {
    const expiresAt = charge?.expiresAt ?? null;
    if (!expiresAt) {
      setRemainingSeconds(null);
      return;
    }

    const tick = () => {
      const seconds = secondsUntil(expiresAt);
      setRemainingSeconds(seconds);
      if (seconds !== null && seconds <= 0) setExpired(true);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => window.clearInterval(intervalId);
  }, [charge?.expiresAt]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!charge?.qrCode) return;
    await navigator.clipboard.writeText(charge.qrCode);
    setCopied(true);
  }, [charge?.qrCode]);

  const handleClose = useCallback(() => {
    if (creating) return;
    onClose();
  }, [creating, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--pix" onClick={handleClose}>
      <section
        className="collection-modal pix-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pix-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="collection-modal__header">
          <div>
            <h3 id="pix-modal-title">{t("subscription.pix.title")}</h3>
            <p>
              {charge
                ? t("subscription.pix.scanSubtitle")
                : t("subscription.pix.formSubtitle").replace("{price}", priceLabel)}
            </p>
          </div>
          <button
            type="button"
            className="collection-modal__close"
            onClick={handleClose}
            aria-label={copy("Fechar", "Close")}
            disabled={creating}
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="collection-modal__content pix-modal__content">
          {!charge ? (
            <div className="pix-modal__form">
              <label className="pix-modal__field">
                <span>{t("subscription.pix.fields.name")}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  disabled={creating}
                />
              </label>
              <label className="pix-modal__field">
                <span>{t("subscription.pix.fields.document")}</span>
                <input
                  type="text"
                  value={formatCpf(cpf)}
                  onChange={(event) => setCpf(event.target.value)}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  disabled={creating}
                />
              </label>
              <label className="pix-modal__field">
                <span>{t("subscription.pix.fields.phone")}</span>
                <input
                  type="tel"
                  value={formatPhone(phone)}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="numeric"
                  placeholder="(11) 91234-5678"
                  disabled={creating}
                />
              </label>
              <p className="pix-modal__privacy">{t("subscription.pix.privacy")}</p>
            </div>
          ) : (
            <div className="pix-modal__charge">
              {charge.qrCodeBase64 ? (
                <img className="pix-modal__qr" src={charge.qrCodeBase64} alt={t("subscription.pix.qrAlt")} />
              ) : null}

              <div className="pix-modal__code">
                <span className="pix-modal__code-label">{t("subscription.pix.copyLabel")}</span>
                <code>{charge.qrCode}</code>
                <button type="button" className="button button--outline" onClick={() => void handleCopy()}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? t("subscription.pix.copied") : t("subscription.pix.copy")}
                </button>
              </div>

              <p className="pix-modal__status" role="status" aria-live="polite">
                {expired
                  ? t("subscription.pix.expired")
                  : remainingSeconds !== null
                    ? t("subscription.pix.waiting").replace("{time}", formatCountdown(remainingSeconds))
                    : t("subscription.pix.waitingNoTimer")}
              </p>
            </div>
          )}

          {error ? <p className="pix-modal__error">{error}</p> : null}
        </div>

        <footer className="pix-modal__actions">
          <button type="button" className="button button--outline" onClick={handleClose} disabled={creating}>
            {t("subscription.pix.close")}
          </button>
          {(!charge || expired) && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                if (expired) setCharge(null);
                else void handleCreate();
              }}
              disabled={!expired && !canSubmit}
            >
              {creating ? <Loader2 size={14} className="pix-modal__spinner" aria-hidden="true" /> : null}
              {creating
                ? t("subscription.pix.generating")
                : expired
                  ? t("subscription.pix.regenerate")
                  : t("subscription.pix.generate")}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
