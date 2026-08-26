import type { SubscriptionPlanId as PaidSubscriptionPlanId } from "./ghostboxApi.types";

/** Fonte única do preço exibido em qualquer superfície da oferta. */
export function planPriceLabel(planId: PaidSubscriptionPlanId, language: "pt" | "en") {
  if (planId === "quarterly") return language === "en" ? "$2.90" : "R$ 14,99";
  return language === "en" ? "$1.35" : "R$ 6,99";
}

/** Preço normalizado por mês — usado para comparar planos lado a lado. */
export function planMonthlyPriceLabel(planId: PaidSubscriptionPlanId, language: "pt" | "en") {
  if (planId === "quarterly") return language === "en" ? "$0.97" : "R$ 5,00";
  return planPriceLabel("monthly", language);
}
