import type { Page } from "../types";
import {
  readNotificationsLastSeenAt,
  writeNotificationsLastSeenAt,
} from "../utils/storage";

export type AppNotificationType =
  | "system"
  | "library"
  | "backup"
  | "achievement"
  | "account"
  | "download"
  | "favorite"
  | "collection";

export type AppNotificationSeverity = "info" | "success" | "warning" | "error";

export type AppNotificationItem = {
  id: string;
  type: AppNotificationType;
  severity: AppNotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  action?: {
    label: string;
    page?: Page;
    url?: string;
  };
  game?: {
    appId?: string;
    title: string;
    coverUrl?: string;
    headerUrl?: string;
  };
};

const storageKey = "ghostbox:notification-feed:v1";
const maxStoredNotifications = 100;
const maxNotificationAgeMs = 30 * 24 * 60 * 60 * 1000;
export const appNotificationsChangedEvent = "ghostbox:app-notifications-changed";

function isNotificationType(value: unknown): value is AppNotificationType {
  return value === "system" ||
    value === "library" ||
    value === "backup" ||
    value === "achievement" ||
    value === "account" ||
    value === "download" ||
    value === "favorite" ||
    value === "collection";
}

function isSeverity(value: unknown): value is AppNotificationSeverity {
  return value === "info" || value === "success" || value === "warning" || value === "error";
}

function normalizeNotificationGame(value: unknown): AppNotificationItem["game"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const game = value as Record<string, unknown>;
  if (typeof game.title !== "string" || !game.title.trim()) return undefined;

  return {
    ...(typeof game.appId === "string" && game.appId.trim()
      ? { appId: game.appId }
      : {}),
    title: game.title,
    ...(typeof game.coverUrl === "string" && game.coverUrl.trim()
      ? { coverUrl: game.coverUrl }
      : {}),
    ...(typeof game.headerUrl === "string" && game.headerUrl.trim()
      ? { headerUrl: game.headerUrl }
      : {}),
  };
}

function normalizeNotification(value: unknown): AppNotificationItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const item = value as Partial<AppNotificationItem> & Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (!isNotificationType(item.type)) return null;
  if (!isSeverity(item.severity)) return null;
  if (typeof item.title !== "string" || !item.title.trim()) return null;
  if (typeof item.message !== "string" || !item.message.trim()) return null;
  if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) return null;

  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    message: item.message,
    createdAt: item.createdAt,
    action: item.action,
    game: normalizeNotificationGame(item.game),
  };
}

function pruneNotifications(items: AppNotificationItem[]) {
  const cutoff = Date.now() - maxNotificationAgeMs;
  return items
    .filter((item) => item.createdAt >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, maxStoredNotifications);
}

function notifyChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(appNotificationsChangedEvent));
}

export function readAppNotifications(): AppNotificationItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneNotifications(parsed.flatMap((item) => {
      const normalized = normalizeNotification(item);
      return normalized ? [normalized] : [];
    }));
  } catch {
    return [];
  }
}

export function writeAppNotifications(items: AppNotificationItem[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(pruneNotifications(items)));
    notifyChanged();
  } catch {
    // Notification history is best-effort only.
  }
}

export function pushAppNotification(item: AppNotificationItem) {
  const current = readAppNotifications().filter((notification) => notification.id !== item.id);
  writeAppNotifications([item, ...current]);
}

export function clearAppNotifications() {
  writeAppNotifications([]);
}

export function markAppNotificationsSeen(timestamp = Date.now()) {
  writeNotificationsLastSeenAt(timestamp);
  notifyChanged();
}

export function getUnreadAppNotificationCount() {
  const seenAt = readNotificationsLastSeenAt();
  return readAppNotifications().reduce(
    (total, item) => item.createdAt > seenAt ? total + 1 : total,
    0,
  );
}
