import { CalendarClock, Check, CloudUpload, Cloudy, CreditCard, ExternalLink, Link, RotateCcw, ScreenShare, Settings2, Wallet, X } from "lucide-react";
import { CupStar, ServerUpdate, UserEdit } from "reicon-react";
import { useEffect, useRef, useState } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type {
  CloudSave,
  DiscordLinkStatus,
  SubscriptionPayment,
  SubscriptionPlanId as PaidSubscriptionPlanId,
  SubscriptionPortalFlow,
  SubscriptionStatusResult,
} from "../../lib/ghostboxApi.types";
import type { SteamProfile } from "../../types";
import { isSteamTitlePlaceholder } from "../../utils/steamTitles";
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

function formatBillingDate(value: string | null | undefined, language: "pt" | "en") {
  if (!value) return language === "en" ? "Not available" : "Indisponível";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "medium",
  }).format(timestamp);
}

function formatCardBrand(brand: string | null | undefined) {
  if (!brand) return null;
  const normalized = brand.trim().toLowerCase();
  const labels: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "Amex",
    american_express: "Amex",
    elo: "Elo",
    hipercard: "Hipercard",
    diners: "Diners",
    discover: "Discover",
    jcb: "JCB",
    unionpay: "UnionPay",
  };
  return labels[normalized] || brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatPaymentMethodLabel(
  paymentMethod: { brand: string | null; last4: string | null; type: string | null } | null | undefined,
  language: "pt" | "en"
) {
  if (!paymentMethod) return language === "en" ? "Not available" : "Indisponível";
  const brand = formatCardBrand(paymentMethod.brand);
  if (brand && paymentMethod.last4) return `${brand} ···· ${paymentMethod.last4}`;
  if (brand) return brand;
  if (paymentMethod.last4) return `···· ${paymentMethod.last4}`;
  if (paymentMethod.type === "card") return language === "en" ? "Card" : "Cartão";
  return language === "en" ? "Not available" : "Indisponível";
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

function renderBenefitIcon(benefitKey: string, disabled: boolean) {
  if (disabled) return <X size={14} strokeWidth={2.15} aria-hidden="true" />;
  if (benefitKey === "subscription.benefits.sync") return <ScreenShare size={14} strokeWidth={2.15} aria-hidden="true" />;
  if (benefitKey === "subscription.benefits.automaticRestore") return <RotateCcw size={14} strokeWidth={2.15} aria-hidden="true" />;
  return <CloudUpload size={14} strokeWidth={2.15} aria-hidden="true" />;
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
  const steamProfile = steamProfileProp ?? appData.steamProfile;
  const [discordLinkStatus, setDiscordLinkStatus] = useState<DiscordLinkStatus | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResult | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(surface === "settings");
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<PaidSubscriptionPlanId>("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<PaidSubscriptionPlanId | null>(null);
  const [portalFlow, setPortalFlow] = useState<SubscriptionPortalFlow | null>(null);
  const subscriptionRequestIdRef = useRef(0);
  const linkedDiscordName = discordLinkStatus?.discordGlobalName || discordLinkStatus?.discordUsername;
  const language = appearance.language;
  const copy = (pt: string, en: string) => language === "en" ? en : pt;
  const isSettingsSurface = surface === "settings";

  async function openBillingPortal(flow: SubscriptionPortalFlow) {
    if (portalFlow) return;

    setPortalFlow(flow);
    try {
      const session = await ghostboxApi.createSubscriptionPortalSession(flow);
      if (!session?.url) {
        throw new Error(
          copy(
            "Não foi possível abrir o portal de cobrança.",
            "Could not open the billing portal."
          )
        );
      }
      await ghostboxApi.openExternalUrl(session.url);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy(
              "Não foi possível abrir o portal de cobrança.",
              "Could not open the billing portal."
            );
      showToast(
        copy("Portal de assinatura", "Subscription portal"),
        message,
        "error"
      );
    } finally {
      setPortalFlow(null);
    }
  }

  function refreshDiscordLinkStatus() {
    void ghostboxApi.getDiscordLinkStatus().then((status) => {
      setDiscordLinkStatus(status);
    });
  }

  function refreshCloudSaves() {
    void ghostboxApi.listCloudSaves()
      .then((saves) => setCloudSaves(saves))
      .catch((error) => {
        console.warn("Could not list cloud saves", error);
        setCloudSaves([]);
      });
  }

  function refreshSubscriptionStatus() {
    const requestId = ++subscriptionRequestIdRef.current;
    setSubscriptionLoading(true);
    void ghostboxApi.getSubscriptionStatus()
      .then((status) => {
        if (requestId !== subscriptionRequestIdRef.current) return;
        setSubscriptionStatus(status);
        if (status?.discordLink) setDiscordLinkStatus(status.discordLink);
        if (status?.subscription.isPremium) refreshCloudSaves();
        else setCloudSaves([]);
      })
      .finally(() => {
        if (requestId === subscriptionRequestIdRef.current) setSubscriptionLoading(false);
      });
  }

  useEffect(() => {
    setSubscriptionStatus(null);

    const refreshSubscriptionData = () => {
      refreshDiscordLinkStatus();
      refreshSubscriptionStatus();
    };
    refreshSubscriptionData();

    if (surface !== "settings") return;

    const intervalId = window.setInterval(refreshSubscriptionData, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [surface]);

  const isPremium = subscriptionStatus?.subscription.isPremium === true;
  const payment = visiblePayment(latestPayment(subscriptionStatus?.latestPayment), subscriptionStatus?.subscription);
  const paymentStatus = payment && subscriptionStatus ? effectivePaymentStatus(payment, subscriptionStatus.subscription) : null;
  const cloudBackupSummaries = (() => {
    const byAppId = new Map<string, CloudBackupGameSummary>();
    for (const save of cloudSaves) {
      const current = byAppId.get(save.appId);
      const updatedAt = save.updatedAt || save.createdAt || null;
      const localTitle = cloudBackupGames.find((game) => game.appId === save.appId)?.title;
      const remoteTitle = isSteamTitlePlaceholder(save.gameTitle, save.appId) ? null : save.gameTitle;
      const fallbackTitle = localTitle && !isSteamTitlePlaceholder(localTitle, save.appId) ? localTitle : null;
      if (!current || (updatedAt && (!current.lastBackupAt || Date.parse(updatedAt) > Date.parse(current.lastBackupAt)))) {
        byAppId.set(save.appId, {
          appId: save.appId,
          title: remoteTitle || fallbackTitle || localTitle || save.appId,
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
        <span className="sr-only" role="status" aria-live="polite">{copy("Carregando dados da assinatura", "Loading subscription data")}</span>
        <header className="subscription-account__header">
          <div className="subscription-account__header-main">
            <span className="subscription-account__brand-icon subscription-account__brand-icon--skeleton skeleton" aria-hidden="true" />
            <div>
              <span className="subscription-account__line subscription-account__line--eyebrow skeleton" />
              <h3 className="subscription-account__line subscription-account__line--title skeleton" />
              <p className="subscription-account__line subscription-account__line--copy skeleton" />
            </div>
          </div>
          <span className="subscription-account__status-badge subscription-account__status-badge--skeleton skeleton" />
        </header>
        <div className="subscription-account__summary-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <article className="subscription-account__summary-card subscription-account__summary-card--skeleton" key={`subscription-summary-${index}`}>
              <span className="subscription-account__summary-icon-skeleton skeleton" />
              <span className="subscription-account__line subscription-account__line--copy skeleton" />
              <strong className="subscription-account__line subscription-account__line--value skeleton" />
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (surface === "settings" && isPremium) {
    const planId = subscriptionStatus.subscription.planId;
    const planLabel =
      planId === "quarterly"
        ? copy("Plano trimestral", "Quarterly plan")
        : planId === "monthly"
          ? copy("Plano mensal", "Monthly plan")
          : copy("Plano Premium", "Premium plan");
    const planShortLabel =
      planId === "quarterly"
        ? copy("Trimestral", "Quarterly")
        : planId === "monthly"
          ? copy("Mensal", "Monthly")
          : copy("Premium", "Premium");
    const paymentStatusLabel =
      paymentStatus === "paid"
        ? copy("Pago", "Paid")
        : paymentStatus === "expired"
          ? copy("Vencida", "Expired")
          : paymentStatus === "failed"
            ? copy("Falhou", "Failed")
            : paymentStatus === "cancelled"
              ? copy("Cancelado", "Cancelled")
              : copy("Pendente", "Pending");
    const paymentStatusMod =
      paymentStatus === "paid"
        ? "paid"
        : paymentStatus === "failed" || paymentStatus === "expired"
          ? "failed"
          : paymentStatus === "cancelled"
            ? "cancelled"
            : "pending";
    // Full list: this panel is the only place backed-up games are listed.
    const recentBackups = [...cloudBackupSummaries].sort((a, b) => {
      const dateA = a.lastBackupAt ? Date.parse(a.lastBackupAt) : 0;
      const dateB = b.lastBackupAt ? Date.parse(b.lastBackupAt) : 0;
      return dateB - dateA;
    });

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
          <div className="subscription-account__header-main">
            <span className="subscription-account__brand-icon" aria-hidden="true" />
            <div>
              <span className="subscription-account__eyebrow">GhostBox Premium</span>
              <h3>{copy("Assinatura ativa", "Active subscription")}</h3>
              <p>{planLabel}</p>
            </div>
          </div>
          <span className="subscription-account__status-badge">
            <span className="subscription-account__status-dot" aria-hidden="true" />
            {copy("Ativa", "Active")}
          </span>
        </header>

        <div className="subscription-account__summary-grid">
          <article className="subscription-account__summary-card">
            <CalendarClock size={18} strokeWidth={2.15} aria-hidden="true" />
            <span>
              {subscriptionStatus.subscription.cancelAtPeriodEnd
                ? copy("Acesso até", "Access until")
                : copy("Próxima cobrança", "Next billing")}
            </span>
            <strong>{formatBillingDate(subscriptionStatus.subscription.currentPeriodEnd, language)}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <Wallet size={18} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Método de pagamento", "Payment method")}</span>
            <strong>{formatPaymentMethodLabel(subscriptionStatus.paymentMethod, language)}</strong>
          </article>
          <article className="subscription-account__summary-card">
            <CloudUpload size={18} strokeWidth={2.15} aria-hidden="true" />
            <span>{copy("Backups em nuvem", "Cloud backups")}</span>
            <strong>{cloudBackupSummaries.length}</strong>
          </article>
        </div>

        <div className="subscription-account__details-grid">
          <article className="subscription-account__panel">
            <h4>
              <CreditCard size={16} strokeWidth={2.15} aria-hidden="true" />
              {copy("Pagamentos", "Payments")}
            </h4>
            {payment ? (
              <ul className="subscription-account__payment-list">
                <li>
                  <div>
                    <strong>{formatCurrency(payment.amountCents, payment.currency, language)}</strong>
                    <small>
                      {planShortLabel}
                      {" · "}
                      {formatDate(payment.confirmedAt || payment.createdAt, language)}
                    </small>
                  </div>
                  <span className={`subscription-account__payment-status subscription-account__payment-status--${paymentStatusMod}`}>
                    {paymentStatusLabel}
                  </span>
                </li>
              </ul>
            ) : (
              <div className="subscription-account__empty">
                <strong>{copy("Nenhum pagamento listado", "No payments listed")}</strong>
                <p>{copy("O histórico aparece após a confirmação no Stripe.", "History appears after Stripe confirmation.")}</p>
              </div>
            )}
          </article>

          <article className="subscription-account__panel">
            <h4>
              <CloudUpload size={16} strokeWidth={2.15} aria-hidden="true" />
              {copy("Jogos com backup em nuvem", "Games with cloud backup")}
            </h4>
            {recentBackups.length > 0 ? (
              <ul className="subscription-account__backup-list">
                {recentBackups.map((game) => (
                  <li key={game.appId}>
                    <img
                      className="subscription-account__backup-thumb"
                      src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/header.jpg`}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                      }}
                    />
                    <strong>{game.title}</strong>
                    {game.lastBackupAt ? <span>{formatDate(game.lastBackupAt, language)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="subscription-account__empty">
                <strong>{copy("Nenhum backup em nuvem", "No cloud backups yet")}</strong>
                <p>{copy("Faça backup de um jogo para ver o histórico aqui.", "Back up a game to see history here.")}</p>
              </div>
            )}
          </article>
        </div>

        <div className="subscription-account__actions" role="group" aria-label={copy("Gerenciar assinatura", "Manage subscription")}>
          <button
            type="button"
            className="subscription-account__action-button"
            disabled={Boolean(portalFlow)}
            onClick={() => void openBillingPortal("manage")}
          >
            <Settings2 size={15} strokeWidth={2.15} aria-hidden="true" />
            <span>
              {portalFlow === "manage"
                ? copy("Abrindo…", "Opening…")
                : copy("Gerenciar assinatura", "Manage subscription")}
            </span>
            <ExternalLink size={14} strokeWidth={2.15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="subscription-account__action-button"
            disabled={Boolean(portalFlow)}
            onClick={() => void openBillingPortal("payment_method_update")}
          >
            <CreditCard size={15} strokeWidth={2.15} aria-hidden="true" />
            <span>
              {portalFlow === "payment_method_update"
                ? copy("Abrindo…", "Opening…")
                : copy("Alterar método de pagamento", "Change payment method")}
            </span>
            <ExternalLink size={14} strokeWidth={2.15} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  const paidPlans: Record<PaidSubscriptionPlanId, {
    price: string;
    cadence: string;
    description: string;
    savings?: {
      label: string;
      value: string;
    };
  }> = {
    monthly: {
      price: "R$ 6,99",
      cadence: t("subscription.plans.monthly.cadence"),
      description: copy("Ideal para testar a sincronização premium sem compromisso longo.", "Ideal for trying premium sync without a long commitment."),
    },
    quarterly: {
      price: "R$ 14,99",
      cadence: t("subscription.plans.quarterly.cadence"),
      description: copy("Mais economia para manter seus saves protegidos por mais tempo.", "Better value to keep your saves protected for longer."),
      savings: {
        label: t("subscription.plans.quarterly.savingsLabel"),
        value: t("subscription.plans.quarterly.savingsValue"),
      },
    },
  };

  const selectedPaidPlan = paidPlans[selectedPlanId];

  const plans: Array<{
    id: SubscriptionPlanId;
    title: string;
    price: string;
    cadence: string;
    description: string;
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
      description: copy("Comece com o básico e desbloqueie nuvem quando precisar.", "Start with the basics and unlock cloud when you need it."),
      action: t("subscription.plans.free.action"),
      disabled: true,
    },
    {
      id: selectedPlanId,
      title: "Premium",
      price: selectedPaidPlan.price,
      cadence: selectedPaidPlan.cadence,
      description: selectedPaidPlan.description,
      savings: selectedPaidPlan.savings,
      action: t("subscription.actions.subscribe"),
    },
  ];

  const highlightCards = [
    {
      title: copy("Conquistas", "Achievements"),
      description: copy(
        "Acompanhe seus marcos e mantenha seu histórico de progresso sempre preservado.",
        "Track your milestones and keep your progress history preserved."
      ),
      icon: CupStar,
    },
    {
      title: copy("Restauração de backups", "Backup restore"),
      description: copy(
        "Recupere seus saves com mais segurança quando trocar de PC ou reinstalar um jogo.",
        "Recover your saves with more confidence when switching PCs or reinstalling a game."
      ),
      icon: ServerUpdate,
    },
    {
      title: copy("Personalização de perfil", "Profile customization"),
      description: copy(
        "Deixe seu perfil com mais identidade e destaque suas escolhas dentro do GhostBox.",
        "Give your profile more identity and highlight your choices inside GhostBox."
      ),
      icon: UserEdit,
    },
  ];

  async function handleSubscribe(planId: SubscriptionPlanId) {
    if (planId === "free") return;
    if (!discordLinkStatus?.linked) {
      const discordUrl = await ghostboxApi.getDiscordLinkUrl();
      if (discordUrl) void ghostboxApi.openExternalUrl(discordUrl);
      showToast(
        t("subscription.discordLink.openedTitle"),
        t("subscription.discordLink.openedMessage")
      );
      return;
    }
    setCheckoutPlan(planId);
    try {
      const checkout = await ghostboxApi.createSubscriptionCheckout(planId);
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
        <h3><Cloudy size={18} strokeWidth={2.15} aria-hidden="true" /> {t("subscription.title")}</h3>
        {isSettingsSurface && (
          <p>
            {copy(
              "Tenha seu progresso, conquistas e perfil sempre com você.",
              "Have your progress, achievements, and profile always with you."
            )}
          </p>
        )}
      </header>

      <div className="subscription-plans__grid subscription-plans__grid--billing-toggle">
        {plans.map((plan) => (
          <article
            key={plan.id === "free" ? plan.id : "premium"}
            className={[
              "subscription-plan-card",
              plan.disabled ? "subscription-plan-card--disabled" : "",
              plan.id !== "free" ? "subscription-plan-card--featured" : "",
            ].filter(Boolean).join(" ")}
          >
            {plan.badge && <div className="subscription-plan-card__badge">{plan.badge}</div>}

            <div className="subscription-plan-card__top">
              <h4>{plan.title}</h4>
              {plan.id !== "free" && (
                <div className="subscription-plan-card__billing-toggle" role="group" aria-label={copy("Escolha o período da assinatura", "Choose billing period")}>
                  <span
                    className={`subscription-plan-card__billing-toggle-thumb subscription-plan-card__billing-toggle-thumb--${selectedPlanId}`}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className={selectedPlanId === "monthly" ? "is-active" : undefined}
                    aria-pressed={selectedPlanId === "monthly"}
                    onClick={() => setSelectedPlanId("monthly")}
                  >
                    {t("subscription.plans.monthly.title")}
                  </button>
                  <button
                    type="button"
                    className={selectedPlanId === "quarterly" ? "is-active" : undefined}
                    aria-pressed={selectedPlanId === "quarterly"}
                    onClick={() => setSelectedPlanId("quarterly")}
                  >
                    {t("subscription.plans.quarterly.title")}
                  </button>
                </div>
              )}
              <div className="subscription-plan-card__price">{plan.price}</div>
              <span>{plan.cadence}</span>
              <p>{plan.description}</p>
            </div>

            <ul className="subscription-plan-card__benefits">
              {benefits[plan.id].map((benefitKey) => (
                <li
                  key={benefitKey}
                  className={plan.id === "free" ? "subscription-plan-card__benefit--disabled" : undefined}
                >
                  {renderBenefitIcon(benefitKey, plan.id === "free")}
                  <span>{t(benefitKey)}</span>
                </li>
              ))}
            </ul>

            <div
              className={`subscription-plan-card__savings${plan.savings ? "" : " subscription-plan-card__savings--empty"}`}
              aria-hidden={plan.savings ? undefined : "true"}
            >
              {plan.savings && (
                <>
                  <span>{plan.savings.label}</span>
                  <strong>{plan.savings.value}</strong>
                </>
              )}
            </div>

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

      {isSettingsSurface && (
        <div className="subscription-plans__highlight-grid" aria-label={copy("Benefícios Premium", "Premium benefits")}>
          {highlightCards.map((card) => {
            const Icon = card.icon;
            return (
              <article key={card.title} className="subscription-plans__highlight-card">
                <div>
                  <h4><Icon size={22} strokeWidth={2.15} /> {card.title}</h4>
                  <p>{card.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!isSettingsSurface && (
        <>
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
                  void ghostboxApi.getDiscordLinkUrl().then((url) => {
                    if (!url) return;
                    void ghostboxApi.openExternalUrl(url);
                    window.setTimeout(() => refreshDiscordLinkStatus(), 3000);
                  });
                }}
              >
                <Link size={14} strokeWidth={2.15} aria-hidden="true" />
                {discordLinkStatus?.linked
                  ? t("subscription.discordLink.relink")
                  : t("subscription.discordLink.link")}
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
        </>
      )}
    </section>
  );
}
