import { CalendarClock, Check, Cloud, CloudUpload, CreditCard, ExternalLink, Link, RefreshCw, ShieldCheck, UserRound, X } from "lucide-react";
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
    let cancelled = false;
    if (!steamProfile?.steamId) {
      setDiscordLinkStatus(null);
      setCloudSaves([]);
      return;
    }

    void ghostboxApi.getDiscordLinkStatus(steamProfile.steamId).then((status) => {
      if (!cancelled) setDiscordLinkStatus(status);
    });
    refreshSubscriptionStatus(steamProfile.steamId);

    return () => {
      cancelled = true;
    };
  }, [steamProfile?.steamId]);

  useEffect(() => {
    const steamId = steamProfile?.steamId;
    if (!steamId) return;

    const handleFocus = () => {
      refreshDiscordLinkStatus(steamId);
      refreshSubscriptionStatus(steamId);
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [steamProfile?.steamId]);

  const isPremium = subscriptionStatus?.subscription.isPremium === true;
  const payment = latestPayment(subscriptionStatus?.latestPayment);
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
        style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
        aria-label={copy("Resumo da assinatura Premium", "Premium subscription summary")}
      >
        <header className="subscription-account__header">
          <span className="subscription-account__eyebrow">GhostBox Premium</span>
          <div>
            <h3>{copy("Assinatura ativa", "Active subscription")}</h3>
            <p>{copy("Seu benefício Premium está liberado para a conta Steam conectada.", "Your Premium benefit is enabled for the connected Steam account.")}</p>
          </div>
          <button
            type="button"
            className="subscription-account__refresh"
            onClick={() => steamProfile?.steamId && refreshSubscriptionStatus(steamProfile.steamId)}
            disabled={subscriptionLoading || !steamProfile?.steamId}
          >
            <RefreshCw size={14} strokeWidth={2.15} aria-hidden="true" />
            {copy("Atualizar", "Refresh")}
          </button>
        </header>

        <div className="subscription-account__summary-grid">
          <article className="subscription-account__summary-card">
            <ShieldCheck size={16} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Status", "Status")}</span>
            <strong>{copy("Premium ativo", "Premium active")}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <CalendarClock size={16} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Expira em", "Expires on")}</span>
            <strong>{formatDate(subscriptionStatus.subscription.currentPeriodEnd, language)}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <CloudUpload size={16} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Backups em nuvem", "Cloud backups")}</span>
            <strong>{cloudBackupSummaries.length}</strong>
          </article>
        </div>

        <div className="subscription-account__details-grid">
          <article className="subscription-account__panel">
            <h4><CreditCard size={15} strokeWidth={2.15} aria-hidden="true" />{copy("Pagamento e benefício", "Payment and benefit")}</h4>
            <dl>
              <div><dt>{copy("Plano", "Plan")}</dt><dd>{subscriptionStatus.subscription.planId === "quarterly" ? copy("Trimestral", "Quarterly") : copy("Mensal", "Monthly")}</dd></div>
              <div><dt>{copy("Início", "Start")}</dt><dd>{formatDate(subscriptionStatus.subscription.currentPeriodStart, language)}</dd></div>
              <div><dt>{copy("Expiração", "Expiration")}</dt><dd>{formatDate(subscriptionStatus.subscription.currentPeriodEnd, language)}</dd></div>
              <div><dt>{copy("Último pagamento", "Latest payment")}</dt><dd>{payment ? `${formatCurrency(payment.amountCents, payment.currency, language)} · ${payment.status ?? "-"}` : copy("Benefício administrativo", "Administrative benefit")}</dd></div>
              <div><dt>{copy("Data do pagamento", "Payment date")}</dt><dd>{formatDate(payment?.confirmedAt || payment?.createdAt, language)}</dd></div>
            </dl>
          </article>

          <article className="subscription-account__panel">
            <h4><UserRound size={15} strokeWidth={2.15} aria-hidden="true" />Discord</h4>
            <dl>
              <div><dt>{copy("Conta Steam", "Steam account")}</dt><dd>{steamProfile?.displayName || steamProfile?.steamId || copy("Não conectada", "Not connected")}</dd></div>
              <div><dt>{copy("Discord", "Discord")}</dt><dd>{linkedDiscordName || copy("Não vinculado", "Not linked")}</dd></div>
              <div><dt>{copy("Cargo Premium", "Premium role")}</dt><dd>{discordLinkStatus?.premiumRole?.synced ? copy("Sincronizado", "Synced") : discordLinkStatus?.linked ? copy("Aguardando servidor", "Waiting for server") : copy("Vincule sua conta", "Link your account")}</dd></div>
              <div><dt>{copy("Vinculado em", "Linked at")}</dt><dd>{formatDate(discordLinkStatus?.linkedAt, language)}</dd></div>
            </dl>
            <button
              type="button"
              className="subscription-account__link-button"
              onClick={() => {
                if (!steamProfile?.steamId) {
                  void handleSteamSignIn();
                  return;
                }
                void ghostboxApi.openExternalUrl(ghostboxApi.getDiscordLinkUrl(steamProfile.steamId));
              }}
            >
              <Link size={14} strokeWidth={2.15} aria-hidden="true" />
              {discordLinkStatus?.linked ? copy("Atualizar vínculo", "Update link") : copy("Vincular Discord", "Link Discord")}
            </button>
          </article>
        </div>

        <article className="subscription-account__panel subscription-account__panel--wide">
          <h4><CloudUpload size={15} strokeWidth={2.15} aria-hidden="true" />{copy("Jogos com backup em nuvem", "Games with cloud backup")}</h4>
          {cloudBackupSummaries.length > 0 ? (
            <ul className="subscription-account__backup-list">
              {cloudBackupSummaries.map((game) => (
                <li key={game.appId}>
                  <strong>{game.title}</strong>
                  {game.lastBackupAt ? <span>{formatDate(game.lastBackupAt, language)}</span> : null}
                  <em
                    className="subscription-account__backup-status"
                    title={copy("Backup em nuvem ativo", "Cloud backup active")}
                    aria-label={copy("Backup em nuvem ativo", "Cloud backup active")}
                  >
                    <Cloud size={15} strokeWidth={2.15} aria-hidden="true" />
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
