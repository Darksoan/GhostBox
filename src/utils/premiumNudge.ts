import type { AppNotificationItem } from "../lib/appNotifications";

/**
 * Nudge único do evento Tauri `premium-backup-nudge`.
 *
 * O backend emite o evento quando um usuário FREE fecha uma partida (backups
 * são exclusivos do Premium). A flag em localStorage garante que o aviso seja
 * empurrado UMA única vez por instalação, mesmo que o evento chegue várias
 * vezes. Funções puras (storage injetável) para serem testáveis via vitest.
 */

export const premiumBackupNudgeStorageKey = "ghostbox:premium-nudge:v1";

export type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

export function hasSeenPremiumBackupNudge(storage: MinimalStorage): boolean {
  try {
    return storage.getItem(premiumBackupNudgeStorageKey) === "1";
  } catch {
    return false;
  }
}

export function markPremiumBackupNudgeSeen(storage: MinimalStorage): void {
  try {
    storage.setItem(premiumBackupNudgeStorageKey, "1");
  } catch {
    // Best-effort: sem persistência o nudge pode reaparecer, o que é
    // preferível a quebrar o fluxo de notificações.
  }
}

export type PremiumBackupNudgeCopy = {
  title: string;
  message: string;
  actionLabel: string;
};

/** Notificação informativa estável (`backup:premium-nudge`) com CTA para a aba
 * Assinatura das configurações. */
export function buildPremiumBackupNudgeNotification(
  copy: PremiumBackupNudgeCopy,
  createdAt = Date.now(),
): AppNotificationItem {
  return {
    id: "backup:premium-nudge",
    type: "backup",
    severity: "info",
    title: copy.title,
    message: copy.message,
    createdAt,
    action: { label: copy.actionLabel, target: "subscription" },
  };
}
