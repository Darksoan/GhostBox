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
import { ghostboxApi } from "../lib/ghostboxApi";
import { setPreferLowResCovers } from "../utils/image";
import { setImagePreloadConcurrency } from "../utils/imageCache";

export interface AppearanceSettings {
  theme: "dark" | "light";
  gridColumns: 3 | 4 | 5 | 6;
  cardSize: "small" | "medium" | "large";
  bannerAutoplay: boolean;
  language: "pt" | "en";
  reduceAllAnimations: boolean;
  disableBackdropBlur: boolean;
  trailerQuality: "high" | "low";
  trailerAutoplay: boolean;
  preferLowResCovers: boolean;
  imagePreloadConcurrency: 2 | 4 | 6;
  disablePageKeepAlive: boolean;
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
  reduceAllAnimations: false,
  disableBackdropBlur: false,
  trailerQuality: "high",
  trailerAutoplay: true,
  preferLowResCovers: false,
  imagePreloadConcurrency: 4,
  disablePageKeepAlive: false,
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
  const imagePreloadConcurrency =
    appearance.imagePreloadConcurrency === 2 ||
    appearance.imagePreloadConcurrency === 6
      ? appearance.imagePreloadConcurrency
      : 4;
  const trailerAutoplay = typeof appearance.trailerAutoplay === "boolean"
    ? appearance.trailerAutoplay
    : appearance.bannerAutoplay !== false;

  return {
    theme: appearance.theme === "light" ? "light" : "dark",
    gridColumns: appearance.gridColumns === 4 || appearance.gridColumns === 5 || appearance.gridColumns === 6 ? appearance.gridColumns : 3,
    cardSize: appearance.cardSize === "small" || appearance.cardSize === "large" ? appearance.cardSize : "medium",
    bannerAutoplay: appearance.bannerAutoplay !== false,
    language: appearance.language === "en" ? "en" : "pt",
    reduceAllAnimations: appearance.reduceAllAnimations === true,
    disableBackdropBlur: appearance.disableBackdropBlur === true,
    trailerQuality: appearance.trailerQuality === "low" ? "low" : "high",
    trailerAutoplay,
    preferLowResCovers: appearance.preferLowResCovers === true,
    imagePreloadConcurrency,
    disablePageKeepAlive: appearance.disablePageKeepAlive === true,
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
const appearanceStorageKey = "ghostbox-appearance";
const legacyEdenAppearanceStorageKey = "eden-appearance";
const legacyAppearanceStorageKey = "piratebox-appearance";
const notificationsStorageKey = "ghostbox-notifications";
const legacyEdenNotificationsStorageKey = "eden-notifications";
const legacyNotificationsStorageKey = "piratebox-notifications";

function readStoredAppearance(): AppearanceSettings {
  try {
    const saved =
      localStorage.getItem(appearanceStorageKey) ??
      localStorage.getItem(legacyEdenAppearanceStorageKey) ??
      localStorage.getItem(legacyAppearanceStorageKey);
    return saved ? normalizeAppearance(JSON.parse(saved)) : defaultAppearance;
  } catch {
    return defaultAppearance;
  }
}

/**
 * Lê o idioma atual fora do ciclo de vida do React. A camada de dados e o
 * cache de jogos precisam saber em que idioma pedir conteúdo à Steam
 * (descrição, requisitos, gêneros) mesmo rodando fora de um componente —
 * por isso não dá para depender de `useSettings`.
 */
export function getCurrentAppearanceLanguage(): AppearanceSettings["language"] {
  return readStoredAppearance().language;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettings>(readStoredAppearance);

  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    try {
      const saved =
        localStorage.getItem(notificationsStorageKey) ??
        localStorage.getItem(legacyEdenNotificationsStorageKey) ??
        localStorage.getItem(legacyNotificationsStorageKey);
      return saved ? normalizeNotifications(JSON.parse(saved)) : defaultNotifications;
    } catch {
      return defaultNotifications;
    }
  });

  const updateAppearance = useCallback(
    (settings: Partial<AppearanceSettings>) => {
      setAppearance((current) => {
        const updated = normalizeAppearance({ ...current, ...settings });
        localStorage.setItem(appearanceStorageKey, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const updateNotifications = useCallback(
    (settings: Partial<NotificationSettings>) => {
      setNotifications((current) => {
        const updated = normalizeNotifications({ ...current, ...settings });
        localStorage.setItem(notificationsStorageKey, JSON.stringify(updated));
        void ghostboxApi.setNotificationSettings(updated).catch(() => undefined);
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
    document.documentElement.classList.toggle("no-animations", appearance.reduceAllAnimations);
  }, [appearance.reduceAllAnimations]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-backdrop-blur", appearance.disableBackdropBlur);
  }, [appearance.disableBackdropBlur]);

  useEffect(() => {
    setImagePreloadConcurrency(appearance.imagePreloadConcurrency);
  }, [appearance.imagePreloadConcurrency]);

  useEffect(() => {
    setPreferLowResCovers(appearance.preferLowResCovers);
  }, [appearance.preferLowResCovers]);

  useEffect(() => {
    void ghostboxApi.setNotificationSettings(notifications).catch(() => undefined);
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
