import {
  ChevronLeft,
  Check,
  Bell,
  Crown,
  ExternalLink,
  FolderCog,
  Code2,
  Gauge,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useSettings, type AppearanceSettings } from "../context/settings";
import { SubscriptionPlans } from "../components/subscription/SubscriptionPlans";
import type { GhostBoxGame } from "../data";
import type { BackupSettings, StartupPage, StartupSettings, SteamProfile } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { ghostboxApi } from "../lib/ghostboxApi";

export type { SettingsTabId } from "../features/settings/settingsTabsShared";
export { settingsTabLabelKeys } from "../features/settings/settingsTabsShared";

const SETTINGS_DRAFTS_STORAGE_KEY = "ghostbox:settings-drafts:v1";
const LEGACY_EDEN_SETTINGS_DRAFTS_STORAGE_KEY = "eden:settings-drafts:v1";
const LEGACY_SETTINGS_DRAFTS_STORAGE_KEY = "piratebox:settings-drafts:v1";
const MORRENUS_DISCORD_URL = "https://discord.gg/hubcapsmanifest";

type SettingOption = {
  label: string;
  labelAction?: ReactNode;
  description: string;
  control: "toggle" | "select" | "button" | "input" | "text";
  value?: string;
  choices?: Array<{ label: string; value: string }>;
  onChange?: (value: string) => void;
  checked?: boolean;
  onToggle?: (next: boolean) => void;
  onClick?: () => void;
  disabled?: boolean;
  enabled?: boolean;
  placeholder?: string;
  confirmAriaLabel?: string;
};

type SettingChoiceDefinition = {
  labelKey?: string;
  label?: string;
  value: string;
};

type SettingOptionDefinition = {
  labelKey: string;
  descriptionKey: string;
  control: SettingOption["control"];
  valueKey?: string;
  value?: string;
  choices?: SettingChoiceDefinition[];
  enabled?: boolean;
};

type DraftValue = string | boolean;
type DraftsState = Partial<Record<SettingsTabId, Record<string, DraftValue>>>;

const downloadApiSources = [
  { name: "Ryuu", typeKey: "settings.download.sources.auto", url: "https://discord.com/invite/manifests" },
  { name: "TwentyTwo Cloud", typeKey: "settings.download.sources.auto", url: "https://discord.com/invite/twentytwocloud" },
  { name: "Sushi", typeKey: "settings.download.sources.auto", url: "https://discord.com/invite/J5JMUBYyZK" },
];

type MorrenusStatsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; stats: Record<string, unknown> };

type CloudBackupGame = {
  appId: string;
  title: string;
  lastBackupAt: string | null;
  lastBackupSuccess: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function statsText(stats: Record<string, unknown>, key: string) {
  const value = stats[key];
  if (value === null || typeof value === "undefined" || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

function statsNumber(stats: Record<string, unknown>, key: string) {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMorrenusDate(value: unknown) {
  if (typeof value !== "string" || !value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function readDrafts(): DraftsState {
  if (typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SETTINGS_DRAFTS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_EDEN_SETTINGS_DRAFTS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_SETTINGS_DRAFTS_STORAGE_KEY) ??
        "{}"
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const drafts = parsed as Record<string, unknown>;
    return Object.entries(drafts).reduce<DraftsState>((acc, [tabId, values]) => {
      if (!values || typeof values !== "object" || Array.isArray(values)) return acc;

      acc[tabId as SettingsTabId] = Object.entries(values as Record<string, unknown>).reduce<Record<string, DraftValue>>(
        (tabAcc, [key, value]) => {
          if (typeof value === "string" || typeof value === "boolean") {
            tabAcc[key] = value;
          }
          return tabAcc;
        },
        {}
      );
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function writeDrafts(drafts: DraftsState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SETTINGS_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Drafts are local-only if storage is unavailable.
  }
}

function getDefaultDrafts(
  appearanceLanguage: "pt" | "en",
  initialPage: StartupPage,
  startupSettings: StartupSettings
): DraftsState {
  return {
    general: {
      language: appearanceLanguage,
      initialPage,
      openAtLogin: startupSettings.openAtLogin,
      startMinimized: startupSettings.startMinimized,
      minimizeToTray: startupSettings.minimizeToTray,
    },
    library: {
      ["settings.library.steamPath.label"]: "C:\\Program Files (x86)\\Steam",
    },
  };
}

function mergeDrafts(defaults: DraftsState, stored: DraftsState): DraftsState {
  const next: DraftsState = { ...defaults };

  (Object.keys(defaults) as SettingsTabId[]).forEach((tabId) => {
    next[tabId] = {
      ...(defaults[tabId] ?? {}),
      ...(stored[tabId] ?? {}),
    };
  });

  return next;
}

export type SettingsTab = {
  id: SettingsTabId;
  icon: LucideIcon;
  options: SettingOptionDefinition[];
};

export const settingsTabs: SettingsTab[] = [
  {
    id: "general",
    icon: SlidersHorizontal,
    options: [],
  },
  {
    id: "performance",
    icon: Gauge,
    options: [],
  },
  {
    id: "library",
    icon: FolderCog,
    options: [
      {
        labelKey: "settings.library.steamPath.label",
        descriptionKey: "settings.library.steamPath.description",
        control: "input",
        value: "C:\\Program Files (x86)\\Steam",
      },
    ],
  },
  {
    id: "subscription",
    icon: Crown,
    options: [],
  },
  {
    id: "notifications",
    icon: Bell,
    options: [],
  },
  {
    id: "download",
    icon: Code2,
    options: [],
  },
];

interface SettingsPageProps {
  activeTabId: SettingsTabId;
  games: GhostBoxGame[];
  steamProfile: SteamProfile | null;
  initialPage: StartupPage;
  onInitialPageChange: Dispatch<SetStateAction<StartupPage>>;
  steamPath: string;
  onSelectSteamPath: () => void;
  startupSettings: StartupSettings;
  onStartupSettingsChange: (settings: Partial<StartupSettings>) => void;
  morrenusApiKey: string;
  onMorrenusApiKeyChange: (value: string) => void;
  onMorrenusApiKeySave: () => void;
  backupSettings: BackupSettings | null;
}

export function SettingsPage({
  activeTabId,
  games,
  steamProfile,
  initialPage,
  onInitialPageChange,
  steamPath,
  onSelectSteamPath,
  startupSettings,
  onStartupSettingsChange,
  morrenusApiKey,
  onMorrenusApiKeyChange,
  onMorrenusApiKeySave,
  backupSettings,
}: SettingsPageProps) {
  const { appearance, notifications, updateAppearance, updateNotifications, t } = useSettings();
  const activeTab = settingsTabs.find((tab) => tab.id === activeTabId) ?? settingsTabs[0];
  const [drafts, setDrafts] = useState<DraftsState>(() =>
    mergeDrafts(getDefaultDrafts(appearance.language, initialPage, startupSettings), readDrafts())
  );
  const [morrenusStats, setMorrenusStats] = useState<MorrenusStatsState>({ status: "idle" });

  useEffect(() => {
    const defaults = getDefaultDrafts(appearance.language, initialPage, startupSettings);
    setDrafts((current) => mergeDrafts(defaults, current));
  }, [appearance.language, initialPage, startupSettings]);

  useEffect(() => {
    writeDrafts(drafts);
  }, [drafts]);

  useEffect(() => {
    const general = drafts.general ?? {};
    const nextLanguage = general.language === "en" ? "en" : "pt";
    const nextInitialPage =
      general.initialPage === "profile" || general.initialPage === "catalogue" ? general.initialPage : "home";
    const nextStartupSettings = {
      openAtLogin: Boolean(general.openAtLogin),
      startMinimized: Boolean(general.openAtLogin) && Boolean(general.startMinimized),
      minimizeToTray: Boolean(general.minimizeToTray),
    };

    if (appearance.language !== nextLanguage) {
      updateAppearance({ language: nextLanguage });
    }

    if (initialPage !== nextInitialPage) {
      onInitialPageChange(nextInitialPage);
    }

    if (
      startupSettings.openAtLogin !== nextStartupSettings.openAtLogin ||
      startupSettings.startMinimized !== nextStartupSettings.startMinimized ||
      startupSettings.minimizeToTray !== nextStartupSettings.minimizeToTray
    ) {
      onStartupSettingsChange(nextStartupSettings);
    }
  }, [
    appearance.language,
    drafts.general,
    initialPage,
    onInitialPageChange,
    onStartupSettingsChange,
    startupSettings.openAtLogin,
    startupSettings.startMinimized,
    startupSettings.minimizeToTray,
    updateAppearance,
  ]);

  const refreshMorrenusStats = useCallback(async (apiKey = morrenusApiKey) => {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      setMorrenusStats({ status: "idle" });
      return;
    }

    setMorrenusStats({ status: "loading" });
    try {
      const result = await ghostboxApi.getMorrenusStats(normalizedApiKey);
      if (!result?.success) {
        setMorrenusStats({ status: "error", message: result?.error || t("settings.download.accountStatus.defaultError") });
        return;
      }

      setMorrenusStats({ status: "success", stats: asRecord(result.stats) });
    } catch (error) {
      setMorrenusStats({
        status: "error",
        message: error instanceof Error ? error.message : t("settings.download.accountStatus.defaultError"),
      });
    }
  }, [morrenusApiKey, t]);

  useEffect(() => {
    const normalizedApiKey = morrenusApiKey.trim();
    if (!normalizedApiKey) {
      setMorrenusStats({ status: "idle" });
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshMorrenusStats(normalizedApiKey);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [morrenusApiKey, refreshMorrenusStats]);

  const options = useMemo(
    () =>
      buildTabOptions(activeTab, drafts[activeTab.id] ?? {}, (tabId, key, value) => {
        setDrafts((current) => ({
          ...current,
          [tabId]: {
            ...(current[tabId] ?? {}),
            [key]: value,
          },
        }));
      }, appearance, notifications, updateAppearance, updateNotifications, t, steamPath, onSelectSteamPath, morrenusApiKey, onMorrenusApiKeyChange, () => {
        onMorrenusApiKeySave();
        void refreshMorrenusStats();
      }),
    [
      activeTab,
      appearance,
      backupSettings,
      drafts,
      morrenusApiKey,
      notifications,
      onMorrenusApiKeyChange,
      onMorrenusApiKeySave,
      onSelectSteamPath,
      refreshMorrenusStats,
      steamPath,
      t,
      updateAppearance,
      updateNotifications,
    ]
  );

  const cloudBackupGames = useMemo<CloudBackupGame[]>(() => {
    const backupRecords = backupSettings?.backupRecords ?? {};
    return games
      .map((game) => ({
        appId: game.appId,
        title: game.title,
        lastBackupAt: backupRecords[game.appId]?.lastBackupAt ?? null,
        lastBackupSuccess: typeof backupRecords[game.appId]?.lastBackupSuccess === "boolean" ? backupRecords[game.appId].lastBackupSuccess : null,
      }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [backupSettings, games]);

  return (
    <section className="settings-page settings-page--tabs" aria-label={t("nav.settings")}>
      <article className={`settings-panel${activeTab.id === "subscription" ? " settings-panel--bare" : ""}`}>
        <div key={activeTab.id} className="settings-panel__body">
          {options.length > 0 && (
            <div className="settings-options">
              {options.map((option, index) => (
                <SettingRow
                  key={`${activeTab.id}-${option.label}`}
                  option={option}
                  enterDelay={`${0.04 + index * 0.035}s`}
                />
              ))}
            </div>
          )}
          {activeTab.id === "subscription" && (
            <SubscriptionPlans
              surface="settings"
              enterDelay="0.04s"
              cloudBackupGames={cloudBackupGames}
              steamProfile={steamProfile}
            />
          )}
          {activeTab.id === "download" && (
            <>
              <MorrenusAccountStatus
                statsState={morrenusStats}
                onRefresh={() => void refreshMorrenusStats()}
                t={t}
                enterDelay={`${0.04 + options.length * 0.035}s`}
              />
              <div
                className="download-api-divider settings-panel__animated-block"
                aria-hidden="true"
                style={{ ["--settings-enter-delay" as string]: `${0.08 + options.length * 0.035}s` }}
              />
              <DownloadApiSourcesInfo
                t={t}
                enterDelay={`${0.12 + options.length * 0.035}s`}
              />
            </>
          )}
        </div>
      </article>
    </section>
  );
}

function buildTabOptions(
  activeTab: SettingsTab,
  currentValues: Record<string, DraftValue>,
  onChangeValue: (tabId: SettingsTabId, key: string, value: DraftValue) => void,
  appearance: AppearanceSettings,
  notifications: ReturnType<typeof useSettings>["notifications"],
  updateAppearance: ReturnType<typeof useSettings>["updateAppearance"],
  updateNotifications: ReturnType<typeof useSettings>["updateNotifications"],
  t: (key: string, params?: Record<string, string | number>) => string,
  steamPath: string,
  onSelectSteamPath: () => void,
  morrenusApiKey: string,
  onMorrenusApiKeyChange: (value: string) => void,
  onMorrenusApiKeyCheck: () => void
) {
  if (activeTab.id === "general") {
    return [
      {
        label: t("settings.general.language.label"),
        description: t("settings.general.language.description"),
        control: "select" as const,
        value: (currentValues.language as string) ?? appearance.language,
        choices: [
          { label: t("settings.general.language.portuguese"), value: "pt" },
          { label: t("settings.general.language.english"), value: "en" },
        ],
        onChange: (value: string) => onChangeValue("general", "language", value),
      },
      {
        label: t("settings.general.initialPage.label"),
        description: t("settings.general.initialPage.description"),
        control: "select" as const,
        value: (currentValues.initialPage as string) ?? "home",
        choices: [
          { label: t("settings.general.initialPage.home"), value: "home" },
          { label: t("settings.general.initialPage.profile"), value: "profile" },
          { label: t("settings.general.initialPage.catalogue"), value: "catalogue" },
        ],
        onChange: (value: string) => onChangeValue("general", "initialPage", value),
      },
      {
        label: t("settings.general.openAtLogin.label"),
        description: t("settings.general.openAtLogin.description"),
        control: "toggle" as const,
        checked: Boolean(currentValues.openAtLogin),
        onToggle: (next: boolean) => {
          onChangeValue("general", "openAtLogin", next);
          if (!next) onChangeValue("general", "startMinimized", false);
        },
      },
      {
        label: t("settings.general.startMinimized.label"),
        description: t("settings.general.startMinimized.description"),
        control: "toggle" as const,
        checked: Boolean(currentValues.startMinimized),
        disabled: !Boolean(currentValues.openAtLogin),
        onToggle: (next: boolean) => onChangeValue("general", "startMinimized", next),
      },
      {
        label: t("settings.general.minimizeToTray.label"),
        description: t("settings.general.minimizeToTray.description"),
        control: "toggle" as const,
        checked: Boolean(currentValues.minimizeToTray),
        onToggle: (next: boolean) => onChangeValue("general", "minimizeToTray", next),
      },
    ];
  }

  if (activeTab.id === "performance") {
    return [
      {
        label: t("settings.performance.disableTabAnimations.label"),
        description: t("settings.performance.disableTabAnimations.description"),
        control: "toggle" as const,
        checked: appearance.disableTabAnimations || appearance.reduceAllAnimations,
        disabled: appearance.reduceAllAnimations,
        onToggle: (next: boolean) => updateAppearance({ disableTabAnimations: next }),
      },
      {
        label: t("settings.performance.reduceAllAnimations.label"),
        description: t("settings.performance.reduceAllAnimations.description"),
        control: "toggle" as const,
        checked: appearance.reduceAllAnimations,
        onToggle: (next: boolean) => updateAppearance({ reduceAllAnimations: next }),
      },
      {
        label: t("settings.performance.disableBackdropBlur.label"),
        description: t("settings.performance.disableBackdropBlur.description"),
        control: "toggle" as const,
        checked: appearance.disableBackdropBlur,
        onToggle: (next: boolean) => updateAppearance({ disableBackdropBlur: next }),
      },
      {
        label: t("settings.performance.disableExplorePan.label"),
        description: t("settings.performance.disableExplorePan.description"),
        control: "toggle" as const,
        checked: appearance.disableExplorePan,
        onToggle: (next: boolean) => updateAppearance({ disableExplorePan: next }),
      },
      {
        label: t("settings.performance.trailerQuality.label"),
        description: t("settings.performance.trailerQuality.description"),
        control: "select" as const,
        value: appearance.trailerQuality,
        choices: [
          { label: t("settings.performance.trailerQuality.high"), value: "high" },
          { label: t("settings.performance.trailerQuality.low"), value: "low" },
        ],
        onChange: (value: string) => updateAppearance({ trailerQuality: value === "low" ? "low" : "high" }),
      },
      {
        label: t("settings.performance.trailerAutoplay.label"),
        description: t("settings.performance.trailerAutoplay.description"),
        control: "toggle" as const,
        checked: appearance.trailerAutoplay,
        onToggle: (next: boolean) => updateAppearance({ trailerAutoplay: next }),
      },
      {
        label: t("settings.performance.imagePreloadConcurrency.label"),
        description: t("settings.performance.imagePreloadConcurrency.description"),
        control: "select" as const,
        value: String(appearance.imagePreloadConcurrency),
        choices: [
          { label: t("settings.performance.imagePreloadConcurrency.low"), value: "2" },
          { label: t("settings.performance.imagePreloadConcurrency.medium"), value: "4" },
          { label: t("settings.performance.imagePreloadConcurrency.high"), value: "6" },
        ],
        onChange: (value: string) => updateAppearance({ imagePreloadConcurrency: value === "2" ? 2 : value === "6" ? 6 : 4 }),
      },
      {
        label: t("settings.performance.disablePageKeepAlive.label"),
        description: t("settings.performance.disablePageKeepAlive.description"),
        control: "toggle" as const,
        checked: appearance.disablePageKeepAlive,
        onToggle: (next: boolean) => updateAppearance({ disablePageKeepAlive: next }),
      },
    ];
  }

  if (activeTab.id === "notifications") {
    return [
      {
        label: t("settings.notifications.inAppToasts.label"),
        description: t("settings.notifications.inAppToasts.description"),
        control: "toggle" as const,
        checked: notifications.inAppToastsEnabled,
        onToggle: (next: boolean) => updateNotifications({ inAppToastsEnabled: next }),
      },
      {
        label: t("settings.notifications.inAppSuccessToasts.label"),
        description: t("settings.notifications.inAppSuccessToasts.description"),
        control: "toggle" as const,
        checked: notifications.inAppSuccessToastsEnabled,
        disabled: !notifications.inAppToastsEnabled,
        onToggle: (next: boolean) => updateNotifications({ inAppSuccessToastsEnabled: next }),
      },
      {
        label: t("settings.notifications.inAppErrorToasts.label"),
        description: t("settings.notifications.inAppErrorToasts.description"),
        control: "toggle" as const,
        checked: notifications.inAppErrorToastsEnabled,
        disabled: !notifications.inAppToastsEnabled,
        onToggle: (next: boolean) => updateNotifications({ inAppErrorToastsEnabled: next }),
      },
    ];
  }

  if (activeTab.id === "download") {
    return [
      {
        label: t("settings.download.morrenusApiKey.label"),
        labelAction: (
          <button
            type="button"
            className="settings-option__label-link"
            aria-label={t("settings.download.morrenusApiKey.openLink")}
            onClick={() => {
              void ghostboxApi.openExternal(MORRENUS_DISCORD_URL);
            }}
          >
            <ExternalLink size={13} aria-hidden="true" />
          </button>
        ),
        description: t("settings.download.morrenusApiKey.description"),
        control: "text" as const,
        value: morrenusApiKey,
        placeholder: t("settings.download.morrenusApiKey.placeholder"),
        confirmAriaLabel: t("settings.download.morrenusApiKey.saveKey"),
        onClick: onMorrenusApiKeyCheck,
        onChange: (value: string) => onMorrenusApiKeyChange(value),
      },
    ];
  }

  if (activeTab.id === "library") {
    return activeTab.options.map((option) => {
      const label = t(option.labelKey);
      const description = t(option.descriptionKey);

      return {
        label,
        description,
        control: option.control,
        value: steamPath,
        onClick: onSelectSteamPath,
      };
    });
  }

  return activeTab.options.map((option) => {
    const currentValue = currentValues[option.labelKey];
    const label = t(option.labelKey);
    const description = t(option.descriptionKey);

    if (option.control === "toggle") {
      return {
        label,
        description,
        control: option.control,
        checked: typeof currentValue === "boolean"
          ? currentValue
          : Boolean(option.enabled),
        onToggle: (next: boolean) => onChangeValue(activeTab.id, option.labelKey, next),
      };
    }

    if (option.control === "select") {
      const selectedChoice = option.choices?.find((choice) => choice.value === currentValue);

      return {
        label,
        description,
        control: option.control,
        value: selectedChoice?.label ?? (option.valueKey ? t(option.valueKey) : option.value),
        choices: option.choices?.map((choice) => ({
          label: choice.labelKey ? t(choice.labelKey) : (choice.label ?? choice.value),
          value: choice.value,
        })),
        onChange: (value: string) => onChangeValue(activeTab.id, option.labelKey, value),
      };
    }

    if (option.control === "input") {
      const isSteamPath = activeTab.id === "library" && option.labelKey === "settings.library.steamPath.label";

      return {
        label,
        description,
        control: option.control,
        value: isSteamPath ? steamPath : typeof currentValue === "string" ? currentValue : option.value,
        onClick: isSteamPath ? onSelectSteamPath : undefined,
      };
    }

    return {
      label,
      description,
      control: option.control,
      value: option.valueKey ? t(option.valueKey) : option.value,
    };
  });
}

function DownloadApiSourcesInfo({
  t,
  enterDelay,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  enterDelay?: string;
}) {
  return (
    <div
      className="download-api-info settings-panel__animated-block"
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
    >
      <div className="download-api-info__header">
        <strong>{t("settings.download.sources.title")}</strong>
      </div>

      <div className="download-api-info__grid">
        {downloadApiSources.map((source) => (
          <div key={source.name} className="download-api-info__source">
            <div className="download-api-info__source-name">
              <strong>{source.name}</strong>
              <button
                type="button"
                className="settings-option__label-link"
                aria-label={t("settings.download.sources.openDiscord", { source: source.name })}
                onClick={() => {
                  void ghostboxApi.openExternal(source.url);
                }}
              >
                <ExternalLink size={13} aria-hidden="true" />
              </button>
            </div>
            <small>{t(source.typeKey)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingRow({ option, enterDelay }: { option: SettingOption; enterDelay?: string }) {
  const isControlledToggle = typeof option.checked === "boolean";
  const [enabled, setEnabled] = useState(Boolean(option.enabled));
  const toggleValue = isControlledToggle ? Boolean(option.checked) : enabled;

  return (
    <div
      className={`settings-option ${option.disabled ? "settings-option--disabled" : ""}`}
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
    >
      <div className="settings-option__copy">
        <div className="settings-option__label">
          <strong>{option.label}</strong>
          {option.labelAction}
        </div>
        <span>{option.description}</span>
      </div>
      <div className="settings-option__control">
        {option.control === "toggle" && (
          <button
            type="button"
            className={`settings-switch ${toggleValue ? "settings-switch--on" : ""}`}
            aria-pressed={toggleValue}
            disabled={option.disabled}
            onClick={() => {
              if (option.disabled) return;
              if (isControlledToggle && option.onToggle) {
                option.onToggle(!toggleValue);
                return;
              }
              setEnabled((current) => !current);
            }}
          >
            <span />
          </button>
        )}

        {option.control === "select" && (
          option.choices && option.onChange ? (
            <SettingsDropdown option={option as SettingOption & { choices: Array<{ label: string; value: string }>; onChange: (value: string) => void; }} />
          ) : (
            <button type="button" className="settings-select" disabled>
              <span>{option.value}</span>
            </button>
          )
        )}

        {option.control === "input" && (
          <input
            className={`settings-input ${option.onClick ? "settings-input--clickable" : ""}`}
            value={option.value}
            readOnly
            onClick={option.onClick}
            onKeyDown={(event) => {
              if (!option.onClick || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              option.onClick();
            }}
          />
        )}

        {option.control === "text" && (
          <div className="settings-input-group">
            <input
              className="settings-input settings-input--grouped"
              type="text"
              value={option.value ?? ""}
              placeholder={option.placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => option.onChange?.(event.target.value)}
            />
            <button
              type="button"
              className="settings-input-group__confirm"
              aria-label={option.confirmAriaLabel ?? "Salvar chave"}
              onClick={option.onClick}
            >
              <Check size={14} strokeWidth={2.0} />
            </button>
          </div>
        )}

        {option.control === "button" && (
          <button
            type="button"
            className="settings-action"
            disabled={option.disabled}
            onClick={option.onClick}
          >
            <span>{option.value}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function MorrenusAccountStatus({
  statsState,
  onRefresh,
  t,
  enterDelay,
}: {
  statsState: MorrenusStatsState;
  onRefresh: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  enterDelay?: string;
}) {
  if (statsState.status === "idle") {
    return (
      <div
        className="morrenus-status morrenus-status--idle settings-panel__animated-block"
        style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
      >
        <span>{t("settings.download.accountStatus.missingKey")}</span>
      </div>
    );
  }

  if (statsState.status === "loading") {
    return (
      <div
        className="morrenus-status morrenus-status--loading settings-panel__animated-block"
        style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
        aria-hidden="true"
      >
        <div className="morrenus-status__header">
          <div>
            <strong className="morrenus-status__line morrenus-status__line--title loading-wave" />
            <span className="morrenus-status__line morrenus-status__line--meta loading-wave" />
          </div>
        </div>
        <div className="morrenus-status__grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={`morrenus-loading-${index}`}>
              <span className="morrenus-status__line morrenus-status__line--label loading-wave" />
              <strong className="morrenus-status__line morrenus-status__line--value loading-wave" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (statsState.status === "error") {
    return (
      <div
        className="morrenus-status morrenus-status--error settings-panel__animated-block"
        style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
      >
        <div>
          <strong>{t("settings.download.accountStatus.errorTitle")}</strong>
          <span>{statsState.message}</span>
        </div>
        <button type="button" onClick={onRefresh}>{t("settings.download.accountStatus.retry")}</button>
      </div>
    );
  }

  const stats = statsState.stats;
  const dailyUsage = statsNumber(stats, "daily_usage");
  const dailyLimit = statsNumber(stats, "daily_limit");
  const roleLimit = statsNumber(stats, "role_daily_limit");
  const customLimit = statsNumber(stats, "custom_api_limit");
  const usageLabel = dailyUsage !== null && dailyLimit !== null ? `${dailyUsage}/${dailyLimit}` : statsText(stats, "daily_usage");

  return (
    <div
      className="morrenus-status morrenus-status--success settings-panel__animated-block"
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
    >
      <div className="morrenus-status__header">
        <div>
          <strong>{statsText(stats, "username")}</strong>
          <span>ID: {statsText(stats, "user_id")}</span>
        </div>
      </div>

      <div className="morrenus-status__grid">
        <div>
          <span>{t("settings.download.accountStatus.dailyUsage")}</span>
          <strong>{usageLabel}</strong>
        </div>
        <div>
          <span>{t("settings.download.accountStatus.planLimit")}</span>
          <strong>{roleLimit ?? "-"}</strong>
        </div>
        <div>
          <span>{t("settings.download.accountStatus.customLimit")}</span>
          <strong>{customLimit ?? "-"}</strong>
        </div>
        <div>
          <span>{t("settings.download.accountStatus.expiresAt")}</span>
          <strong>{formatMorrenusDate(stats.api_key_expires_at)}</strong>
        </div>
      </div>
    </div>
  );
}

function SettingsDropdown({
  option,
}: {
  option: SettingOption & {
    choices: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const activeChoice = option.choices.find((choice) => choice.value === option.value) ?? option.choices[0];

  const handleSelect = (value: string) => {
    option.onChange(value);
    setOpen(false);
  };

  return (
    <div className={`settings-dropdown ${open ? "settings-dropdown--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="settings-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{activeChoice.label}</span>
        <ChevronLeft size={14} />
      </button>

      {open && (
        <div className="settings-dropdown__menu" role="listbox" aria-label={option.label}>
          {option.choices
            .filter((choice) => choice.value !== option.value)
            .map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`settings-dropdown__option ${choice.value === option.value ? "settings-dropdown__option--active" : ""}`}
              onClick={() => handleSelect(choice.value)}
            >
              <span>{choice.label}</span>
            </button>
            ))}
        </div>
      )}
    </div>
  );
}
