import {
  ChevronDown,
  CloudUpload,
  Folder,
  Gamepad2,
  Heart,
  Settings,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { useSettings } from "../context/settings";
import { useOverlay } from "../context/OverlayContext";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import { highDensityHeaderSources } from "../utils/image";
import { ghostboxApi } from "../lib/ghostboxApi";
import { requestNavigateToSettingsTab } from "../lib/appNavigation";
import {
  appNotificationsChangedEvent,
  clearAppNotifications,
  markAppNotificationsSeen,
  readAppNotifications,
  restoreAppNotifications,
  type AppNotificationItem,
  type AppNotificationSeverity,
  type AppNotificationType,
} from "../lib/appNotifications";

/** A partir de quantas notificações do mesmo jogo a lista vira um grupo. Dois
 * itens ainda leem melhor soltos; três é onde a repetição começa a empurrar o
 * resto do feed para fora da tela. */
const notificationGroupThreshold = 3;

const notificationTypeIcons: Record<AppNotificationType, LucideIcon> = {
  system: Settings,
  library: Gamepad2,
  backup: CloudUpload,
  achievement: Trophy,
  account: UserRound,
  favorite: Heart,
  collection: Folder,
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

function severityLabel(severity: AppNotificationSeverity, language: "pt" | "en") {
  const labels: Record<AppNotificationSeverity, { pt: string; en: string }> = {
    info: { pt: "Info", en: "Info" },
    success: { pt: "Sucesso", en: "Success" },
    warning: { pt: "Atenção", en: "Warning" },
    error: { pt: "Erro", en: "Error" },
  };

  return labels[severity][language];
}

function groupSummaryLabel(count: number, gameTitle: string, language: "pt" | "en") {
  if (language === "en") {
    return `Show ${count} more notification${count === 1 ? "" : "s"} about ${gameTitle}`;
  }

  return `Mostrar mais ${count} notificaç${count === 1 ? "ão" : "ões"} de ${gameTitle}`;
}

/** Chave de agrupamento: app id quando existe, senão o nome do jogo. Item sem
 * jogo nunca agrupa — não há o que somar. */
function notificationGroupKey(item: AppNotificationItem) {
  const appId = item.game?.appId?.trim();
  if (appId) return `app:${appId}`;
  const title = item.game?.title?.trim();
  return title ? `title:${title.toLowerCase()}` : "";
}

type NotificationFeedEntry =
  | { kind: "single"; key: string; item: AppNotificationItem }
  | { kind: "group"; key: string; items: AppNotificationItem[] };

/**
 * Colapsa em um grupo tudo que vem do mesmo jogo a partir de
 * `notificationGroupThreshold` itens. O grupo ocupa a posição do item mais
 * recente daquele jogo, então a ordem cronológica da lista continua valendo —
 * o que sai da linha do tempo são as repetições, que é justamente o ruído.
 */
export function buildNotificationFeed(
  items: AppNotificationItem[]
): NotificationFeedEntry[] {
  const byGame = new Map<string, AppNotificationItem[]>();

  for (const item of items) {
    const key = notificationGroupKey(item);
    if (!key) continue;
    const bucket = byGame.get(key);
    if (bucket) bucket.push(item);
    else byGame.set(key, [item]);
  }

  const consumed = new Set<string>();

  return items.flatMap<NotificationFeedEntry>((item) => {
    const key = notificationGroupKey(item);
    const bucket = key ? byGame.get(key) ?? [] : [];

    if (bucket.length < notificationGroupThreshold) {
      return [{ kind: "single", key: item.id, item }];
    }
    if (consumed.has(key)) return [];

    consumed.add(key);
    return [{ kind: "group", key, items: bucket }];
  });
}

/** Arte da faixa esquerda: `header capsule` (460x215) exclusivamente.
 * `coverUrl` já é o header da Steam (460x215); `header_2x` entra em alta
 * densidade e `header.jpg` pelo app id como fallback. `headerUrl`
 * (`library_hero`, 1920x620) não é usado — aspecto errado para 172x80.
 * Sem app id nem URL, cai no bloco de ícone (`app-notification__media--icon`). */
function notificationArtSources(game: AppNotificationItem["game"]) {
  if (!game) return [];

  const appId = game.appId?.trim() ?? "";
  const header2xSources = highDensityHeaderSources(appId).filter(
    (src) => !src.includes("library_hero")
  );
  return [
    game.coverUrl ?? "",
    ...header2xSources,
    ...(appId
      ? [
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
          `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        ]
      : []),
  ].filter(Boolean);
}

function NotificationRow({
  item,
  language,
  groupCount = 0,
  groupExpanded = false,
  groupPanelId,
  onToggleGroup,
  isGroupChild = false,
  childIndex = 0,
}: {
  item: AppNotificationItem;
  language: "pt" | "en";
  /** > 0 transforma a linha na cabeça de um grupo (soma o item mostrado). */
  groupCount?: number;
  groupExpanded?: boolean;
  groupPanelId?: string;
  onToggleGroup?: () => void;
  isGroupChild?: boolean;
  /** Posição na abertura do grupo; alimenta o atraso do stagger. */
  childIndex?: number;
}) {
  const TypeIcon = notificationTypeIcons[item.type];
  const { showToast } = useOverlay();
  // Linha filha não repete a capa: todo mundo no grupo é o mesmo jogo, e a
  // cabeça já mostrou a arte. Cinco vezes a mesma capa empilhada é ruído.
  const artSources = useMemo(
    () => (isGroupChild ? [] : notificationArtSources(item.game)),
    [isGroupChild, item.game]
  );
  const cachedSources = useCachedImageSources(artSources);
  const { source: artSource, loaded } = useLoadableImageCover(cachedSources);
  // Não monte a arte na URL provisória: a animação de entrada começaria de
  // novo quando o hook resolvesse um fallback e a capa piscaria.
  const hasArt = loaded && Boolean(artSource);
  // A conquista mostra o ícone do tipo sobre a arte borrada do jogo: o feed não
  // guarda o ícone da conquista em si, e a arte nítida atrás de um selo fica
  // ilegível nos 172x80 da faixa.
  const isBadgeMedia = item.type === "achievement" || item.type === "backup";

  return (
    <article
      className={`app-notification app-notification--${item.severity}${
        groupCount > 0 ? " app-notification--group-head" : ""
      }${isGroupChild ? " app-notification--group-child" : ""}`}
      style={
        isGroupChild
          ? ({ "--row-index": childIndex } as CSSProperties)
          : undefined
      }
    >
      {isGroupChild ? null : (
      <span
        className={`app-notification__media${
          hasArt ? "" : " app-notification__media--icon"
        }${isBadgeMedia && hasArt ? " app-notification__media--badge" : ""}`}
        aria-hidden="true"
      >
        {hasArt ? (
          <span
            className={`app-notification__art${
              loaded ? " app-notification__art--loaded" : ""
            }`}
            style={{ backgroundImage: `url("${artSource}")` }}
          />
        ) : null}
        {!hasArt || isBadgeMedia ? (
          <span className="app-notification__badge">
            <TypeIcon size={hasArt ? 26 : 20} aria-hidden />
          </span>
        ) : null}
      </span>
      )}
      <div className="app-notification__content">
        <p className="app-notification__title">
          {/* Só o título: o nome do jogo já vem na mensagem logo abaixo, e
              repetir os dois na mesma linha come a largura do bloco. */}
          <strong>{item.title}</strong>
          {/* A severidade saiu do visual (o mock não tem selo), mas continua
              anunciada: sem isso um erro e um aviso ficam indistinguíveis para
              leitor de tela. */}
          <span className="sr-only">
            {severityLabel(item.severity, language)}
          </span>
        </p>
        <p className="app-notification__message">{item.message}</p>
      </div>
      <div className="app-notification__aside">
        <span className="app-notification__time">
          {formatRelativeTime(item.createdAt, language)}
        </span>
        {item.action ? (
          <button
            type="button"
            className="app-notification__action"
            onClick={() => {
              // Ação navegável: alvos internos (`target`) vão pelo barramento
              // leve de eventos (lib/appNavigation.ts) que o App resolve
              // abrindo a Settings na aba pedida; URLs externas continuam
              // abrindo no navegador padrão.
              if (item.action?.target === "subscription") {
                requestNavigateToSettingsTab("subscription");
                return;
              }
              if (item.action?.url) {
                // A URL vem do payload da notificação, então pode não passar
                // pela allowlist do Rust — avisar é melhor que o clique não
                // fazer nada.
                void ghostboxApi.openExternalUrl(item.action.url).catch(() => {
                  showToast(
                    language === "en" ? "Link blocked" : "Link bloqueado",
                    language === "en"
                      ? "This link points outside the addresses GhostBox is allowed to open."
                      : "Este link aponta para fora dos endereços que o GhostBox pode abrir.",
                    "error"
                  );
                });
              }
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      {groupCount > 0 && onToggleGroup ? (
        <button
          type="button"
          className="app-notification__toggle"
          aria-expanded={groupExpanded}
          aria-controls={groupPanelId}
          onClick={onToggleGroup}
        >
          <span className="app-notification__count">+{groupCount}</span>
          <ChevronDown
            className="app-notification__chevron"
            size={16}
            aria-hidden
          />
          <span className="sr-only">
            {groupSummaryLabel(groupCount, item.game?.title ?? "", language)}
          </span>
        </button>
      ) : null}
    </article>
  );
}

export function NotificationsPage() {
  const { appearance, t } = useSettings();
  const [items, setItems] = useState<AppNotificationItem[]>(() => readAppNotifications());
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [clearedItems, setClearedItems] = useState<AppNotificationItem[] | null>(null);

  const refreshItems = useCallback(() => {
    setItems(readAppNotifications());
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    );
  }, []);

  const feedEntries = useMemo(() => buildNotificationFeed(items), [items]);

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
            setClearedItems(items);
            clearAppNotifications();
            setItems([]);
          }}
          disabled={items.length === 0}
        >
          {t("notifications.clear")}
        </button>
      </header>

      {clearedItems ? (
        <div className="notifications-hub__undo" role="status">
          <span>{t("notifications.cleared")}</span>
          <button
            type="button"
            onClick={() => {
              restoreAppNotifications(clearedItems);
              setClearedItems(null);
            }}
          >
            {t("notifications.undo")}
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="notifications-hub__list">
          {feedEntries.map((entry) => {
            if (entry.kind === "single") {
              return (
                <NotificationRow
                  key={entry.key}
                  item={entry.item}
                  language={appearance.language}
                />
              );
            }

            const [head, ...rest] = entry.items;
            const expanded = expandedGroups.includes(entry.key);
            const panelId = `notification-group-${entry.key.replace(/[^a-z0-9]+/gi, "-")}`;

            return (
              <div
                className={`app-notification-group${
                  expanded ? " app-notification-group--open" : ""
                }`}
                key={entry.key}
              >
                <NotificationRow
                  item={head}
                  language={appearance.language}
                  groupCount={rest.length}
                  groupExpanded={expanded}
                  groupPanelId={panelId}
                  onToggleGroup={() => toggleGroup(entry.key)}
                />
                {/* O painel fica montado aberto ou fechado: a transição de
                    `grid-template-rows` precisa dos dois estados no DOM.
                    Fechado ele vai a `visibility: hidden` pelo CSS, que já tira
                    as linhas do foco — `hidden`/`display: none` cortaria a
                    animação no primeiro frame. */}
                <div
                  className="app-notification-group__panel"
                  id={panelId}
                  aria-hidden={!expanded}
                >
                  <div className="app-notification-group__panel-inner">
                    {rest.map((item, index) => (
                      <NotificationRow
                        key={item.id}
                        item={item}
                        language={appearance.language}
                        isGroupChild
                        childIndex={index}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
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
