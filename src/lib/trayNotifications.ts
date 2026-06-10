import type { Language } from "../i18n";

export type TrayHiddenNotificationPayload = {
  title: string;
  message: string;
};

export function getTrayHiddenNotificationCopy(
  language: Language
): TrayHiddenNotificationPayload {
  if (language === "en") {
    return {
      title: "PirateBox is still running",
      message: "Double-click the tray icon to open the app again.",
    };
  }

  return {
    title: "PirateBox continua em execução",
    message: "Clique duas vezes no ícone da bandeja para reabrir o app.",
  };
}

export function showTrayHiddenDesktopNotification(
  payload: TrayHiddenNotificationPayload,
  enabled: boolean
) {
  showAchievementDesktopNotification(payload.title, payload.message, enabled);
}

export function showAchievementDesktopNotification(
  title: string,
  message: string,
  enabled: boolean
) {
  if (!enabled || typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;

  const show = () => {
    try {
      new Notification(title, { body: message });
    } catch {
      // Ignore unsupported desktop notification environments.
    }
  };

  if (Notification.permission === "granted") {
    show();
    return;
  }

  void Notification.requestPermission().then((permission) => {
    if (permission === "granted") show();
  });
}
