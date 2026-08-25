import { describe, expect, it } from "vitest";
import {
  buildPremiumBackupNudgeNotification,
  hasSeenPremiumBackupNudge,
  markPremiumBackupNudgeSeen,
  premiumBackupNudgeStorageKey,
} from "../src/utils/premiumNudge";
import { normalizeNotification } from "../src/lib/appNotifications";
import { resolveBackupFailureView } from "../src/utils/backupStatusDisplay";

/** Storage mínimo em memória (mesma forma de `Pick<Storage, "getItem" | "setItem">`). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const baseItem = {
  id: "n1",
  type: "backup" as const,
  severity: "info" as const,
  title: "Título",
  message: "Mensagem",
  createdAt: 1_700_000_000_000,
};

describe("normalização de notificações com action", () => {
  it("preserva action com target subscription", () => {
    const normalized = normalizeNotification({
      ...baseItem,
      action: { label: "Conhecer Premium", target: "subscription" },
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.action).toEqual({
      label: "Conhecer Premium",
      target: "subscription",
    });
  });

  it("aceita itens sem action", () => {
    const normalized = normalizeNotification(baseItem);

    expect(normalized).not.toBeNull();
    expect(normalized?.action).toBeUndefined();
  });

  it("descarta action sem rótulo utilizável em vez de quebrar", () => {
    const normalized = normalizeNotification({
      ...baseItem,
      action: { label: "   ", target: "subscription" },
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.action).toBeUndefined();
  });
});

describe("flag única do nudge premium (localStorage)", () => {
  it("começa invisível e fica visível após marcar", () => {
    const storage = memoryStorage();

    expect(hasSeenPremiumBackupNudge(storage)).toBe(false);

    markPremiumBackupNudgeSeen(storage);

    expect(hasSeenPremiumBackupNudge(storage)).toBe(true);
    expect(storage.getItem(premiumBackupNudgeStorageKey)).toBe("1");
  });

  it("a flag impede o segundo push do nudge", () => {
    const storage = memoryStorage();
    const pushNudge = () => {
      if (hasSeenPremiumBackupNudge(storage)) return false;
      markPremiumBackupNudgeSeen(storage);
      return true;
    };

    expect(pushNudge()).toBe(true); // primeiro evento → empurra
    expect(pushNudge()).toBe(false); // segundo evento → ignorado
  });
});

describe("notificação do nudge premium", () => {
  it("usa id estável, tipo backup, severidade info e CTA para Assinatura", () => {
    const item = buildPremiumBackupNudgeNotification(
      { title: "Backup em nuvem é Premium", message: "msg", actionLabel: "Conhecer Premium" },
      123,
    );

    expect(item.id).toBe("backup:premium-nudge");
    expect(item.type).toBe("backup");
    expect(item.severity).toBe("info");
    expect(item.createdAt).toBe(123);
    expect(item.action).toEqual({ label: "Conhecer Premium", target: "subscription" });
    // A notificação gerada sobrevive ao próprio normalizador do feed.
    expect(normalizeNotification(item)).toEqual(item);
  });
});

describe("chip de estado bloqueado de backup", () => {
  it("não exibe nada quando não há falha", () => {
    expect(resolveBackupFailureView(false, { lastBackupSuccess: true })).toEqual({ kind: "none" });
    expect(resolveBackupFailureView(true, null)).toEqual({ kind: "none" });
    expect(resolveBackupFailureView(false, { lastBackupSuccess: null })).toEqual({ kind: "none" });
  });

  it("usuário free vê chip neutro de bloqueio, não erro", () => {
    expect(
      resolveBackupFailureView(false, { lastBackupSuccess: false, lastBackupError: "boom" }),
    ).toEqual({ kind: "premium-locked" });
  });

  it("usuário premium continua vendo a falha real", () => {
    expect(
      resolveBackupFailureView(true, { lastBackupSuccess: false, lastBackupError: "boom" }),
    ).toEqual({ kind: "failed" });
  });
});
