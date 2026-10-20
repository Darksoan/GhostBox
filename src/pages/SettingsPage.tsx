import {
  Check,
  Bell,
  Crown,
  Download,
  FolderCog,
  Gauge,
  Link2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useSettings, type AppearanceSettings } from "../context/settings";
import { normalizeToastDuration, toastDurationOptions } from "../utils/toastDuration";
import { SubscriptionBackdrop } from "../components/subscription/SubscriptionBackdrop";
import { SubscriptionPlans } from "../components/subscription/SubscriptionPlans";
import {
  ConnectionsPanel,
  HiddenProfileGamesSection,
  SteamVisibilitySection,
} from "../features/settings/ConnectionsPanel";
import { SettingsDropdown } from "../components/ui/SettingsDropdown";
import { TempFilesSection } from "../features/settings/TempFilesSection";
import { DownloadSettingsSection } from "../features/settings/DownloadSettingsSection";
import type { GhostBoxGame } from "../data";
import type { BackupSettings, StartupPage, StartupSettings, SteamProfile } from "../types";
import {
  type SettingsTabId,
  settingsTabLabelKeys,
  settingsTabDescriptionKeys,
} from "../features/settings/settingsTabsShared";

export type { SettingsTabId } from "../features/settings/settingsTabsShared";
export { settingsTabLabelKeys } from "../features/settings/settingsTabsShared";

const SETTINGS_DRAFTS_STORAGE_KEY = "ghostbox:settings-drafts:v1";
const LEGACY_EDEN_SETTINGS_DRAFTS_STORAGE_KEY = "eden:settings-drafts:v1";
const LEGACY_SETTINGS_DRAFTS_STORAGE_KEY = "piratebox:settings-drafts:v1";

type SettingOption = {
  label: string;
  labelAction?: ReactNode;
  description: string;
  control: "toggle" | "select" | "button" | "input" | "text" | "range";
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
  rangeValues?: number[];
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

type CloudBackupGame = {
  appId: string;
  title: string;
  achievementCount: number;
  lastBackupAt: string | null;
  lastBackupSuccess: boolean | null;
  lastBackupError?: string | null;
};

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
    id: "connections",
    icon: Link2,
    options: [],
  },
  {
    id: "downloads",
    icon: Download,
    options: [],
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
];

interface SettingsPageProps {
  activeTabId: SettingsTabId;
  libraryView: "overview" | "hidden-games";
  onLibraryViewChange: (view: "overview" | "hidden-games") => void;
  searchQuery: string;
  onClearSearchQuery: () => void;
  games: GhostBoxGame[];
  steamProfile: SteamProfile | null;
  initialPage: StartupPage;
  onInitialPageChange: Dispatch<SetStateAction<StartupPage>>;
  steamPath: string;
  onSelectSteamPath: () => void;
  startupSettings: StartupSettings;
  onStartupSettingsChange: (settings: Partial<StartupSettings>) => void;
  backupSettings: BackupSettings | null;
}

export function SettingsPage({
  activeTabId,
  libraryView,
  onLibraryViewChange,
  searchQuery,
  onClearSearchQuery,
  games,
  steamProfile,
  initialPage,
  onInitialPageChange,
  steamPath,
  onSelectSteamPath,
  startupSettings,
  onStartupSettingsChange,
  backupSettings,
}: SettingsPageProps) {
  const { appearance, notifications, updateAppearance, updateNotifications, t } = useSettings();
  const activeTab = settingsTabs.find((tab) => tab.id === activeTabId) ?? settingsTabs[0];
  const [drafts, setDrafts] = useState<DraftsState>(() =>
    mergeDrafts(getDefaultDrafts(appearance.language, initialPage, startupSettings), readDrafts())
  );

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
      }, appearance, notifications, updateAppearance, updateNotifications, t, steamPath, onSelectSteamPath),
    [
      activeTab,
      appearance,
      backupSettings,
      drafts,
      notifications,
      onSelectSteamPath,
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
        achievementCount: game.achievements.unlocked,
        lastBackupAt: backupRecords[game.appId]?.lastBackupAt ?? null,
        lastBackupSuccess: typeof backupRecords[game.appId]?.lastBackupSuccess === "boolean" ? backupRecords[game.appId].lastBackupSuccess : null,
        lastBackupError: backupRecords[game.appId]?.lastBackupError ?? null,
      }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [backupSettings, games]);
  const showingHiddenGames = activeTab.id === "library" && libraryView === "hidden-games";

  return (
    <section
      className={`settings-page settings-page--tabs${
        activeTab.id === "subscription" ? " subscription-surface" : ""
      }`}
      aria-label={t("nav.settings")}
    >
      {/* O backdrop é o mesmo do diálogo "Seja premium": a visibilidade nas
          duas superfícies é controlada por CSS (escondido com o resumo da
          conta ou o skeleton de carregamento), então o fundo aqui é
          incondicional. */}
      {activeTab.id === "subscription" && <SubscriptionBackdrop />}
      <article
        className={`settings-panel${
          activeTab.id === "subscription" ? " settings-panel--bare" : ""
        }`}
      >
        <div className="settings-panel__body">
          {activeTab.id !== "subscription" && !showingHiddenGames && (
            <div className="settings-page__header">
              <div>
                <h3>{t(settingsTabLabelKeys[activeTab.id])}</h3>
                <p>{t(settingsTabDescriptionKeys[activeTab.id])}</p>
              </div>
            </div>
          )}
          {options.length > 0 && !showingHiddenGames && (
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
          {activeTab.id === "library" && libraryView === "overview" && (
            <>
              <SteamVisibilitySection onOpenHiddenGames={() => onLibraryViewChange("hidden-games")} />
            </>
          )}
          {activeTab.id === "library" && libraryView === "hidden-games" && (
            <HiddenProfileGamesSection searchQuery={searchQuery} onClearSearchQuery={onClearSearchQuery} />
          )}
          {activeTab.id === "performance" && <TempFilesSection />}
          {activeTab.id === "downloads" && <>
            <div className="settings-options">
              <SettingRow option={{
                label: t("downloads.openSteamOnGameLaunch"),
                description: t("downloads.openSteamOnGameLaunchDescription"),
                control: "toggle",
                checked: startupSettings.openSteamOnGameLaunch !== false,
                onToggle: (next) => onStartupSettingsChange({ openSteamOnGameLaunch: next }),
              }} />
            </div>
            <DownloadSettingsSection steamPath={steamPath} />
          </>}
          {activeTab.id === "connections" && <ConnectionsPanel />}
          {activeTab.id === "subscription" && (
            <SubscriptionPlans
              surface="settings"
              enterDelay="0.04s"
              cloudBackupGames={cloudBackupGames}
              steamProfile={steamProfile}
            />
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
      {
        label: t("settings.general.consoleMode.label"),
        description: t("settings.general.consoleMode.description"),
        control: "toggle" as const,
        checked: appearance.consoleMode,
        onToggle: (next: boolean) => updateAppearance({ consoleMode: next }),
      },
    ];
  }

  if (activeTab.id === "performance") {
    return [
      {
        label: t("settings.performance.reduceAllAnimations.label"),
        description: t("settings.performance.reduceAllAnimations.description"),
        control: "toggle" as const,
        checked: !appearance.reduceAllAnimations,
        onToggle: (next: boolean) => updateAppearance({ reduceAllAnimations: !next }),
      },
      {
        label: t("settings.performance.disableBackdropBlur.label"),
        description: t("settings.performance.disableBackdropBlur.description"),
        control: "toggle" as const,
        checked: !appearance.disableBackdropBlur,
        onToggle: (next: boolean) => updateAppearance({ disableBackdropBlur: !next }),
      },
      {
        label: t("settings.performance.trailerQuality.label"),
        description: t("settings.performance.trailerQuality.description"),
        control: "toggle" as const,
        checked: appearance.trailerQuality !== "low",
        onToggle: (next: boolean) => updateAppearance({ trailerQuality: next ? "high" : "low" }),
      },
      {
        label: t("settings.performance.trailerAutoplay.label"),
        description: t("settings.performance.trailerAutoplay.description"),
        control: "toggle" as const,
        checked: appearance.trailerQuality !== "low" && appearance.trailerAutoplay,
        disabled: appearance.trailerQuality === "low",
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
        checked: !appearance.disablePageKeepAlive,
        onToggle: (next: boolean) => updateAppearance({ disablePageKeepAlive: !next }),
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
        label: t("settings.notifications.toastDuration.label"),
        description: t("settings.notifications.toastDuration.description"),
        control: "select" as const,
        value: String(notifications.toastDurationSeconds),
        choices: toastDurationOptions.map((seconds) => ({
          label: t("settings.notifications.toastDuration.seconds", { seconds }),
          value: String(seconds),
        })),
        onChange: (value: string) => updateNotifications({ toastDurationSeconds: normalizeToastDuration(Number(value)) }),
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

  if (activeTab.id === "library") {
    return [
      ...activeTab.options.map((option) => ({
        label: t(option.labelKey),
        description: t(option.descriptionKey),
        control: option.control,
        value: steamPath,
        onClick: onSelectSteamPath,
      })),
    ];
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

function SettingRow({ option, enterDelay }: { option: SettingOption; enterDelay?: string }) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const isControlledToggle = typeof option.checked === "boolean";
  const [enabled, setEnabled] = useState(Boolean(option.enabled));
  const toggleValue = isControlledToggle ? Boolean(option.checked) : enabled;
  const rangeValues = option.rangeValues ?? [];
  const rangeIndex = Math.max(0, rangeValues.indexOf(Number(option.value)));

  return (
    <div
      className={`settings-option ${option.disabled ? "settings-option--disabled" : ""}`}
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
    >
      <div className="settings-option__copy">
        <div className="settings-option__label" id={labelId}>
          <strong>{option.label}</strong>
          {option.labelAction}
        </div>
        <span id={descriptionId}>{option.description}</span>
      </div>
      <div className="settings-option__control">
        {option.control === "toggle" && (
          <button
            type="button"
            className={`settings-switch ${toggleValue ? "settings-switch--on" : ""}`}
            role="switch"
            aria-checked={toggleValue}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
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

        {option.control === "range" && (
          <div
            className="settings-range"
            style={{
              ["--settings-range-progress" as string]: `${
                (rangeIndex / Math.max(1, rangeValues.length - 1)) * 100
              }%`,
            }}
          >
            <input
              id={id}
              className="settings-range__input"
              type="range"
              min={0}
              max={rangeValues.length - 1}
              step={1}
              value={rangeIndex}
              list={`${id}-steps`}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              aria-valuetext={`${option.value}%`}
              disabled={option.disabled}
              onChange={(event) => option.onChange?.(String(rangeValues[Number(event.target.value)]))}
            />
            <datalist id={`${id}-steps`}>
              {rangeValues.map((value, index) => (
                <option key={value} value={index} label={`${value}%`} />
              ))}
            </datalist>
            <output className="settings-range__value" htmlFor={id}>{option.value}%</output>
          </div>
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
