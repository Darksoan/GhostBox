import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate } from "../i18n";
import { pirateboxApi } from "../lib/pirateboxApi";

interface AppearanceSettings {
  theme: "dark" | "light";
  gridColumns: 3 | 4 | 5 | 6;
  cardSize: "small" | "medium" | "large";
  bannerAutoplay: boolean;
  language: "pt" | "en";
  disableCoverZoom: boolean;
  disableTabAnimations: boolean;
}

export type NotificationSettings = {
  inAppToastsEnabled: boolean;
  inAppSuccessToastsEnabled: boolean;
  inAppErrorToastsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  achievementsEnabled: boolean;
  backupSuccessEnabled: boolean;
  backupErrorEnabled: boolean;
  restoreSuccessEnabled: boolean;
  restoreErrorEnabled: boolean;
};

interface SettingsContextType {
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  updateAppearance: (settings: Partial<AppearanceSettings>) => void;
  updateNotifications: (settings: Partial<NotificationSettings>) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  gridColumns: 3,
  cardSize: "medium",
  bannerAutoplay: true,
  language: "pt",
  disableCoverZoom: false,
  disableTabAnimations: false,
};

const defaultNotifications: NotificationSettings = {
  inAppToastsEnabled: true,
  inAppSuccessToastsEnabled: true,
  inAppErrorToastsEnabled: true,
  desktopNotificationsEnabled: true,
  achievementsEnabled: true,
  backupSuccessEnabled: true,
  backupErrorEnabled: true,
  restoreSuccessEnabled: true,
  restoreErrorEnabled: true,
};

function normalizeAppearance(value: unknown): AppearanceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultAppearance;
  }

  const appearance = value as Partial<AppearanceSettings> & Record<string, unknown>;
  const legacyReduceAnimations = appearance.reduceAnimations === true;

  return {
    theme: appearance.theme === "light" ? "light" : "dark",
    gridColumns: appearance.gridColumns === 4 || appearance.gridColumns === 5 || appearance.gridColumns === 6 ? appearance.gridColumns : 3,
    cardSize: appearance.cardSize === "small" || appearance.cardSize === "large" ? appearance.cardSize : "medium",
    bannerAutoplay: appearance.bannerAutoplay !== false,
    language: appearance.language === "en" ? "en" : "pt",
    disableCoverZoom: appearance.disableCoverZoom === true || legacyReduceAnimations,
    disableTabAnimations: appearance.disableTabAnimations === true || legacyReduceAnimations,
  };
}

function normalizeNotifications(value: unknown): NotificationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultNotifications;
  }

  const notifications = value as Partial<NotificationSettings>;

  return {
    inAppToastsEnabled: notifications.inAppToastsEnabled !== false,
    inAppSuccessToastsEnabled: notifications.inAppSuccessToastsEnabled !== false,
    inAppErrorToastsEnabled: notifications.inAppErrorToastsEnabled !== false,
    desktopNotificationsEnabled: notifications.desktopNotificationsEnabled !== false,
    achievementsEnabled: notifications.achievementsEnabled !== false,
    backupSuccessEnabled: notifications.backupSuccessEnabled !== false,
    backupErrorEnabled: notifications.backupErrorEnabled !== false,
    restoreSuccessEnabled: notifications.restoreSuccessEnabled !== false,
    restoreErrorEnabled: notifications.restoreErrorEnabled !== false,
  };
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    try {
      const saved = localStorage.getItem("piratebox-appearance");
      return saved ? normalizeAppearance(JSON.parse(saved)) : defaultAppearance;
    } catch {
      return defaultAppearance;
    }
  });

  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem("piratebox-notifications");
      return saved ? normalizeNotifications(JSON.parse(saved)) : defaultNotifications;
    } catch {
      return defaultNotifications;
    }
  });

  const updateAppearance = useCallback(
    (settings: Partial<AppearanceSettings>) => {
      setAppearance((current) => {
        const updated = normalizeAppearance({ ...current, ...settings });
        localStorage.setItem("piratebox-appearance", JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const updateNotifications = useCallback(
    (settings: Partial<NotificationSettings>) => {
      setNotifications((current) => {
        const updated = normalizeNotifications({ ...current, ...settings });
        localStorage.setItem("piratebox-notifications", JSON.stringify(updated));
        void pirateboxApi.setNotificationSettings(updated).catch(() => undefined);
        return updated;
      });
    },
    []
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(appearance.language, key, params),
    [appearance.language]
  );

  useEffect(() => {
    document.documentElement.lang = appearance.language === "pt" ? "pt-BR" : "en";
  }, [appearance.language]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-cover-zoom", appearance.disableCoverZoom);
    document.documentElement.classList.toggle("no-tab-animations", appearance.disableTabAnimations);
  }, [appearance.disableCoverZoom, appearance.disableTabAnimations]);

  useEffect(() => {
    void pirateboxApi.setNotificationSettings(notifications).catch(() => undefined);
  }, [notifications]);

  const value = useMemo<SettingsContextType>(
    () => ({ appearance, notifications, updateAppearance, updateNotifications, t }),
    [appearance, notifications, updateAppearance, updateNotifications, t]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
