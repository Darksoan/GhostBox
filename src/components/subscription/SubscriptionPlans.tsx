import { CalendarClock, Check, Cloud, CloudUpload, CreditCard, ExternalLink, Link, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { CloudSave, DiscordLinkStatus, SubscriptionPayment, SubscriptionPlanId as PaidSubscriptionPlanId, SubscriptionStatusResult } from "../../lib/ghostboxApi.types";
import type { SteamProfile } from "../../types";
import ghostIcon from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";

type SubscriptionPlanId = "free" | PaidSubscriptionPlanId;

type SubscriptionPlansProps = {
  surface?: "modal" | "settings";
  enterDelay?: string;
  cloudBackupGames?: Array<{
    appId: string;
    title: string;
    lastBackupAt: string | null;
    lastBackupSuccess: boolean | null;
  }>;
  steamProfile?: SteamProfile | null;
};

type CloudBackupGameSummary = {
  appId: string;
  title: string;
  lastBackupAt: string | null;
  lastBackupSuccess: boolean;
};

const benefits: Record<SubscriptionPlanId, string[]> = {
  free: ["subscription.benefits.backupSync"],
  monthly: ["subscription.benefits.localAndCloudBackups", "subscription.benefits.sync", "subscription.benefits.automaticRestore"],
  quarterly: ["subscription.benefits.localAndCloudBackups", "subscription.benefits.sync", "subscription.benefits.automaticRestore"],
};

const details = [
  {
    title: "subscription.details.payments.title",
    items: [
      "subscription.details.payments.card",
      "subscription.details.payments.methods",
      "subscription.details.payments.security",
    ],
  },
  {
    title: "subscription.details.billing.title",
    items: [
      "subscription.details.billing.renewal",
      "subscription.details.billing.activation",
      "subscription.details.billing.receipt",
    ],
  },
  {
    title: "subscription.details.refunds.title",
    items: [
      "subscription.details.refunds.window",
      "subscription.details.refunds.prorated",
      "subscription.details.refunds.abuse",
    ],
  },
  {
    title: "subscription.details.cancel.title",
    items: [
      "subscription.details.cancel.anytime",
      "subscription.details.cancel.access",
      "subscription.details.cancel.data",
    ],
  },
];

const steps = [
  "subscription.steps.choose",
  "subscription.steps.checkout",
  "subscription.steps.sync",
];

function formatDate(value: string | null | undefined, language: "pt" | "en") {
  if (!value) return language === "en" ? "Not available" : "Indisponível";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatCurrency(amountCents: number | undefined, currency: string | undefined, language: "pt" | "en") {
  if (typeof amountCents !== "number") return language === "en" ? "Not available" : "Indisponível";
  return new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(amountCents / 100);
}

function latestPayment(value: unknown): SubscriptionPayment | null {
  return value && typeof value === "object" ? value as SubscriptionPayment : null;
}

function effectivePaymentStatus(payment: SubscriptionPayment, subscription: SubscriptionStatusResult["subscription"]) {
  if (subscription.isPremium && subscription.lastPaymentId === payment.id) return "paid";
  return payment.status || "pending";
}

function visiblePayment(payment: SubscriptionPayment | null, subscription: SubscriptionStatusResult["subscription"] | undefined) {
  if (!payment || !subscription) return null;
  if (subscription.isPremium && !subscription.lastPaymentId) return null;
  return payment;
}

export function SubscriptionPlans({
  surface = "settings",
  enterDelay,
  cloudBackupGames = [],
  steamProfile: steamProfileProp,
}: SubscriptionPlansProps) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const appData = useAppData();
  const { isSteamSigningIn, handleSteamSignIn } = appData;
  const steamProfile = steamProfileProp ?? appData.steamProfile;
  const [discordLinkStatus, setDiscordLinkStatus] = useState<DiscordLinkStatus | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResult | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(surface === "settings" && Boolean(steamProfile?.steamId));
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [checkoutPlan, setCheckoutPlan] = useState<PaidSubscriptionPlanId | null>(null);
  const linkedDiscordName = discordLinkStatus?.discordGlobalName || discordLinkStatus?.discordUsername;
  const language = appearance.language;
  const copy = (pt: string, en: string) => language === "en" ? en : pt;

  function refreshDiscordLinkStatus(steamId: string) {
    void ghostboxApi.getDiscordLinkStatus(steamId).then((status) => {
      setDiscordLinkStatus(status);
    });
  }

  function refreshCloudSaves() {
    void ghostboxApi.listCloudSaves()
      .then((saves) => setCloudSaves(saves))
      .catch(() => setCloudSaves([]));
  }

  function refreshSubscriptionStatus(steamId: string) {
    setSubscriptionLoading(true);
    void ghostboxApi.getSubscriptionStatus(steamId)
      .then((status) => {
        setSubscriptionStatus(status);
        if (status?.discordLink) setDiscordLinkStatus(status.discordLink);
        if (status?.subscription.isPremium) refreshCloudSaves();
        else setCloudSaves([]);
      })
      .finally(() => setSubscriptionLoading(false));
  }

  useEffect(() => {
    const steamId = steamProfile?.steamId;
    if (!steamId) {
      setDiscordLinkStatus(null);
      setCloudSaves([]);
      return;
    }

    const refreshSubscriptionData = () => {
      refreshDiscordLinkStatus(steamId);
      refreshSubscriptionStatus(steamId);
    };
    refreshSubscriptionData();

    if (surface !== "settings") return;

    const intervalId = window.setInterval(refreshSubscriptionData, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [steamProfile?.steamId, surface]);

  const isPremium = subscriptionStatus?.subscription.isPremium === true;
  const payment = visiblePayment(latestPayment(subscriptionStatus?.latestPayment), subscriptionStatus?.subscription);
  const paymentStatus = payment && subscriptionStatus ? effectivePaymentStatus(payment, subscriptionStatus.subscription) : null;
  const cloudBackupSummaries = (() => {
    const byAppId = new Map<string, CloudBackupGameSummary>();
    for (const save of cloudSaves) {
      const current = byAppId.get(save.appId);
      const updatedAt = save.updatedAt || save.createdAt || null;
      if (!current || (updatedAt && (!current.lastBackupAt || Date.parse(updatedAt) > Date.parse(current.lastBackupAt)))) {
        byAppId.set(save.appId, {
          appId: save.appId,
          title: save.gameTitle || cloudBackupGames.find((game) => game.appId === save.appId)?.title || save.appId,
          lastBackupAt: updatedAt,
          lastBackupSuccess: true,
        });
      }
    }
    return Array.from(byAppId.values()).sort((left, right) => left.title.localeCompare(right.title));
  })();

  if (surface === "settings" && steamProfile?.steamId && subscriptionLoading && !subscriptionStatus) {
    return (
      <section
        className="subscription-account subscription-account--loading settings-panel__animated-block"
        style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
        aria-label={copy("Carregando assinatura", "Loading subscription")}
      >
        <div className="subscription-account__loading-indicator" role="status" aria-live="polite">
          <span className="subscription-account__spinner" aria-hidden="true" />
          <span className="sr-only">{copy("Carregando dados da assinatura", "Loading subscription data")}</span>
        </div>
      </section>
    );
  }

  if (surface === "settings" && isPremium) {
    return (
      <section
        className="subscription-account settings-panel__animated-block"
        style={{
          ...(enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : {}),
          ["--subscription-ghost-icon" as string]: `url(${ghostIcon})`
        }}
        aria-label={copy("Resumo da assinatura Premium", "Premium subscription summary")}
      >
        <header className="subscription-account__header">
          <div>
            <span className="subscription-account__eyebrow">GhostBox Premium</span>
            <h3>{copy("Assinatura ativa", "Active subscription")}</h3>
          </div>
        </header>

        <div className="subscription-account__summary-grid">
          <article className="subscription-account__summary-card">
            <ShieldCheck size={20} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Status", "Status")}</span>
            <strong>{copy("Premium ativo", "Premium active")}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <CalendarClock size={20} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Expira em", "Expires on")}</span>
            <strong>{formatDate(subscriptionStatus.subscription.currentPeriodEnd, language)}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <CloudUpload size={20} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Backups em nuvem", "Cloud backups")}</span>
            <strong>{cloudBackupSummaries.length}</strong>
          </article>
        </div>

        <article className="subscription-account__panel">
          <h4><CreditCard size={18} strokeWidth={2.15} aria-hidden="true" />{copy("Pagamentos", "Payments")}</h4>
          {payment ? (
            <ul className="subscription-account__payment-list">
              <li>
                <div>
                  <strong>{formatCurrency(payment.amountCents, payment.currency, language)}</strong>
                  <small>
                    {subscriptionStatus.subscription.planId === "quarterly" ? copy("Trimestral", "Quarterly") : copy("Mensal", "Monthly")}
                    {" · "}
                    {formatDate(payment.confirmedAt || payment.createdAt, language)}
                  </small>
                </div>
                <span>
                  {paymentStatus === "paid"
                    ? copy("pago", "paid")
                    : paymentStatus === "expired"
                      ? copy("fatura vencida", "invoice expired")
                      : paymentStatus === "failed"
                        ? copy("falhou", "failed")
                        : paymentStatus === "cancelled"
                          ? copy("cancelado", "cancelled")
                          : copy("pendente", "pending")}
                </span>
              </li>
            </ul>
          ) : (
            <p className="subscription-account__empty">{copy("Sem pagamentos registrados.", "No payments registered.")}</p>
          )}
        </article>

        <article className="subscription-account__panel subscription-account__panel--wide">
          <h4><CloudUpload size={18} strokeWidth={2.15} aria-hidden="true" />{copy("Últimos backups em nuvem", "Recent cloud backups")}</h4>
          {cloudBackupSummaries.length > 0 ? (
            <ul className="subscription-account__backup-list">
              {[...cloudBackupSummaries]
                .sort((a, b) => {
                  const dateA = a.lastBackupAt ? Date.parse(a.lastBackupAt) : 0;
                  const dateB = b.lastBackupAt ? Date.parse(b.lastBackupAt) : 0;
                  return dateB - dateA;
                })
                .slice(0, 8)
                .map((game) => (
                <li key={game.appId}>
                  <strong>{game.title}</strong>
                  {game.lastBackupAt ? <span>{formatDate(game.lastBackupAt, language)}</span> : null}
                  <em
                    className="subscription-account__backup-status"
                    title={copy("Backup em nuvem ativo", "Cloud backup active")}
                    aria-label={copy("Backup em nuvem ativo", "Cloud backup active")}
                  >
                    <Cloud size={17} strokeWidth={2.15} aria-hidden="true" />
                  </em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subscription-account__empty">{copy("Nenhum backup em nuvem encontrado ainda.", "No cloud backups found yet.")}</p>
          )}
        </article>
      </section>
    );
  }

  const plans: Array<{
    id: SubscriptionPlanId;
    title: string;
    price: string;
    cadence: string;
    badge?: string;
    savings?: {
      label: string;
      value: string;
    };
    action: string;
    disabled?: boolean;
  }> = [
    {
      id: "free",
      title: t("subscription.plans.free.title"),
      price: t("subscription.plans.free.price"),
      cadence: t("subscription.plans.free.cadence"),
      action: t("subscription.plans.free.action"),
      disabled: true,
    },
    {
      id: "monthly",
      title: t("subscription.plans.monthly.title"),
      price: "R$ 6,99",
      cadence: t("subscription.plans.monthly.cadence"),
      action: t("subscription.actions.subscribe"),
    },
    {
      id: "quarterly",
      title: t("subscription.plans.quarterly.title"),
      price: "R$ 14,99",
      cadence: t("subscription.plans.quarterly.cadence"),
      badge: t("subscription.plans.quarterly.badge"),
      savings: {
        label: t("subscription.plans.quarterly.savingsLabel"),
        value: t("subscription.plans.quarterly.savingsValue"),
      },
      action: t("subscription.actions.subscribe"),
    },
  ];

  async function handleSubscribe(planId: SubscriptionPlanId) {
    if (planId === "free") return;
    if (!steamProfile?.steamId) {
      void handleSteamSignIn();
      return;
    }
    if (!discordLinkStatus?.linked) {
      void ghostboxApi.openExternalUrl(ghostboxApi.getDiscordLinkUrl(steamProfile.steamId));
      showToast(
        t("subscription.discordLink.openedTitle"),
        t("subscription.discordLink.openedMessage")
      );
      return;
    }

    setCheckoutPlan(planId);
    try {
      const checkout = await ghostboxApi.createSubscriptionCheckout(steamProfile.steamId, planId);
      const payment = checkout?.payment;
      if (payment?.hostedCheckoutUrl) {
        await ghostboxApi.openExternalUrl(payment.hostedCheckoutUrl);
        showToast(
          copy("Checkout aberto", "Checkout opened"),
          copy("Finalize o pagamento na janela aberta e volte ao GhostBox para atualizar o status.", "Complete payment in the opened window and return to GhostBox to refresh status."),
          "success"
        );
        return;
      }

      if (payment?.pixCode || payment?.pixQrCodeUrl) {
        showToast(
          copy("Checkout criado", "Checkout created"),
          copy("O pagamento PIX foi criado, mas ainda não há tela de pagamento no app para exibir o QR Code.", "The PIX payment was created, but the app does not yet have a payment screen to show the QR code."),
          "success"
        );
        return;
      }

      showToast(
        copy("Não foi possível criar o checkout", "Could not create checkout"),
        copy("Tente novamente em instantes.", "Try again in a moment."),
        "error"
      );
    } finally {
      setCheckoutPlan(null);
    }
  }

  return (
    <section
      className={`subscription-plans subscription-plans--${surface} settings-panel__animated-block`}
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
      aria-label={t("subscription.title")}
    >
      <header className="subscription-plans__header">
        <span className="subscription-plans__eyebrow">
          <span
            className="subscription-plans__eyebrow-icon"
            style={{ ["--subscription-ghost-icon" as string]: `url(${ghostIcon})` }}
            aria-hidden="true"
          />
          {"GhostBox "}
          <strong className="subscription-plans__eyebrow-premium">Premium</strong>
        </span>
        <h3>{t("subscription.title")}</h3>
        <p>{t("subscription.description")}</p>
      </header>

      <div className="subscription-plans__grid">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={[
              "subscription-plan-card",
              plan.disabled ? "subscription-plan-card--disabled" : "",
              plan.id === "quarterly" ? "subscription-plan-card--featured" : "",
            ].filter(Boolean).join(" ")}
          >
            {plan.badge && <div className="subscription-plan-card__badge">{plan.badge}</div>}

            <div className="subscription-plan-card__top">
              <h4>{plan.title}</h4>
              <div className="subscription-plan-card__price">{plan.price}</div>
              <span>{plan.cadence}</span>
            </div>

            <ul className="subscription-plan-card__benefits">
              {benefits[plan.id].map((benefitKey) => (
                <li
                  key={benefitKey}
                  className={plan.id === "free" ? "subscription-plan-card__benefit--disabled" : undefined}
                >
                  {plan.id === "free" ? (
                    <X size={14} strokeWidth={2.15} aria-hidden="true" />
                  ) : (
                    <Check size={14} strokeWidth={2.15} aria-hidden="true" />
                  )}
                  <span>{t(benefitKey)}</span>
                </li>
              ))}
            </ul>

            {plan.savings && (
              <div className="subscription-plan-card__savings">
                <span>{plan.savings.label}</span>
                <strong>{plan.savings.value}</strong>
              </div>
            )}

            <button
              type="button"
              className="subscription-plan-card__action"
              disabled={plan.disabled || checkoutPlan === plan.id}
              onClick={() => void handleSubscribe(plan.id)}
            >
              {checkoutPlan === plan.id ? copy("Abrindo...", "Opening...") : plan.action}
            </button>
          </article>
        ))}
      </div>

      <div className="subscription-plans__steps" aria-label={t("subscription.steps.title")}>
        {steps.map((stepKey, index) => (
          <div key={stepKey} className="subscription-plans__step">
            <span>{index + 1}</span>
            <strong>{t(stepKey)}</strong>
          </div>
        ))}
      </div>

      <section className="subscription-plans__discord-link" aria-label={t("subscription.discordLink.title")}>
        <div className="subscription-plans__discord-copy">
          <img
            className="subscription-plans__discord-icon"
            src={discordIcon}
            alt=""
            aria-hidden="true"
          />
          <div>
            <h4>{t("subscription.discordLink.title")}</h4>
            <p>
              {discordLinkStatus?.linked && linkedDiscordName
                ? t("subscription.discordLink.linkedAs").replace("{name}", linkedDiscordName)
                : t("subscription.discordLink.description")}
            </p>
          </div>
        </div>
        <div className="subscription-plans__discord-actions">
          <button
            type="button"
            className="subscription-plans__discord-action"
            onClick={() => {
              if (!steamProfile?.steamId) {
                void handleSteamSignIn();
                return;
              }
              void ghostboxApi.openExternalUrl(ghostboxApi.getDiscordLinkUrl(steamProfile.steamId));
              window.setTimeout(() => refreshDiscordLinkStatus(steamProfile.steamId), 3000);
            }}
            disabled={isSteamSigningIn}
          >
            {steamProfile?.steamId ? <Link size={14} strokeWidth={2.15} aria-hidden="true" /> : <ExternalLink size={14} strokeWidth={2.15} aria-hidden="true" />}
            {steamProfile?.steamId
              ? discordLinkStatus?.linked
                ? t("subscription.discordLink.relink")
                : t("subscription.discordLink.link")
              : t("subscription.discordLink.signInSteam")}
          </button>
          {discordLinkStatus?.linked && (
            <span className="subscription-plans__discord-status">
              <Check size={13} strokeWidth={2.25} aria-hidden="true" />
              {t("subscription.discordLink.linked")}
            </span>
          )}
        </div>
      </section>

      <div className="subscription-plans__details">
        {details.map((section) => (
          <article key={section.title} className="subscription-plans__detail-card">
            <h4>{t(section.title)}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <footer className="subscription-plans__policy-note">
        <strong>{t("subscription.policy.title")}</strong>
        <p>{t("subscription.policy.description")}</p>
      </footer>
    </section>
  );
}
