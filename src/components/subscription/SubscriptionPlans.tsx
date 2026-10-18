import { CreditCard, ExternalLink, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { Trophy } from "reicon-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import { useSubscriptionCheckout } from "../../hooks/useSubscriptionCheckout";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { requestNavigateToSettingsTab } from "../../lib/appNavigation";
import type {
  CloudSave,
  SubscriptionPayment,
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
import { PremiumOffer } from "./PremiumOffer";
import { PaginationControls } from "../ui/PaginationControls";
import { useOverlay } from "../../context/OverlayContext";
import { BackupConfirmModal, type BackupConfirmAction } from "./BackupConfirmModal";

const backupsPerPage = 10;

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
  saveId: string;
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

export function SubscriptionPlans({
  surface = "settings",
  enterDelay,
  cloudBackupGames = [],
  steamProfile: steamProfileProp,
}: SubscriptionPlansProps) {
  const { appearance, t } = useSettings();
  const { portalFlow, openBillingPortal } = useSubscriptionCheckout();
  const appData = useAppData();
  const { account } = useAuth();
  const userId = account?.userId ?? null;
  const activeUserIdRef = useRef(userId);
  activeUserIdRef.current = userId;
  const { showToast } = useOverlay();
  const steamProfile = steamProfileProp ?? appData.steamProfile;
  const [subscriptionState, setSubscriptionState] = useState<{ userId: string; status: SubscriptionStatusResult } | null>(null);
  const subscriptionStatus = subscriptionState?.userId === userId ? subscriptionState.status : null;
  const [subscriptionLoading, setSubscriptionLoading] = useState(surface === "settings");
  const [cloudSaveState, setCloudSaveState] = useState<{ userId: string; saves: CloudSave[] } | null>(null);
  const cloudSaves = cloudSaveState?.userId === userId ? cloudSaveState.saves : [];
  const [backupPage, setBackupPage] = useState(1);
  const backupListRef = useRef<HTMLUListElement>(null);
  const backupHeadingRef = useRef<HTMLHeadingElement>(null);
  const backupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cloudSavesRequestIdRef = useRef(0);
  const [backupConfirm, setBackupConfirm] = useState<{
    action: BackupConfirmAction;
    appId: string;
    saveId: string;
    title: string;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [resolvedCloudGameTitles, setResolvedCloudGameTitles] = useState<Map<string, string>>(new Map());
  const subscriptionRequestIdRef = useRef(0);
  const language = appearance.language;
  const copy = (pt: string, en: string) => language === "en" ? en : pt;

  function refreshCloudSaves() {
    if (!userId) return;
    const requestId = ++cloudSavesRequestIdRef.current;
    void ghostboxApi.listCloudSaves()
      .then((saves) => {
        if (requestId === cloudSavesRequestIdRef.current && activeUserIdRef.current === userId) {
          setCloudSaveState({ userId, saves });
        }
      })
      .catch((error) => {
        console.warn("Could not list cloud saves", error);
      });
  }

  function refreshSubscriptionStatus() {
    if (!userId) return;
    const requestId = ++subscriptionRequestIdRef.current;
    setSubscriptionLoading(true);
    void ghostboxApi.getSubscriptionStatus()
      .then((status) => {
        if (requestId !== subscriptionRequestIdRef.current || activeUserIdRef.current !== userId) return;
        // A failed poll (this runs every 10s) must not blank the panel — doing
        // so showed the plan picker to someone who is already subscribed.
        if (!status) return;

        setSubscriptionState({ userId, status });
        // Keeps the shared cache warm — `useDiscordLink` reads from it — without
        // holding a second copy of the link state in this component.
        if (status.discordLink) ghostboxApi.cacheDiscordLinkStatus(status.discordLink);
        if (status.subscription.isPremium) refreshCloudSaves();
        else {
          cloudSavesRequestIdRef.current += 1;
          setCloudSaveState({ userId, saves: [] });
        }
      })
      .finally(() => {
        if (requestId === subscriptionRequestIdRef.current && activeUserIdRef.current === userId) setSubscriptionLoading(false);
      });
  }

  useEffect(() => {
    setSubscriptionState(null);
    setCloudSaveState(null);
    setResolvedCloudGameTitles(new Map());
    setBackupConfirm(null);
    setBackupError(null);
    setBackupBusy(false);
    cloudSavesRequestIdRef.current += 1;
    subscriptionRequestIdRef.current += 1;

    refreshSubscriptionStatus();

    const intervalId = surface === "settings"
      ? window.setInterval(refreshSubscriptionStatus, 10000)
      : null;

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      cloudSavesRequestIdRef.current += 1;
      subscriptionRequestIdRef.current += 1;
    };
  }, [surface, userId]);

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
  const isLifetime = subscriptionStatus?.subscription.accessType === "lifetime";
  const canManageBilling = subscriptionStatus?.subscription.canManageBilling === true;
  const payment = isLifetime
    ? null
    : visiblePayment(latestPayment(subscriptionStatus?.latestPayment), subscriptionStatus?.subscription);
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
          saveId: save.id,
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

  const closeBackupConfirm = () => {
    if (backupBusy) return;
    setBackupConfirm(null);
    setBackupError(null);
    window.requestAnimationFrame(() => {
      if (backupTriggerRef.current?.isConnected) backupTriggerRef.current.focus();
      else backupHeadingRef.current?.focus();
    });
  };

  const confirmBackupAction = async () => {
    if (!backupConfirm || backupBusy) return;
    const { action, appId, saveId, title } = backupConfirm;
    const actionUserId = userId;
    setBackupBusy(true);
    setBackupError(null);
    try {
      if (action === "restore") {
        const saves = await ghostboxApi.listCloudSaves(appId).catch(() => null);
        if (activeUserIdRef.current !== actionUserId) return;
        const newest = (saves ?? []).reduce<CloudSave | null>((latest, save) => {
          if (!latest) return save;
          return Date.parse(save.updatedAt || save.createdAt || "") > Date.parse(latest.updatedAt || latest.createdAt || "")
            ? save
            : latest;
        }, null);
        const targetSaveId = newest?.id ?? saveId;
        const game = appData.addedLibraryGames.find((candidate) => candidate.appId === appId) ?? { appId, title };
        const result = await ghostboxApi.restoreCloudSave(game, targetSaveId);
        if (activeUserIdRef.current !== actionUserId) return;
        if (!result?.success) throw new Error(copy("Não foi possível restaurar o backup.", "Could not restore the backup."));
        showToast(
          copy("Backup restaurado", "Backup restored"),
          copy(`Backup de "${title}" restaurado.`, `Backup for "${title}" restored.`),
          "success",
        );
      } else {
        const result = await ghostboxApi.deleteCloudGameSaves(appId);
        if (activeUserIdRef.current !== actionUserId) return;
        if (!result?.success) throw new Error(copy("Não foi possível excluir o backup.", "Could not delete the backup."));
        // Invalidate polls started before deletion, or an older response could resurrect the row.
        cloudSavesRequestIdRef.current += 1;
        setCloudSaveState((current) => current?.userId === actionUserId
          ? { ...current, saves: current.saves.filter((save) => save.appId !== appId) }
          : current);
        refreshCloudSaves();
        if (result.deletedSaves > 0) {
          showToast(
            copy("Backup excluído", "Backup deleted"),
            copy(`Backup de "${title}" removido da nuvem.`, `Cloud backup for "${title}" deleted.`),
            "success",
          );
        } else {
          // O servidor não tinha mais nada para este jogo (ex.: exclusão
          // concorrente ou linha legada) — não é um sucesso falso, só informa.
          showToast(
            copy("Backup já removido", "Backup already removed"),
            copy(`Nenhum backup de "${title}" restava na nuvem. A lista foi atualizada.`, `No cloud backup for "${title}" remained. The list was refreshed.`),
            "info",
          );
        }
      }
      setBackupConfirm(null);
      setBackupError(null);
      window.requestAnimationFrame(() => {
        if (backupTriggerRef.current?.isConnected) backupTriggerRef.current.focus();
        else backupHeadingRef.current?.focus();
      });
    } catch (error) {
      if (activeUserIdRef.current !== actionUserId) return;
      const message = error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : copy("Não foi possível concluir a operação.", "Could not complete this action.");
      setBackupError(message);
      showToast(
        action === "restore" ? copy("Falha na restauração", "Restore failed") : copy("Falha na exclusão", "Delete failed"),
        message,
        "error",
      );
    } finally {
      if (activeUserIdRef.current === actionUserId) setBackupBusy(false);
    }
  };

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
    // Keep the most recent backups first across all pages.
    const recentBackups = [...cloudBackupSummaries].sort((a, b) => {
      const dateA = a.lastBackupAt ? Date.parse(a.lastBackupAt) : 0;
      const dateB = b.lastBackupAt ? Date.parse(b.lastBackupAt) : 0;
      return dateB - dateA;
    });
    const totalBackupPages = Math.ceil(recentBackups.length / backupsPerPage);
    const currentBackupPage = Math.min(backupPage, Math.max(1, totalBackupPages));
    const visibleBackups = recentBackups.slice(
      (currentBackupPage - 1) * backupsPerPage,
      currentBackupPage * backupsPerPage,
    );

    return (
      <section
        className="subscription-account settings-panel__animated-block"
        style={{
          ...(enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : {}),
        }}
        aria-label={copy("Resumo da assinatura Premium", "Premium subscription summary")}
      >
        <header className="subscription-account__header subscription-account__header--active">
          <h3 className="sr-only">{copy("Assinatura ativa", "Active subscription")}</h3>
          <span className="subscription-account__eyebrow">
            <span className="subscription-account__brand-name">GHOSTBOX</span>
            <span className="subscription-account__premium-name">PREMIUM</span>
          </span>
        </header>

        <div className="subscription-account__summary-grid">
          <article className="subscription-account__summary-card">
            <span>
              {isLifetime
                ? copy("Tipo de acesso", "Access type")
                : subscriptionStatus.subscription.cancelAtPeriodEnd
                ? copy("Acesso até", "Access until")
                : copy("Próxima cobrança", "Next billing")}
            </span>
            <strong>
              {isLifetime
                ? copy("Vitalício", "Lifetime")
                : formatBillingDate(subscriptionStatus.subscription.currentPeriodEnd, language)}
            </strong>
          </article>
          <article className="subscription-account__summary-card">
            <span>{isLifetime ? copy("Cobrança", "Billing") : copy("Método de pagamento", "Payment method")}</span>
            <strong>
              {isLifetime
                ? copy("Não se aplica", "Not applicable")
                : formatPaymentMethodLabel(subscriptionStatus.paymentMethod, language)}
            </strong>
          </article>
          <article className="subscription-account__summary-card">
            <span>{copy("Backups em nuvem", "Cloud backups")}</span>
            <strong>{cloudBackupSummaries.length}</strong>
          </article>
        </div>

        <div className="subscription-account__details-grid">
          <article className={`subscription-account__panel${!payment ? " subscription-account__panel--empty-payment" : ""}`}>
            <h4>{isLifetime ? copy("Acesso Premium", "Premium access") : copy("Pagamentos", "Payments")}</h4>
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
                {!isLifetime && (
                  <strong>{copy("Nenhum pagamento listado", "No payments listed")}</strong>
                )}
                <p>
                  {isLifetime
                    ? copy("Seu acesso não exige pagamentos recorrentes.", "Your access requires no recurring payments.")
                    : copy("O histórico aparece após a confirmação no Stripe.", "History appears after Stripe confirmation.")}
                </p>
              </div>
            )}
          </article>

          <article className="subscription-account__panel">
            <h4 ref={backupHeadingRef} tabIndex={-1}>{copy("Jogos com backup em nuvem", "Games with cloud backup")}</h4>
            {recentBackups.length > 0 ? (
              <ul className="subscription-account__backup-list" ref={backupListRef}>
                {visibleBackups.map((game) => (
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
                    <div className="subscription-account__backup-meta">
                      <div className="subscription-account__backup-date">
                        {(() => {
                          // Falha local vence o "ok" implícito do save remoto.
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
                                aria-label={game.lastBackupError || t("premium.lockedBackup.failedLabel")}
                              >
                                {t("premium.lockedBackup.failedLabel")}
                              </span>
                            );
                          }
                          return game.lastBackupAt ? <span>{formatDate(game.lastBackupAt, language)}</span> : null;
                        })()}
                      </div>
                      <div className="subscription-account__backup-row-actions" role="group" aria-label={copy(`Ações de backup de ${game.title}`, `Backup actions for ${game.title}`)}>
                        <button
                          type="button"
                          aria-label={copy(`Restaurar backup de ${game.title}`, `Restore backup for ${game.title}`)}
                          onClick={(event) => {
                            backupTriggerRef.current = event.currentTarget;
                            setBackupError(null);
                            setBackupConfirm({ action: "restore", appId: game.appId, saveId: game.saveId, title: game.title });
                          }}
                        >
                          <RotateCcw size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={copy(`Excluir backup de ${game.title}`, `Delete backup for ${game.title}`)}
                          onClick={(event) => {
                            backupTriggerRef.current = event.currentTarget;
                            setBackupError(null);
                            setBackupConfirm({ action: "delete", appId: game.appId, saveId: game.saveId, title: game.title });
                          }}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="subscription-account__empty">
                <strong>{copy("Nenhum backup em nuvem", "No cloud backups yet")}</strong>
                <p>{copy("Faça backup de um jogo para ver o histórico aqui.", "Back up a game to see history here.")}</p>
              </div>
            )}
            {totalBackupPages > 1 && (
              <PaginationControls
                page={currentBackupPage}
                totalPages={totalBackupPages}
                onPageChange={(page) => {
                  setBackupPage(page);
                  backupListRef.current?.scrollTo({ top: 0 });
                }}
                ariaLabel={copy("Páginas dos jogos com backup", "Backed-up games pages")}
              />
            )}
          </article>
        </div>

        {canManageBilling ? <div className="subscription-account__actions" role="group" aria-label={copy("Gerenciar assinatura", "Manage subscription")}>
          <button
            type="button"
            className="subscription-account__action-button"
            disabled={Boolean(portalFlow)}
            onClick={() => void openBillingPortal("manage")}
          >
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
            <span>
              {portalFlow === "manage"
                ? copy("Abrindo…", "Opening…")
                : copy("Gerenciar assinatura", "Manage subscription")}
            </span>
            <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="subscription-account__action-button"
            disabled={Boolean(portalFlow)}
            onClick={() => void openBillingPortal("payment_method_update")}
          >
            <CreditCard size={15} strokeWidth={2} aria-hidden="true" />
            <span>
              {portalFlow === "payment_method_update"
                ? copy("Abrindo…", "Opening…")
                : copy("Alterar método de pagamento", "Change payment method")}
            </span>
            <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div> : null}
        {backupConfirm && (
          <BackupConfirmModal
            action={backupConfirm.action}
            gameTitle={backupConfirm.title}
            busy={backupBusy}
            error={backupError}
            onCancel={closeBackupConfirm}
            onConfirm={() => void confirmBackupAction()}
          />
        )}
      </section>
    );
  }

  // Mesma tela do modal Premium, e não uma segunda versão do argumento: a aba
  // e o diálogo compartilham `PremiumOffer`, então copy, planos, acordeão e
  // animação são um só. O container aqui só fornece a grade e a superfície.
  return (
    <section
      className="premium-offer premium-offer--settings settings-panel__animated-block"
      style={{
        ["--subscription-ghost-icon" as string]: `url(${ghostIcon})`,
        ...(enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : {}),
      }}
      aria-label={t("subscription.title")}
    >
      <PremiumOffer />
    </section>
  );
}
