import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Folder,
  Gamepad2,
  Heart,
  Settings,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { useSettings } from "../context/settings";
import { ghostboxApi } from "../lib/ghostboxApi";
import {
  appNotificationsChangedEvent,
  clearAppNotifications,
  markAppNotificationsSeen,
  readAppNotifications,
  type AppNotificationItem,
  type AppNotificationSeverity,
  type AppNotificationType,
} from "../lib/appNotifications";

type NotificationFilter = "all" | "important" | "games" | "favorite" | "collection";

const notificationFilters: Array<{
  id: NotificationFilter;
  icon: LucideIcon;
}> = [
  { id: "all", icon: Bell },
  { id: "important", icon: AlertTriangle },
  { id: "games", icon: Gamepad2 },
  { id: "favorite", icon: Heart },
  { id: "collection", icon: Folder },
];

const notificationTypeIcons: Record<AppNotificationType, LucideIcon> = {
  system: Settings,
  library: Gamepad2,
  backup: Gamepad2,
  achievement: Gamepad2,
  account: UserRound,
  download: Gamepad2,
  favorite: Heart,
  collection: Folder,
};

const severityIcons: Record<AppNotificationSeverity, LucideIcon> = {
  info: Bell,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

function formatRelativeTime(timestamp: number, language: "pt" | "en") {
  const elapsedMs = Date.now() - timestamp;
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));

  if (elapsedMinutes < 1) return language === "en" ? "now" : "agora";
  if (elapsedMinutes < 60) {
    return language === "en" ? `${elapsedMinutes}m ago` : `há ${elapsedMinutes}min`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return language === "en" ? `${elapsedHours}h ago` : `há ${elapsedHours}h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return language === "en" ? `${elapsedDays}d ago` : `há ${elapsedDays}d`;
}

function filterLabel(filter: NotificationFilter, language: "pt" | "en") {
  const labels: Record<NotificationFilter, { pt: string; en: string }> = {
    all: { pt: "Tudo", en: "All" },
    important: { pt: "Importantes", en: "Important" },
    games: { pt: "Jogos", en: "Games" },
    favorite: { pt: "Favoritos", en: "Favorites" },
    collection: { pt: "Coleções", en: "Collections" },
  };

  return labels[filter][language];
}

function severityLabel(severity: AppNotificationSeverity, language: "pt" | "en") {
  const labels: Record<AppNotificationSeverity, { pt: string; en: string }> = {
    info: { pt: "Info", en: "Info" },
    success: { pt: "Sucesso", en: "Success" },
    warning: { pt: "Atenção", en: "Warning" },
    error: { pt: "Erro", en: "Error" },
  };

  return labels[severity][language];
}

function NotificationRow({
  item,
  language,
}: {
  item: AppNotificationItem;
  language: "pt" | "en";
}) {
  const TypeIcon = notificationTypeIcons[item.type];
  const SeverityIcon = severityIcons[item.severity];

  return (
    <article className={`app-notification app-notification--${item.severity}`}>
      <span className="app-notification__icon" aria-hidden="true">
        <TypeIcon size={18} aria-hidden />
      </span>
      <div className="app-notification__content">
        <div className="app-notification__header">
          <strong>{item.title}</strong>
          <span>{formatRelativeTime(item.createdAt, language)}</span>
        </div>
        <p>{item.message}</p>
        {item.action?.url ? (
          <button
            type="button"
            className="app-notification__action"
            onClick={() => void ghostboxApi.openExternalUrl(item.action?.url ?? "")}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <span
        className={`app-notification__status app-notification__status--${item.severity}`}
        role="img"
        aria-label={severityLabel(item.severity, language)}
        title={severityLabel(item.severity, language)}
      >
        <SeverityIcon size={14} aria-hidden />
      </span>
    </article>
  );
}

export function NotificationsPage() {
  const { appearance, t } = useSettings();
  const [items, setItems] = useState<AppNotificationItem[]>(() => readAppNotifications());
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>("all");

  const refreshItems = useCallback(() => {
    setItems(readAppNotifications());
  }, []);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    if (activeFilter === "important") {
      return items.filter((item) => item.severity === "warning" || item.severity === "error");
    }
    if (activeFilter === "games") {
      return items.filter((item) =>
        item.type === "library" ||
        item.type === "backup" ||
        item.type === "achievement" ||
        item.type === "download"
      );
    }
    return items.filter((item) => item.type === activeFilter);
  }, [activeFilter, items]);

  useEffect(() => {
    markAppNotificationsSeen();
    refreshItems();
  }, [refreshItems]);

  useEffect(() => {
    window.addEventListener(appNotificationsChangedEvent, refreshItems);
    return () => window.removeEventListener(appNotificationsChangedEvent, refreshItems);
  }, [refreshItems]);

  return (
    <section className="notifications-page notifications-hub content-section content-section--full">
      <header className="notifications-hub__header">
        <div>
          <h2>{t("notifications.title")}</h2>
          <p>{t("notifications.description")}</p>
        </div>
        <button
          type="button"
          className="notifications-hub__clear"
          onClick={() => {
            clearAppNotifications();
            setItems([]);
          }}
          disabled={items.length === 0}
        >
          {t("notifications.clear")}
        </button>
      </header>

      <div className="notifications-hub__filters" aria-label={t("notifications.filters")}>
        {notificationFilters.map(({ id, icon: FilterIcon }) => (
          <button
            type="button"
            key={id}
            className={activeFilter === id ? "is-active" : undefined}
            aria-pressed={activeFilter === id}
            onClick={() => setActiveFilter(id)}
          >
            <FilterIcon size={15} strokeWidth={2} aria-hidden />
            <span>{filterLabel(id, appearance.language)}</span>
          </button>
        ))}
      </div>

      {filteredItems.length > 0 ? (
        <div className="notifications-hub__list">
          {filteredItems.map((item) => (
            <NotificationRow key={item.id} item={item} language={appearance.language} />
          ))}
        </div>
      ) : (
        <EmptyState
          className="notifications-page__empty"
          title={t("notifications.emptyTitle")}
          description={t("notifications.emptyMessage")}
        />
      )}

    </section>
  );
}
