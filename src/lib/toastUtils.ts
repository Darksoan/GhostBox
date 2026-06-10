import type { ToastVariant } from "../components/ui/Toast";

export function getToastVariant(
  title: string,
  variant?: ToastVariant
): ToastVariant {
  if (variant) return variant;

  return /falha|erro|inv[aá]lid|aten[cç][aã]o|indispon|n[aã]o foi poss/i.test(
    title
  )
    ? "error"
    : "success";
}
