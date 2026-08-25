import type { SettingsTabId } from "../features/settings/settingsTabsShared";

/**
 * Barramento leve de navegação interna baseado em CustomEvent de window —
 * mesmo padrão de `appNotificationsChangedEvent` (lib/appNotifications.ts).
 *
 * Escolha de design: páginas profundas (ex.: lista de notificações) não recebem
 * `navigate`/`setActiveSettingsTabId` via props hoje; prop-drilling até o App
 * custaria mais que um evento. O App escuta este evento uma única vez e resolve
 * com o mesmo caminho da tray (`handleNavigate` + `setActiveSettingsTabId`).
 */

export const appNavigateToSettingsTabEvent = "ghostbox:navigate-to-settings-tab";

export function requestNavigateToSettingsTab(tabId: SettingsTabId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(appNavigateToSettingsTabEvent, { detail: { tabId } }),
  );
}

export function onAppNavigateToSettingsTab(
  callback: (tabId: SettingsTabId) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ tabId?: unknown }>).detail;
    if (detail && typeof detail.tabId === "string") {
      callback(detail.tabId as SettingsTabId);
    }
  };

  window.addEventListener(appNavigateToSettingsTabEvent, handler);
  return () => window.removeEventListener(appNavigateToSettingsTabEvent, handler);
}
