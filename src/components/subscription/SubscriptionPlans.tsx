import { CalendarClock, CloudUpload, CreditCard, ExternalLink, RotateCcw, ScreenShare, Settings2, Wallet } from "lucide-react";
import { Trophy } from "reicon-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { requestNavigateToSettingsTab } from "../../lib/appNavigation";
import type {
  CloudSave,
  SubscriptionPayment,
  SubscriptionPlanId as PaidSubscriptionPlanId,
  SubscriptionPortalFlow,
  SubscriptionStatusResult,
} from "../../lib/ghostboxApi.types";
import type { SteamProfile } from "../../types";
import { loadGameStoreDetailsCached } from "../../utils/gameCache";
import {
  resolveBackupFailureView,
  type BackupFailureRecord,
} from "../../utils/backupStatusDisplay";
import { isSteamTitlePlaceholder } from "../../utils/steamTitles";
import ghostIcon from "../../../Icons/ghost-solid.png";
import { SubscriptionBackdrop } from "./SubscriptionBackdrop";

type SubscriptionPlansProps = {
  surface?: "modal" | "settings";
  enterDelay?: string;
  cloudBackupGames?: Array<{
    appId: string;
    title: string;
    achievementCount: number;
    lastBackupAt: string | null;
    lastBackupSuccess: boolean | null;
    lastBackupError?: string | null;
  }>;
  steamProfile?: SteamProfile | null;
};

type CloudBackupGameSummary = BackupFailureRecord & {
  appId: string;
  title: string;
  achievementCount: number | null;
  lastBackupAt: string | null;
  lastBackupSuccess: boolean;
};

// Candidatos de capa para o resumo de backup: o resumo só tem `appId`, então
// espelhamos os hosts/variantes de `gameHeaderOnlySources` (o header.jpg só
// existe no host legado; jogos novos publicam em `store_item_assets`, e a
// capsule 616x353 cobre os que não publicam header nenhum).
function backupThumbSources(appId: string) {
  if (!appId) return [];
  return [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`,
  ];
}

const emptyBackupThumbSources: string[] = [];

function BackupGameThumb({ appId }: { appId: string }) {
  const sources = useMemo(
    () => (appId ? backupThumbSources(appId) : emptyBackupThumbSources),
    [appId],
  );
  const cachedSources = useCachedImageSources(sources);
  // O hook percorre os candidatos em ordem e ainda resolve o header com hash
  // via SteamCMD antes de declarar falha. Só pintamos depois de decodificar,
  // então nada de <img> quebrado: cai no placeholder com o ícone fantasma.
  const { source, loaded } = useLoadableImageCover(cachedSources);

  if (!loaded || !source) {
    return (
      <span
        className="subscription-account__backup-thumb subscription-account__backup-thumb--placeholder"
        style={{ backgroundImage: `url(${ghostIcon})` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      className="subscription-account__backup-thumb"
      src={source}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

const benefits: Record<PaidSubscriptionPlanId, string[]> = {
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

/** Single source for the price copy shown in the plan picker. */
function planPriceLabel(planId: PaidSubscriptionPlanId, language: "pt" | "en") {
  if (planId === "quarterly") return language === "en" ? "$2.90" : "R$ 14,99";
  return language === "en" ? "$1.35" : "R$ 6,99";
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

function renderBenefitIcon(benefitKey: string) {
  if (benefitKey === "subscription.benefits.sync") return <ScreenShare size={16} strokeWidth={2.15} aria-hidden="true" />;
  if (benefitKey === "subscription.benefits.automaticRestore") return <RotateCcw size={16} strokeWidth={2.15} aria-hidden="true" />;
  return <CloudUpload size={16} strokeWidth={2.15} aria-hidden="true" />;
}

export function SubscriptionPlans({
  surface = "settings",
  enterDelay,
  cloudBackupGames = [],
  steamProfile: steamProfileProp,
}: SubscriptionPlansProps) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const { status, openAuthModal } = useAuth();
  const appData = useAppData();
  const steamProfile = steamProfileProp ?? appData.steamProfile;
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResult | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(surface === "settings");
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [resolvedCloudGameTitles, setResolvedCloudGameTitles] = useState<Map<string, string>>(new Map());
  const [selectedPlanId, setSelectedPlanId] = useState<PaidSubscriptionPlanId>("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<PaidSubscriptionPlanId | null>(null);
  const [portalFlow, setPortalFlow] = useState<SubscriptionPortalFlow | null>(null);
  const subscriptionRequestIdRef = useRef(0);
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
        // A failed poll (this runs every 10s) must not blank the panel — doing
        // so showed the plan picker to someone who is already subscribed.
        if (!status) return;

        setSubscriptionStatus(status);
        // Keeps the shared cache warm — `useDiscordLink` reads from it — without
        // holding a second copy of the link state in this component.
        if (status.discordLink) ghostboxApi.cacheDiscordLinkStatus(status.discordLink);
        if (status.subscription.isPremium) refreshCloudSaves();
        else setCloudSaves([]);
      })
      .finally(() => {
        if (requestId === subscriptionRequestIdRef.current) setSubscriptionLoading(false);
      });
  }

  useEffect(() => {
    setSubscriptionStatus(null);

    refreshSubscriptionStatus();

    if (surface !== "settings") return;

    const intervalId = window.setInterval(refreshSubscriptionStatus, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [surface]);

  useEffect(() => {
    const appIds = Array.from(new Set(cloudSaves
      .filter((save) => {
        const localTitle = cloudBackupGames.find((game) => game.appId === save.appId)?.title;
        return isSteamTitlePlaceholder(save.gameTitle, save.appId)
          && isSteamTitlePlaceholder(localTitle, save.appId)
          && !resolvedCloudGameTitles.has(save.appId);
      })
      .map((save) => save.appId)));
    if (appIds.length === 0) return;

    let cancelled = false;
    void Promise.all(appIds.map(async (appId) => {
      const details = await loadGameStoreDetailsCached(`steam-${appId}`).catch(() => null);
      const title = details?.title?.trim();
      return {
        appId,
        title: title && !isSteamTitlePlaceholder(title, appId) ? title : null,
      };
    })).then((resolvedTitles) => {
      if (cancelled) return;
      setResolvedCloudGameTitles((current) => {
        const next = new Map(current);
        let changed = false;
        for (const { appId, title } of resolvedTitles) {
          if (!title || next.has(appId)) continue;
          next.set(appId, title);
          changed = true;
        }
        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [cloudBackupGames, cloudSaves, resolvedCloudGameTitles]);

  const isPremium = subscriptionStatus?.subscription.isPremium === true;
  const payment = visiblePayment(latestPayment(subscriptionStatus?.latestPayment), subscriptionStatus?.subscription);
  const paymentStatus = payment && subscriptionStatus ? effectivePaymentStatus(payment, subscriptionStatus.subscription) : null;
  const cloudBackupSummaries = (() => {
    const byAppId = new Map<string, CloudBackupGameSummary>();
    for (const save of cloudSaves) {
      const current = byAppId.get(save.appId);
      const updatedAt = save.updatedAt || save.createdAt || null;
      const localGame = cloudBackupGames.find((game) => game.appId === save.appId);
      const localTitle = localGame?.title;
      const remoteTitle = isSteamTitlePlaceholder(save.gameTitle, save.appId) ? null : save.gameTitle;
      const fallbackTitle = localTitle && !isSteamTitlePlaceholder(localTitle, save.appId) ? localTitle : null;
      const profileProgress = save.manifest?.profileProgress;
      const achievementCount = profileProgress?.achievementCount
        ?? (profileProgress?.achievements ? localGame?.achievementCount : undefined);
      if (!current || (updatedAt && (!current.lastBackupAt || Date.parse(updatedAt) > Date.parse(current.lastBackupAt)))) {
        byAppId.set(save.appId, {
          appId: save.appId,
          title: remoteTitle || fallbackTitle || resolvedCloudGameTitles.get(save.appId) || localTitle || save.appId,
          achievementCount: typeof achievementCount === "number" ? achievementCount : null,
          lastBackupAt: updatedAt,
          // Falha registrada localmente (ludusavi) vence o "ok" implícito do
          // save em nuvem — é ela que alimenta o chip bloqueado/erro.
          lastBackupSuccess: localGame?.lastBackupSuccess ?? true,
          lastBackupError: localGame?.lastBackupError ?? null,
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
        <header className="subscription-account__header subscription-account__header--active">
          <h3 className="sr-only">{copy("Assinatura ativa", "Active subscription")}</h3>
          <span className="subscription-account__eyebrow">
            <span className="subscription-account__brand-icon" aria-hidden="true" />
            <span className="subscription-account__brand-name">GHOSTBOX</span>
            <span className="subscription-account__premium-name">PREMIUM</span>
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
                    <BackupGameThumb appId={game.appId} />
                    <div className="subscription-account__backup-title">
                      <strong>{game.title}</strong>
                      {game.achievementCount !== null ? (
                        <span
                          className="subscription-account__achievement-count"
                          aria-label={`${game.achievementCount} ${game.achievementCount === 1
                            ? copy("conquista salva no backup", "achievement saved in backup")
                            : copy("conquistas salvas no backup", "achievements saved in backup")}`}
                        >
                          <Trophy size={15} weight="Filled" color="var(--text-tertiary, var(--text-secondary))" aria-hidden="true" />
                          <span aria-hidden="true">{game.achievementCount}</span>
                        </span>
                      ) : null}
                    </div>
                    {(() => {
                      // Chip de estado bloqueado: para não-Premium uma falha
                      // de backup vira aviso informativo com CTA "Ver planos"
                      // (mesma navegação das ações de notificação), nunca um
                      // erro vermelho. Premium continua vendo a falha real.
                      const failureView = resolveBackupFailureView(isPremium, game);
                      if (failureView.kind === "premium-locked") {
                        return (
                          <span className="subscription-account__backup-state subscription-account__backup-state--premium">
                            <span>{t("premium.lockedBackup.chipLabel")}</span>
                            <button
                              type="button"
                              className="app-notification__action"
                              onClick={() => requestNavigateToSettingsTab("subscription")}
                            >
                              {t("premium.lockedBackup.viewPlans")}
                            </button>
                          </span>
                        );
                      }
                      if (failureView.kind === "failed") {
                        return (
                          <span
                            className="subscription-account__backup-state subscription-account__backup-state--failed"
                            title={game.lastBackupError || undefined}
                          >
                            {t("premium.lockedBackup.failedLabel")}
                          </span>
                        );
                      }
                      return game.lastBackupAt ? <span>{formatDate(game.lastBackupAt, language)}</span> : null;
                    })()}
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
  }> = {
    monthly: {
      price: planPriceLabel("monthly", language),
      cadence: t("subscription.plans.monthly.cadence"),
      description: copy("Ideal para testar a sincronização premium sem compromisso longo.", "Ideal for trying premium sync without a long commitment."),
    },
    quarterly: {
      price: planPriceLabel("quarterly", language),
      cadence: t("subscription.plans.quarterly.cadence"),
      description: copy("Mais economia para manter seus saves protegidos por mais tempo.", "Better value to keep your saves protected for longer."),
    },
  };

  const selectedPaidPlan = paidPlans[selectedPlanId];

  async function handleSubscribe(planId: PaidSubscriptionPlanId) {
    if (status !== "authenticated") {
      openAuthModal();
      return;
    }
    // Deliberately no Discord gate here: the worker never required a link to
    // create a checkout, and blocking the button sent everyone who clicked
    // "Subscribe" to Discord instead of Stripe. Linking is optional and only
    // grants the server's Premium role.
    setCheckoutPlan(planId);
    try {
      const checkout = await ghostboxApi.createSubscriptionCheckout(planId);
      const payment = checkout?.payment;
      if (!payment?.hostedCheckoutUrl) {
        throw new Error(
          copy("Tente novamente em instantes.", "Try again in a moment.")
        );
      }

      // Remembered so that, if the Stripe webhook is delayed or lost, the app
      // can confirm this checkout directly instead of leaving a paying user
      // looking at the plan picker.
      ghostboxApi.setPendingCheckoutId(payment.checkoutId ?? payment.checkoutReference);

      await ghostboxApi.openExternalUrl(payment.hostedCheckoutUrl);
      showToast(
        copy("Checkout aberto", "Checkout opened"),
        copy("Finalize o pagamento na janela aberta e volte ao GhostBox para atualizar o status.", "Complete payment in the opened window and return to GhostBox to refresh status."),
        "success"
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy("Tente novamente em instantes.", "Try again in a moment.");
      showToast(
        copy("Não foi possível criar o checkout", "Could not create checkout"),
        message,
        "error"
      );
    } finally {
      setCheckoutPlan(null);
    }
  }

  return (
    <section
      className={`subscription-plans subscription-plans--${surface} settings-panel__animated-block`}
      style={{
        // Sobe para a raiz da seção: o eyebrow e a marca d'água do card Premium
        // desenham o mesmo glifo via mask.
        ["--subscription-ghost-icon" as string]: `url(${ghostIcon})`,
        ...(enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : {}),
      }}
      aria-label={t("subscription.title")}
    >
      {isSettingsSurface && <SubscriptionBackdrop />}
      <header className="subscription-plans__header">
        <span className="subscription-plans__eyebrow">
          <span className="subscription-plans__eyebrow-icon" aria-hidden="true" />
          {"GhostBox "}
          <strong className="subscription-plans__eyebrow-premium">Premium</strong>
        </span>
        <h3>{t("subscription.title")}</h3>
        {!isSettingsSurface && (
          <p>
            {copy(
              "Tenha seu progresso, conquistas e perfil sempre com você.",
              "Have your progress, achievements, and profile always with you."
            )}
          </p>
        )}
      </header>

      <div className="subscription-plans__grid">
        <article className="subscription-plan-card subscription-plan-card--featured">
          {/* Controle segmentado de cobrança: vive dentro do card Premium,
              junto do preço que ele altera — não mais solto no topo da seção. */}
          <div
            className="subscription-plan-card__billing"
            role="group"
            aria-label={copy("Escolha o período da assinatura", "Choose billing period")}
          >
            <span
              className={`subscription-plan-card__billing-thumb subscription-plan-card__billing-thumb--${selectedPlanId}`}
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
              <span className="subscription-plan-card__billing-hint">
                {`−${t("subscription.plans.quarterly.savingsValue")}`}
              </span>
            </button>
          </div>

          <p className="subscription-plan-card__price">
            <strong>{selectedPaidPlan.price}</strong>
            <span>{selectedPaidPlan.cadence}</span>
          </p>

          <p className="subscription-plan-card__desc">{selectedPaidPlan.description}</p>

          <ul className="subscription-plan-card__benefits">
            {benefits[selectedPlanId].map((benefitKey) => (
              <li key={benefitKey}>
                {renderBenefitIcon(benefitKey)}
                <span>{t(benefitKey)}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="subscription-plan-card__action"
            disabled={checkoutPlan === selectedPlanId}
            onClick={() => void handleSubscribe(selectedPlanId)}
          >
            {checkoutPlan === selectedPlanId ? copy("Abrindo...", "Opening...") : t("subscription.actions.subscribe")}
          </button>
        </article>
      </div>

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
