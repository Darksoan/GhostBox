import { useState } from "react";

import { useAuth } from "../context/AuthContext";
import { useOverlay } from "../context/OverlayContext";
import { useSettings } from "../context/settings";
import { ghostboxApi } from "../lib/ghostboxApi";
import type {
  SubscriptionPlanId as PaidSubscriptionPlanId,
  SubscriptionPortalFlow,
} from "../lib/ghostboxApi.types";

/**
 * Checkout e portal de cobrança da assinatura, sem UI.
 *
 * Vive fora dos componentes porque a oferta aparece em duas superfícies com
 * layouts diferentes (o painel de Ajustes e o modal Premium) e as duas precisam
 * exatamente do mesmo fluxo: gate de login, criação da sessão no worker,
 * memorização do checkout pendente e abertura no navegador.
 */
export function useSubscriptionCheckout() {
  const { appearance } = useSettings();
  const { showToast } = useOverlay();
  const { status, openAuthModal } = useAuth();
  const [checkoutPlan, setCheckoutPlan] = useState<PaidSubscriptionPlanId | null>(null);
  const [portalFlow, setPortalFlow] = useState<SubscriptionPortalFlow | null>(null);

  const language = appearance.language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);

  async function startCheckout(planId: PaidSubscriptionPlanId) {
    if (status !== "authenticated") {
      openAuthModal();
      return;
    }
    // Deliberadamente sem gate de Discord: o worker nunca exigiu vínculo para
    // criar um checkout, e bloquear o botão mandava para o Discord quem só
    // queria pagar. O vínculo é opcional e só concede o cargo no servidor.
    setCheckoutPlan(planId);
    try {
      const checkout = await ghostboxApi.createSubscriptionCheckout(planId);
      const payment = checkout?.payment;
      if (!payment?.hostedCheckoutUrl) {
        throw new Error(copy("Tente novamente em instantes.", "Try again in a moment."));
      }

      // Guardado para que, se o webhook da Stripe atrasar ou se perder, o app
      // consiga confirmar este checkout direto em vez de deixar quem pagou
      // olhando para a tela de planos.
      ghostboxApi.setPendingCheckoutId(payment.checkoutId ?? payment.checkoutReference);

      await ghostboxApi.openExternalUrl(payment.hostedCheckoutUrl);
      showToast(
        copy("Checkout aberto", "Checkout opened"),
        copy(
          "Finalize o pagamento na janela aberta e volte ao GhostBox para atualizar o status.",
          "Complete payment in the opened window and return to GhostBox to refresh status."
        ),
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

  async function openBillingPortal(flow: SubscriptionPortalFlow) {
    if (portalFlow) return;

    setPortalFlow(flow);
    try {
      const session = await ghostboxApi.createSubscriptionPortalSession(flow);
      if (!session?.url) {
        throw new Error(
          copy("Não foi possível abrir o portal de cobrança.", "Could not open the billing portal.")
        );
      }
      await ghostboxApi.openExternalUrl(session.url);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy("Não foi possível abrir o portal de cobrança.", "Could not open the billing portal.");
      showToast(copy("Portal de assinatura", "Subscription portal"), message, "error");
    } finally {
      setPortalFlow(null);
    }
  }

  return { checkoutPlan, startCheckout, portalFlow, openBillingPortal };
}
