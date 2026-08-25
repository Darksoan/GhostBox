/**
 * Estado de falha de backup exibido por superfície que lista registros de
 * backup (`lastBackupSuccess === false` / `lastBackupError`).
 *
 * Decisão de produto: backups são exclusivos do Premium. Para usuários FREE,
 * uma falha de backup não é um erro acionável — vira chip neutro/informativo
 * com CTA para os planos. Usuários Premium continuam vendo o erro real.
 *
 * Nota: hoje nenhum painel de jogo (GameModal etc.) renderiza estado vermelho
 * de erro de backup; a única lista com esse dado é o resumo da aba Assinatura
 * (SubscriptionPlans), onde o helper é aplicado.
 */

export type BackupFailureView =
  | { kind: "none" }
  | { kind: "premium-locked" }
  | { kind: "failed" };

export type BackupFailureRecord = {
  lastBackupSuccess?: boolean | null;
  lastBackupError?: string | null;
};

export function resolveBackupFailureView(
  viewerIsPremium: boolean,
  record: BackupFailureRecord | null | undefined,
): BackupFailureView {
  if (record?.lastBackupSuccess !== false) return { kind: "none" };
  return viewerIsPremium ? { kind: "failed" } : { kind: "premium-locked" };
}
