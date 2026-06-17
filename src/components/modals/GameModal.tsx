import {
  BarChart3,
  ChevronDown,
  Check,
  Cpu,
  Download,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Play,
  Settings,
  Tags as TagsIcon,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  GhostBoxGame,
  GameRequirements,
  SteamAchievement,
} from "../../data";
import type { UserCollection } from "../../types";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import {
  loadGameAchievementDetailsCached,
  loadGameReviewsCached,
  loadGameStoreDetailsCached,
} from "../../utils/gameCache";
import type {
  SteamGameReview,
  SteamGameReviewsResult,
} from "../../lib/ghostboxApi.types";
import {
  imageSourceCache,
  preloadImageSources,
  uniqueSources,
} from "../../utils/imageCache";
import {
  gameHeroSources,
  gameLogoSources,
  gameStyle,
  getPriorityScreenshotSources,
  withoutHeroImageSources,
} from "../../utils/image";
import { formatCompactPlaytime } from "../../utils/time";
import { useSettings } from "../../context/settings";
import { GallerySlider } from "../ui/GallerySlider";

function GameRequirementsSection({
  requirements,
}: {
  requirements?: GameRequirements;
}) {
  const { appearance } = useSettings();
  const requirementsId = useId();
  const minimum = requirements?.minimum ?? [];
  const recommended = requirements?.recommended ?? [];
  const [activeRequirement, setActiveRequirement] = useState<
    "minimum" | "recommended"
  >(minimum.length ? "minimum" : "recommended");

  if (!minimum.length && !recommended.length) return null;

  const activeItems = activeRequirement === "minimum" ? minimum : recommended;
  return (
    <section
      className="modal__requirements-section"
      aria-label={
        appearance.language === "en"
          ? "System requirements"
          : "Requisitos do sistema"
      }
    >
      <div className="modal__requirements-header">
        <Cpu size={16} aria-hidden="true" />
        <strong>
          {appearance.language === "en" ? "Requirements" : "Requisitos"}
        </strong>
      </div>
      <div className="modal__requirements-panel">
        <div
          className="modal__requirements-tabs"
          role="tablist"
          aria-label={
            appearance.language === "en"
              ? "Requirement options"
              : "Opções de requisitos"
          }
        >
          <button
            type="button"
            className={`modal__requirements-tab ${activeRequirement === "minimum" ? "modal__requirements-tab--active" : ""}`}
            onClick={() => setActiveRequirement("minimum")}
            role="tab"
            id={`${requirementsId}-minimum-tab`}
            aria-selected={activeRequirement === "minimum"}
            aria-controls={`${requirementsId}-panel`}
          >
            {appearance.language === "en" ? "Minimum" : "Mínimos"}
          </button>
          <button
            type="button"
            className={`modal__requirements-tab ${activeRequirement === "recommended" ? "modal__requirements-tab--active" : ""}`}
            onClick={() => setActiveRequirement("recommended")}
            role="tab"
            id={`${requirementsId}-recommended-tab`}
            aria-selected={activeRequirement === "recommended"}
            aria-controls={`${requirementsId}-panel`}
          >
            {appearance.language === "en" ? "Recommended" : "Recomendados"}
          </button>
        </div>

        <div
          className="modal__requirements-content"
          role="tabpanel"
          id={`${requirementsId}-panel`}
          aria-labelledby={`${requirementsId}-${activeRequirement}-tab`}
        >
          {activeItems.length ? (
            <ul>
              {activeItems.map((item) => (
                <RequirementItem item={item} key={item} />
              ))}
            </ul>
          ) : (
            <p>
              {appearance.language === "en"
                ? "Not provided by Steam."
                : "Não informado pela Steam."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function RequirementItem({ item }: { item: string }) {
  const separatorIndex = item.indexOf(":");
  if (separatorIndex <= 0) return <li>{item}</li>;

  return (
    <li>
      <strong>{item.slice(0, separatorIndex + 1)}</strong>{" "}
      {item.slice(separatorIndex + 1).trim()}
    </li>
  );
}

function steamReviewAvatarUrl(hash: string) {
  if (!hash) return "";
  if (/^https?:\/\//i.test(hash)) return hash;
  return `https://avatars.akamai.steamstatic.com/${hash}_medium.jpg`;
}

function steamReviewLanguage(language: "pt" | "en") {
  return language === "en" ? "english" : "brazilian";
}

type SteamReviewFilter = "all" | "positive" | "negative";

const steamReviewFilters: SteamReviewFilter[] = ["all", "positive", "negative"];
const reviewsPerPage = 6;

function steamReviewFilterLabel(filter: SteamReviewFilter, language: "pt" | "en") {
  if (filter === "positive") return language === "en" ? "Positive" : "Positivas";
  if (filter === "negative") return language === "en" ? "Negative" : "Negativas";
  return language === "en" ? "Recent" : "Recentes";
}

function getRecommendedPercent(summary?: SteamGameReviewsResult["query_summary"]) {
  const positive = summary?.total_positive ?? 0;
  const negative = summary?.total_negative ?? 0;
  const total = positive + negative;
  if (total <= 0) return null;
  return Math.round((positive / total) * 100);
}

function getReviewSummaryTotal(summary?: SteamGameReviewsResult["query_summary"]) {
  const positive = summary?.total_positive ?? 0;
  const negative = summary?.total_negative ?? 0;
  return summary?.total_reviews ?? positive + negative;
}

function formatReviewNumber(value: number, language: "pt" | "en") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR").format(
    value
  );
}

function formatReviewCountLabel(value: number, language: "pt" | "en") {
  if (value <= 0) return language === "en" ? "No reviews" : "Sem análises";
  return `${formatReviewNumber(value, language)} ${
    language === "en" ? "reviews" : "análises"
  }`;
}

function getReviewSentimentLabel(
  percent: number,
  reviewCount: number,
  language: "pt" | "en"
) {
  if (reviewCount < 10) return language === "en" ? "Few reviews" : "Poucas análises";
  if (percent >= 95) {
    return language === "en" ? "Overwhelmingly positive" : "Extremamente positivas";
  }
  if (percent >= 85) return language === "en" ? "Very positive" : "Muito positivas";
  if (percent >= 70) return language === "en" ? "Positive" : "Positivas";
  if (percent >= 40) return language === "en" ? "Mixed" : "Mistas";
  if (percent >= 20) return language === "en" ? "Negative" : "Negativas";
  return language === "en" ? "Very negative" : "Muito negativas";
}

function getReviewScoreFillColor(percent: number) {
  if (percent >= 95) return "var(--success)";
  if (percent >= 80) return "rgba(53, 208, 127, 0.72)";
  if (percent >= 60) return "rgba(211, 211, 211, 0.62)";
  return "rgba(255, 255, 255, 0.24)";
}

function ReviewRecommendationSidebar({
  summary,
  isLoading,
  fallbackPositiveRatio,
  fallbackReviewCount,
  language,
}: {
  summary?: SteamGameReviewsResult["query_summary"];
  isLoading: boolean;
  fallbackPositiveRatio?: number;
  fallbackReviewCount?: number;
  language: "pt" | "en";
}) {
  const fallbackPercent =
    typeof fallbackPositiveRatio === "number" && Number.isFinite(fallbackPositiveRatio)
      ? Math.round(fallbackPositiveRatio * 100)
      : null;
  const overallPercent = getRecommendedPercent(summary) ?? fallbackPercent;
  const totalReviews =
    getReviewSummaryTotal(summary) ||
    (typeof fallbackReviewCount === "number" && Number.isFinite(fallbackReviewCount)
      ? fallbackReviewCount
      : 0);
  const meterFill = getReviewScoreFillColor(overallPercent ?? 0);

  if (!isLoading && overallPercent === null) return null;

  return (
    <section
      className="modal__review-summary-section"
      aria-label={
        language === "en" ? "Review recommendation" : "Recomendação das análises"
      }
    >
      <div className="modal__review-summary-heading">
        <BarChart3 size={16} aria-hidden="true" />
        <strong>{language === "en" ? "Recommendation" : "Recomendação"}</strong>
      </div>

      {isLoading && overallPercent === null ? (
        <div className="modal__review-summary-loading">
          {language === "en" ? "Loading reviews" : "Carregando análises"}
        </div>
      ) : (
        <>
          <div className="modal__review-summary-card">
            <div className="modal__review-summary-score">
              <strong>{overallPercent}%</strong>
              <span>{language === "en" ? "recommend" : "recomendam"}</span>
            </div>
            <span className="modal__review-summary-sentiment">
              {getReviewSentimentLabel(overallPercent ?? 0, totalReviews, language)}
            </span>
            <span className="modal__review-summary-count">
              {formatReviewCountLabel(totalReviews, language)}
            </span>
            <div className="modal__review-summary-meter" aria-hidden="true">
              <span
                style={{
                  width: `${overallPercent ?? 0}%`,
                  backgroundColor: meterFill,
                }}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function getReviewPaginationItems(totalPages: number, activePage: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (activePage <= 4) return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  if (activePage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis",
    activePage - 1,
    activePage,
    activePage + 1,
    "ellipsis",
    totalPages,
  ] as const;
}

function formatReviewDate(timestamp: number, language: "pt" | "en") {
  if (!timestamp) return "";

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp * 1000));
}

function normalizeSteamReviewText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function SteamReviewCard({
  review,
  language,
}: {
  review: SteamGameReview;
  language: "pt" | "en";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const avatarUrl = steamReviewAvatarUrl(review.author.avatar);
  const authorName = review.author.personaname || "Steam user";
  const playtimeAtReview = review.author.playtime_at_review ?? 0;
  const reviewDate = formatReviewDate(review.timestamp_created, language);
  const reviewText = normalizeSteamReviewText(review.review);
  const isLongReview = reviewText.length > 280;

  return (
    <article className="modal__review-card">
      <div className="modal__review-author">
        {avatarUrl ? (
          <img
            className="modal__review-avatar"
            src={avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="modal__review-avatar modal__review-avatar--empty" />
        )}
        <div className="modal__review-author-copy">
          <strong>{authorName}</strong>
          <span>
            {formatCompactPlaytime(playtimeAtReview * 60_000)}{" "}
            {language === "en" ? "at review" : "no review"}
            {reviewDate ? ` · ${reviewDate}` : ""}
          </span>
        </div>
      </div>

      <p
        className={`modal__review-text ${isExpanded ? "modal__review-text--expanded" : ""}`}
      >
        {reviewText}
      </p>

      {isLongReview && (
        <button
          type="button"
          className="modal__review-toggle"
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded
            ? language === "en"
              ? "Show less"
              : "Ver menos"
            : language === "en"
              ? "Show more"
              : "Ver mais"}
        </button>
      )}
    </article>
  );
}

function normalizeSteamHtml(value: string) {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function safeMediaSource(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value, "https://store.steampowered.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function getSanitizedSteamAboutHtml(value?: string) {
  if (!value || typeof window === "undefined") return "";

  const document = new DOMParser().parseFromString(
    normalizeSteamHtml(value),
    "text/html"
  );
  const blockedElements = document.querySelectorAll(
    "script, style, iframe, object, embed, link, meta"
  );
  blockedElements.forEach((element) => element.remove());

  document.body.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "style") {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "href") {
        const href = safeMediaSource(attributeValue);
        if (href) element.setAttribute(attribute.name, href);
        else element.removeAttribute(attribute.name);
        return;
      }

      if (name === "src" || name === "poster") {
        const source = safeMediaSource(attributeValue);
        if (source) element.setAttribute(attribute.name, source);
        else element.removeAttribute(attribute.name);
      }
    });
  });

  document.body.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
    image.removeAttribute("width");
    image.removeAttribute("height");
  });

  document.body.querySelectorAll("video").forEach((video) => {
    video.removeAttribute("controls");
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.removeAttribute("width");
    video.removeAttribute("height");
  });

  return document.body.innerHTML;
}

function BackupOptionsModal({
  open,
  gameId,
  gameTitle,
  automaticBackupEnabled,
  backupAvailable,
  backupOutputPath,
  customExecutablePath,
  userCollections,
  onClose,
  onToggleAutomaticBackup,
  onSelectBackupOutputPath,
  onSelectGameExecutable,
  onRemoveGameExecutable,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: {
  open: boolean;
  gameId: string;
  gameTitle: string;
  automaticBackupEnabled: boolean;
  backupAvailable: boolean;
  backupOutputPath: string;
  customExecutablePath: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onToggleAutomaticBackup: (enabled: boolean) => void | Promise<void>;
  onSelectBackupOutputPath: () => void;
  onSelectGameExecutable: () => void | Promise<void>;
  onRemoveGameExecutable: () => void | Promise<void>;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
}) {
  const { appearance } = useSettings();
  const modalRef = useRef<HTMLFormElement>(null);
  const [draftAutomaticBackupEnabled, setDraftAutomaticBackupEnabled] =
    useState(automaticBackupEnabled);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set()
  );

  const currentCollectionIds = useMemo(
    () =>
      new Set(
        userCollections
          .filter((collection) => collection.gameIds.includes(gameId))
          .map((collection) => collection.id)
      ),
    [gameId, userCollections]
  );

  useEffect(() => {
    if (!open) return;
    setDraftAutomaticBackupEnabled(automaticBackupEnabled);
    setIsCollectionPickerOpen(false);
    setDraftCollectionIds(currentCollectionIds);
  }, [automaticBackupEnabled, currentCollectionIds, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="backdrop backdrop--profile"
      onClick={onClose}
    >
      <form
        className="collection-modal edit-profile-modal modal__backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-backup-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => event.preventDefault()}
        ref={modalRef}
      >
            <header className="collection-modal__header">
              <div>
                <h3 id="game-backup-modal-title">
                  {appearance.language === "en"
                    ? `Options for ${gameTitle}`
                    : `Opções para ${gameTitle}`}
                </h3>
              </div>

              <button
                type="button"
                className="collection-modal__close"
                onClick={onClose}
                aria-label={appearance.language === "en" ? "Close" : "Fechar"}
              >
                <X size={20} strokeWidth={1.7} />
              </button>
            </header>

            <div className="collection-modal__content modal__backup-modal-content">
              <section className="modal__backup-section">
                <h4>
                  {appearance.language === "en"
                    ? "Organization"
                    : "Organização"}
                </h4>
                <div className="modal__backup-option modal__backup-option--static modal__backup-option--dropdown">
                  <div className="modal__backup-option-copy">
                    <strong>
                      {appearance.language === "en"
                        ? "Add to collection"
                        : "Adicionar à coleção"}
                    </strong>
                    <span>
                      {userCollections.length
                        ? appearance.language === "en"
                          ? "Choose one of your collections for this game."
                          : "Escolha uma das suas coleções para este jogo."
                        : appearance.language === "en"
                          ? "Create a collection first."
                          : "Crie uma coleção primeiro."}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => {
                      setDraftCollectionIds(currentCollectionIds);
                      setIsCollectionPickerOpen(true);
                    }}
                    disabled={!userCollections.length}
                  >
                    {appearance.language === "en"
                      ? "Choose collection"
                      : "Escolher coleção"}
                  </button>
                </div>
              </section>

              <section className="modal__backup-section">
                <h4>
                  {appearance.language === "en" ? "Launch" : "Inicialização"}
                </h4>
                <div className="modal__backup-option modal__backup-option--static">
                  <div className="modal__backup-option-copy">
                    <strong>
                      {appearance.language === "en"
                        ? "Custom executable"
                        : "Executável personalizado"}
                    </strong>
                    <span>
                      {customExecutablePath ||
                        (appearance.language === "en"
                          ? "Choose a non-Steam game .exe for the Play button."
                          : "Escolha um .exe de jogo não Steam para o botão Jogar.")}
                    </span>
                  </div>

                  <div className="modal__backup-option-actions">
                    <button
                      type="button"
                      className="button button--outline modal__backup-action-button"
                      onClick={onSelectGameExecutable}
                    >
                      {appearance.language === "en" ? "Choose" : "Escolher"}
                    </button>
                    {customExecutablePath && (
                      <button
                        type="button"
                        className="button button--outline modal__backup-action-button modal__backup-action-button--danger"
                        onClick={onRemoveGameExecutable}
                      >
                        {appearance.language === "en" ? "Remove" : "Remover"}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="modal__backup-section">
                <h4>
                  {appearance.language === "en"
                    ? "Save protection"
                    : "Proteção de saves"}
                </h4>
                <button
                  type="button"
                  className={`modal__backup-option ${!backupAvailable ? "modal__backup-option--disabled" : ""}`}
                  onClick={() => {
                    if (!backupAvailable) return;
                    setDraftAutomaticBackupEnabled((current) => !current);
                  }}
                  aria-pressed={
                    backupAvailable ? draftAutomaticBackupEnabled : undefined
                  }
                  disabled={!backupAvailable}
                >
                  <div className="modal__backup-option-copy">
                    <strong>
                      {appearance.language === "en"
                        ? "Automatic local backup"
                        : "Backup local automático"}
                    </strong>
                    <span>
                      {!backupAvailable
                        ? appearance.language === "en"
                          ? "Available after adding this game to your library or selecting a custom executable."
                          : "Disponível após adicionar este jogo à sua biblioteca ou selecionar um executável personalizado."
                        : appearance.language === "en"
                          ? "Create a local backup automatically when this game closes."
                          : "Cria um backup local automaticamente quando este jogo for fechado."}
                    </span>
                  </div>

                  <span
                    className={`settings-switch ${draftAutomaticBackupEnabled ? "settings-switch--on" : ""}`}
                    aria-hidden="true"
                  >
                    <span />
                  </span>
                </button>

                <div className="modal__backup-option modal__backup-option--static">
                  <div className="modal__backup-option-copy">
                    <strong>
                      {appearance.language === "en"
                        ? "Backup location"
                        : "Local dos backups"}
                    </strong>
                    <span>
                      {backupOutputPath ||
                        (appearance.language === "en"
                          ? "Choose where local backups will be saved."
                          : "Escolha onde os backups locais serão salvos.")}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={onSelectBackupOutputPath}
                  >
                    {appearance.language === "en" ? "Choose" : "Escolher"}
                  </button>
                </div>
              </section>

              <div className="collection-modal__actions modal__backup-modal-actions">
                <button
                  type="button"
                  className="button button--save"
                  onClick={() => {
                    if (
                      backupAvailable &&
                      draftAutomaticBackupEnabled !== automaticBackupEnabled
                    ) {
                      onToggleAutomaticBackup(draftAutomaticBackupEnabled);
                    }
                    onClose();
                  }}
                >
                  {appearance.language === "en" ? "Save" : "Salvar"}
                </button>
              </div>
            </div>

            {isCollectionPickerOpen && (
              <div
                className="modal__collection-picker-backdrop"
                onClick={() => setIsCollectionPickerOpen(false)}
              >
                <div
                  className="modal__collection-picker"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="game-collection-picker-title"
                  onClick={(event) => event.stopPropagation()}
                >
                    <header className="modal__collection-picker-header">
                      <div>
                        <h4 id="game-collection-picker-title">
                          {appearance.language === "en"
                            ? "Choose collections"
                            : "Escolher coleções"}
                        </h4>
                        <span>{gameTitle}</span>
                      </div>
                    </header>

                    <div className="modal__collection-picker-list">
                      {userCollections.map((collection) => {
                        const checked = draftCollectionIds.has(collection.id);
                        return (
                          <label
                            key={collection.id}
                            className="catalogue-filter-option modal__collection-picker-option"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDraftCollectionIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(collection.id))
                                    next.delete(collection.id);
                                  else next.add(collection.id);
                                  return next;
                                });
                              }}
                            />
                            <span className="catalogue-filter-option__box">
                              {checked && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span>{collection.name}</span>
                          </label>
                        );
                      })}
                    </div>

                    <footer className="modal__collection-picker-actions">
                      <button
                        type="button"
                        className="button button--outline"
                        onClick={() => setIsCollectionPickerOpen(false)}
                      >
                        {appearance.language === "en" ? "Cancel" : "Cancelar"}
                      </button>
                      <button
                        type="button"
                        className="button button--save"
                        onClick={async () => {
                          const addedIds = [...draftCollectionIds].filter(
                            (collectionId) =>
                              !currentCollectionIds.has(collectionId)
                          );
                          const removedIds = [...currentCollectionIds].filter(
                            (collectionId) =>
                              !draftCollectionIds.has(collectionId)
                          );

                          for (const collectionId of removedIds) {
                            await onRemoveGameFromCollection(collectionId);
                          }

                          for (const collectionId of addedIds) {
                            await onAddGameToCollection(collectionId);
                          }

                          setIsCollectionPickerOpen(false);
                        }}
                      >
                        {appearance.language === "en" ? "Save" : "Salvar"}
                      </button>
                    </footer>
                </div>
              </div>
            )}
      </form>
    </div>,
    document.body
  );
}

function formatAchievementPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  })}%`;
}

function AchievementIcon({
  achievement,
  onSelect,
}: {
  achievement: SteamAchievement;
  onSelect?: () => void;
}) {
  const { appearance } = useSettings();
  const itemRef = useRef<HTMLLIElement>(null);
  const isUnlocked = achievement.unlocked === true;
  const preferredSource = isUnlocked
    ? achievement.icon || achievement.iconGray
    : achievement.iconGray || achievement.icon;
  const [source, setSource] = useState(preferredSource);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const globalPercent = formatAchievementPercent(achievement.globalPercent);
  const globalPercentLabel =
    appearance.language === "en" ? "of players" : "dos jogadores";
  const fallbackPercentLabel =
    appearance.language === "en"
      ? "Global percentage unavailable"
      : "Percentual global indisponível";
  const ariaLabel =
    typeof achievement.globalPercent === "number"
      ? `${achievement.title}, ${globalPercent} ${globalPercentLabel}`
      : `${achievement.title}, ${fallbackPercentLabel}`;

  useEffect(() => {
    setSource(preferredSource);
  }, [preferredSource]);

  function showTooltip() {
    const item = itemRef.current;
    if (!item || typeof window === "undefined") return;

    const rect = item.getBoundingClientRect();
    const tooltipWidth = 240;
    const horizontalPadding = 12;
    const left = Math.min(
      Math.max(
        rect.left + rect.width / 2,
        tooltipWidth / 2 + horizontalPadding
      ),
      window.innerWidth - tooltipWidth / 2 - horizontalPadding
    );

    setTooltipPosition({
      left,
      top: Math.max(horizontalPadding, rect.top - 18),
    });
  }

  function hideTooltip() {
    setTooltipPosition(null);
  }

  const tooltip = (
    <span
      className="modal__achievement-tooltip modal__achievement-tooltip--portal"
      role="tooltip"
      style={
        tooltipPosition
          ? {
              left: tooltipPosition.left,
              top: tooltipPosition.top,
            }
          : undefined
      }
    >
      <strong>{achievement.title}</strong>
      <span>
        {typeof achievement.globalPercent === "number"
          ? `${globalPercent} ${globalPercentLabel}`
          : fallbackPercentLabel}
      </span>
    </span>
  );

  return (
    <li
      className={`modal__achievement-item ${isUnlocked ? "modal__achievement-item--unlocked" : "modal__achievement-item--locked"}${onSelect ? " modal__achievement-item--clickable" : ""}`}
      tabIndex={0}
      aria-label={ariaLabel}
      ref={itemRef}
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <img
        src={source}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
        onError={() => {
          if (source !== achievement.iconGray) {
            setSource(achievement.iconGray);
          }
        }}
      />
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(tooltip, document.body)
        : null}
    </li>
  );
}

function achievementImageSourceList(achievements: SteamAchievement[]) {
  return uniqueSources(
    achievements.flatMap((achievement) => [
      achievement.icon,
      achievement.iconGray,
    ])
  );
}

function GameDetailsLoadingSections() {
  const { appearance } = useSettings();
  return (
    <div className="modal__details-loading" role="status">
      <Loader2 size={24} className="modal__details-spinner" aria-hidden="true" />
      <span>
        {appearance.language === "en"
          ? "Loading game information"
          : "Carregando informações do jogo"}
      </span>
    </div>
  );
}

interface GameModalProps {
  game: GhostBoxGame | null;
  isAdding: boolean;
  isAdded: boolean;
  isInstalled: boolean;
  isRemoving: boolean;
  isPlaying: boolean;
  isSessionActive?: boolean;
  isFavorite: boolean;
  automaticBackupEnabled: boolean;
  backupOutputPath: string;
  customExecutablePath: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onQueueGame: (game: GhostBoxGame) => void | Promise<void>;
  onRemoveGame: (game: GhostBoxGame) => void | Promise<void>;
  onToggleFavorite: (game: GhostBoxGame) => void;
  onAddGameToCollection: (
    game: GhostBoxGame,
    collectionId: string
  ) => void | Promise<void>;
  onRemoveGameFromCollection: (
    game: GhostBoxGame,
    collectionId: string
  ) => void | Promise<void>;
  onToggleAutomaticBackup: (
    game: GhostBoxGame,
    enabled: boolean
  ) => void | Promise<void>;
  onSelectGameExecutable: (game: GhostBoxGame) => void | Promise<void>;
  onRemoveGameExecutable: (game: GhostBoxGame) => void | Promise<void>;
  onPlayGame: (game: GhostBoxGame) => void | Promise<void>;
  onSelectBackupOutputPath: () => void;
  onDetailsLoaded?: (game: GhostBoxGame) => void;
  onViewAchievements?: (game: GhostBoxGame) => void;
}

export function GameModal({
  game,
  isAdding,
  isAdded,
  isInstalled,
  isRemoving,
  isPlaying,
  isSessionActive = false,
  isFavorite,
  automaticBackupEnabled,
  backupOutputPath,
  customExecutablePath,
  userCollections,
  onClose,
  onQueueGame,
  onRemoveGame,
  onToggleFavorite,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  onToggleAutomaticBackup,
  onSelectGameExecutable,
  onRemoveGameExecutable,
  onPlayGame,
  onSelectBackupOutputPath,
  onDetailsLoaded,
  onViewAchievements,
}: GameModalProps) {
  const { appearance, t } = useSettings();
  const hasCustomExecutable = Boolean(customExecutablePath);
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const [detailGame, setDetailGame] = useState<GhostBoxGame | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [loadedScreenshotSources, setLoadedScreenshotSources] = useState<
    Set<string>
  >(() => new Set());
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    Set<string>
  >(() => new Set());
  const [failedLogoSources, setFailedLogoSources] = useState<Set<string>>(
    () => new Set()
  );
  const [loadedLogoSource, setLoadedLogoSource] = useState("");
  const [visibleScreenshotSource, setVisibleScreenshotSource] = useState("");
  const [isBackupOptionsOpen, setIsBackupOptionsOpen] = useState(false);
  const [gameReviews, setGameReviews] = useState<SteamGameReview[]>([]);
  const [gameReviewsSummary, setGameReviewsSummary] = useState<
    SteamGameReviewsResult["query_summary"]
  >();
  const [overallGameReviewsSummary, setOverallGameReviewsSummary] = useState<
    SteamGameReviewsResult["query_summary"]
  >();
  const [activeReviewFilter, setActiveReviewFilter] =
    useState<SteamReviewFilter>("all");
  const [activeReviewPage, setActiveReviewPage] = useState(1);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const reviewsSectionRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const aboutContentShellRef = useRef<HTMLDivElement | null>(null);
  const aboutActionsRef = useRef<HTMLDivElement | null>(null);
  const [aboutCollapsedMaxHeight, setAboutCollapsedMaxHeight] = useState<
    number | null
  >(null);

  useEffect(() => {
    setActiveScreenshot(0);
    setLoadedScreenshotSources(new Set());
    setFailedScreenshotSources(new Set());
    setFailedLogoSources(new Set());
    setLoadedLogoSource("");
    setVisibleScreenshotSource("");
    setIsBackupOptionsOpen(false);
    setGameReviews([]);
    setGameReviewsSummary(undefined);
    setOverallGameReviewsSummary(undefined);
    setActiveReviewFilter("all");
    setActiveReviewPage(1);
  }, [game?.id]);

  useEffect(() => {
    let cancelled = false;
    setDetailGame(game);

    if (!game)
      return () => {
        cancelled = true;
      };

    setIsLoadingDetails(true);
    let pendingRequests = 2;
    const finishRequest = () => {
      pendingRequests -= 1;
      if (!cancelled && pendingRequests === 0) setIsLoadingDetails(false);
    };
    const mergeStoreDetails = (details: GhostBoxGame | null) => {
      if (cancelled || !details) return;

      setDetailGame((current) => {
        const base = current ?? game;
        const isPlaceholderTitle = /^Steam \d+$/.test(details.title);
        return {
          ...base,
          ...details,
          title: isPlaceholderTitle && base?.title ? base.title : details.title,
          playTimeInMilliseconds:
            current?.playTimeInMilliseconds ?? game.playTimeInMilliseconds,
          lastTimePlayed: current?.lastTimePlayed ?? game.lastTimePlayed,
        };
      });
      onDetailsLoaded?.(details);
    };
    const mergeAchievementDetails = (details: GhostBoxGame | null) => {
      if (cancelled || !details) return;

      setDetailGame((current) => ({
        ...(current ?? game),
        achievements: details.achievements,
        achievementList: details.achievementList,
      }));
      onDetailsLoaded?.(details);
    };
    const detailsGameId = game.appId || game.id;

    loadGameStoreDetailsCached(detailsGameId)
      .then(mergeStoreDetails)
      .catch(() => undefined)
      .finally(finishRequest);

    loadGameAchievementDetailsCached(detailsGameId)
      .then(mergeAchievementDetails)
      .catch(() => undefined)
      .finally(finishRequest);

    return () => {
      cancelled = true;
    };
  }, [game?.appId, game?.id, onDetailsLoaded]);

  useEffect(() => {
    if (!game) return;

    let cancelled = false;
    const language = steamReviewLanguage(appearance.language);
    setIsLoadingReviews(true);
    setGameReviews([]);
    setGameReviewsSummary(undefined);
    setActiveReviewPage(1);

    loadGameReviewsCached(game.appId || game.id, language, activeReviewFilter)
      .then((result) => {
        if (cancelled) return;
        setGameReviews(result.reviews ?? []);
        setGameReviewsSummary(result.query_summary);
        if (activeReviewFilter === "all") {
          setOverallGameReviewsSummary(result.query_summary);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGameReviews([]);
          setGameReviewsSummary(undefined);
          if (activeReviewFilter === "all") {
            setOverallGameReviewsSummary(undefined);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReviews(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeReviewFilter, appearance.language, game?.appId, game?.id]);

  useEffect(() => {
    if (!game) return;

    setDetailGame((current) => {
      if (!current || current.id !== game.id) return current;

      return {
        ...current,
        playTimeInMilliseconds: game.playTimeInMilliseconds,
        lastTimePlayed: game.lastTimePlayed,
      };
    });
  }, [game?.id, game?.lastTimePlayed, game?.playTimeInMilliseconds]);

  useEffect(() => {
    if (!game) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [game, onClose]);

  const displayGame = detailGame ?? game;
  const stableScreenshots = game?.screenshots.length ? game.screenshots : [];
  const displayScreenshots = displayGame?.screenshots ?? [];
  const rawScreenshots =
    isLoadingDetails && stableScreenshots.length
      ? stableScreenshots
        : displayScreenshots.length
          ? displayScreenshots
          : stableScreenshots;
  const screenshots = withoutHeroImageSources(rawScreenshots);
  const heroSources = displayGame ? gameHeroSources(displayGame) : [];
  const modalHeroSources = heroSources.filter(
    (source) => !screenshots.includes(source)
  );
  const heroScreenshotFallback =
    screenshots.find((source) => modalHeroSources.includes(source)) ??
    screenshots[0] ??
    "";
  const showcaseScreenshots = heroScreenshotFallback
    ? screenshots.filter((source) => source !== heroScreenshotFallback)
    : screenshots;
  const showcaseSources = displayGame
    ? uniqueSources([modalHeroSources[0], ...showcaseScreenshots])
    : showcaseScreenshots;
  const preloadShowcaseSources = uniqueSources([
    ...showcaseSources,
    ...modalHeroSources,
    heroScreenshotFallback,
  ]);
  const cachedScreenshotSources = useCachedImageSources(showcaseSources);
  const logoSources = displayGame ? gameLogoSources(displayGame) : [];
  const cachedLogoSources = useCachedImageSources(logoSources);
  const logoCandidates = uniqueSources([...cachedLogoSources, ...logoSources]);
  const currentLogoSource =
    logoCandidates.find((source) => !failedLogoSources.has(source)) ?? "";
  const achievements = useMemo(
    () =>
      [...(displayGame?.achievementList ?? [])].sort(
        (a, b) => Number(b.unlocked === true) - Number(a.unlocked === true)
      ),
    [displayGame?.achievementList]
  );
  const unlockedAchievementsCount = achievements.filter(
    (achievement) => achievement.unlocked === true
  ).length;
  const visibleAchievements = achievements.slice(0, 12);
  const hasMoreAchievements = achievements.length > 12;
  const screenshotsKey = showcaseSources.join("\n");
  const modalHeroSourcesKey = modalHeroSources.join("\n");
  const cachedScreenshotsKey = cachedScreenshotSources.join("\n");
  const achievementImageSources =
    achievementImageSourceList(visibleAchievements);
  const achievementImageSourcesKey = achievementImageSources.join("\n");

  const screenshotItems = useMemo(
    () =>
      showcaseSources.map((source, index) => {
        const isHeroItem =
          index === 0 && modalHeroSources.includes(source);
        const heroCandidates = isHeroItem ? modalHeroSources : [];
        const screenshotFallback =
          isHeroItem && heroScreenshotFallback ? [heroScreenshotFallback] : [];
        const sourceCandidates = isHeroItem
          ? [...heroCandidates, ...screenshotFallback]
          : [source];
        const candidates = uniqueSources(
          sourceCandidates.flatMap((candidate) => [
            imageSourceCache.get(candidate),
            candidate,
          ])
        );
        const loadedSource = candidates.find(
          (candidate) =>
            loadedScreenshotSources.has(candidate) &&
            !failedScreenshotSources.has(candidate)
        );
        const displaySource =
          loadedSource ??
          candidates.find(
            (candidate) => !failedScreenshotSources.has(candidate)
          ) ??
          "";
        const isHeroDisplay = isHeroItem
          ? heroCandidates.some(
              (candidate) =>
                displaySource === candidate ||
                displaySource === imageSourceCache.get(candidate)
            )
          : false;
        return { source, index, displaySource, isHeroDisplay };
      }),
    [
      screenshotsKey,
      modalHeroSourcesKey,
      heroScreenshotFallback,
      cachedScreenshotsKey,
      loadedScreenshotSources,
      failedScreenshotSources,
    ]
  );

  const currentScreenshotItem = screenshotItems[activeScreenshot];
  const currentScreenshotSource = currentScreenshotItem?.displaySource ?? "";
  const isCurrentItemHero = Boolean(
    currentScreenshotItem && currentScreenshotItem.isHeroDisplay
  );
  const hasVisibleScreenshot = displayGame
    ? Boolean(
        currentScreenshotSource &&
        visibleScreenshotSource === currentScreenshotSource
      )
    : false;
  const shouldShowLogoOverlay = Boolean(
    loadedLogoSource &&
    currentScreenshotSource &&
    currentScreenshotItem &&
    hasVisibleScreenshot &&
    isCurrentItemHero
  );

  useEffect(() => {
    if (activeScreenshot > 0 && activeScreenshot >= showcaseSources.length) {
      setActiveScreenshot(0);
    }
  }, [activeScreenshot, showcaseSources.length]);

  useEffect(() => {
    preloadImageSources(
      getPriorityScreenshotSources(preloadShowcaseSources, activeScreenshot),
      {
        limit: 5,
        decode: true,
      }
    );
    preloadImageSources(preloadShowcaseSources, { limit: 8, idle: true });
  }, [activeScreenshot, screenshotsKey, modalHeroSourcesKey]);

  useEffect(() => {
    preloadImageSources(achievementImageSources, {
      limit: achievementImageSources.length,
      idle: true,
      decode: true,
    });
  }, [achievementImageSourcesKey]);

  useEffect(() => {
    setLoadedLogoSource((source) =>
      source === currentLogoSource ? source : ""
    );
    if (!currentLogoSource || typeof Image === "undefined") return;

    let cancelled = false;
    let settled = false;
    const image = new Image();
    const failLogoSource = () => {
      if (cancelled || settled) return;

      settled = true;
      setFailedLogoSources((failedSources) =>
        new Set(failedSources).add(currentLogoSource)
      );
    };
    const timeoutId = window.setTimeout(failLogoSource, 4500);

    image.decoding = "async";
    image.onload = async () => {
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }

      if (cancelled || settled) return;

      settled = true;
      window.clearTimeout(timeoutId);
      setLoadedLogoSource(currentLogoSource);
    };
    image.onerror = failLogoSource;
    image.src = currentLogoSource;

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentLogoSource]);

  useEffect(() => {
    if (
      currentScreenshotSource &&
      loadedScreenshotSources.has(currentScreenshotSource)
    ) {
      setVisibleScreenshotSource(currentScreenshotSource);
    }
  }, [currentScreenshotSource, loadedScreenshotSources]);

  useEffect(() => {
    setIsAboutExpanded(false);
  }, [displayGame?.id]);

  const visibleTags = displayGame?.tags.slice(0, 8) ?? [];
  const visibleGenres = displayGame
    ? displayGame.genres.length
      ? displayGame.genres
      : displayGame.tags.slice(0, 3)
    : [];
  const visibleChips = [...new Set([...visibleGenres, ...visibleTags])];
  const aboutTheGameHtml = useMemo(
    () => getSanitizedSteamAboutHtml(displayGame?.aboutTheGame),
    [displayGame?.aboutTheGame]
  );
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const hasRequirements = Boolean(
    displayGame?.pcRequirements?.minimum.length ||
    displayGame?.pcRequirements?.recommended.length
  );
  const shouldShowDetailLoading =
    isLoadingDetails &&
    !visibleChips.length &&
    !achievements.length &&
    !hasRequirements;

  useEffect(() => {
    if (!aboutTheGameHtml || isAboutExpanded) {
      setAboutCollapsedMaxHeight(null);
      return;
    }

    let frameId = 0;
    const updateCollapsedHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const sidebar = sidebarRef.current;
        const shell = aboutContentShellRef.current;
        const actions = aboutActionsRef.current;
        if (!sidebar || !shell || !actions) return;

        const sidebarBottom = sidebar.getBoundingClientRect().bottom;
        const shellTop = shell.getBoundingClientRect().top;
        const actionsHeight = actions.getBoundingClientRect().height;
        const nextHeight = Math.max(
          160,
          Math.floor(sidebarBottom - shellTop - actionsHeight - 10)
        );

        setAboutCollapsedMaxHeight((current) =>
          current !== null && Math.abs(current - nextHeight) <= 1
            ? current
            : nextHeight
        );
      });
    };

    updateCollapsedHeight();
    window.addEventListener("resize", updateCollapsedHeight);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateCollapsedHeight)
        : null;
    if (observer) {
      if (sidebarRef.current) observer.observe(sidebarRef.current);
      if (aboutContentShellRef.current) observer.observe(aboutContentShellRef.current);
      if (aboutActionsRef.current) observer.observe(aboutActionsRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateCollapsedHeight);
      observer?.disconnect();
    };
  }, [aboutTheGameHtml, isAboutExpanded, displayGame?.id, shouldShowDetailLoading]);

  const sortedGameReviews =
    activeReviewFilter === "all"
      ? gameReviews
      : [...gameReviews].sort((a, b) => {
          const voteDifference = (b.votes_up ?? 0) - (a.votes_up ?? 0);
          if (voteDifference !== 0) return voteDifference;
          return (b.timestamp_created ?? 0) - (a.timestamp_created ?? 0);
        });
  const reviewPageCount = Math.ceil(sortedGameReviews.length / reviewsPerPage);
  const visibleGameReviews = sortedGameReviews.slice(
    (activeReviewPage - 1) * reviewsPerPage,
    activeReviewPage * reviewsPerPage
  );
  const reviewPaginationItems = getReviewPaginationItems(
    reviewPageCount,
    activeReviewPage
  );

  function handleViewAchievements() {
    if (!displayGame || !onViewAchievements) return;
    onViewAchievements(displayGame);
  }

  function handleReviewPageChange(page: number) {
    if (page === activeReviewPage) return;

    setActiveReviewPage(page);
    window.requestAnimationFrame(() => {
      reviewsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <>
      {displayGame && (
        <div
          className="backdrop backdrop--details"
          key={displayGame.id}
          onClick={onClose}
        >
          <article
            className="modal modal--details"
            style={gameStyle(displayGame)}
            onClick={(event) => event.stopPropagation()}
          >
            <section className="modal__showcase">
              <div className="modal__showcase-media">
                {currentScreenshotItem ? (
                  <div
                    className={`modal__showcase-image-shell ${hasVisibleScreenshot ? "modal__showcase-image-shell--loaded" : ""}`}
                    role="img"
                    aria-label={
                      appearance.language === "en"
                        ? `Screenshot of ${displayGame.title}`
                        : `Screenshot de ${displayGame.title}`
                    }
                  >
                    <div
                      className="modal__showcase-placeholder"
                      aria-hidden="true"
                    />
                    {screenshotItems.map(
                      (item) =>
                        item.displaySource && (
                          <img
                            className={`modal__showcase-image ${item.displaySource === currentScreenshotSource && item.displaySource === visibleScreenshotSource ? "modal__showcase-image--visible" : ""}`}
                            src={item.displaySource}
                            key={`${item.index}-${item.source}-${item.displaySource}`}
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                            loading="eager"
                            onLoad={async (event) => {
                              const image = event.currentTarget;
                              if (typeof image.decode === "function") {
                                await image.decode().catch(() => undefined);
                              }
                              setLoadedScreenshotSources((loadedSources) => {
                                if (loadedSources.has(item.displaySource))
                                  return loadedSources;
                                const nextLoadedSources = new Set(
                                  loadedSources
                                );
                                nextLoadedSources.add(item.displaySource);
                                return nextLoadedSources;
                              });
                              if (
                                item.displaySource === currentScreenshotSource
                              ) {
                                setVisibleScreenshotSource(item.displaySource);
                              }
                            }}
                            onError={() => {
                              setFailedScreenshotSources((failedSources) =>
                                new Set(failedSources).add(item.displaySource)
                              );
                            }}
                          />
                        )
                    )}
                    {shouldShowLogoOverlay && (
                      <img
                        className="modal__showcase-logo modal__showcase-logo--visible"
                        src={loadedLogoSource}
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                        loading="eager"
                        onError={() => {
                          setFailedLogoSources((failedSources) =>
                            new Set(failedSources).add(loadedLogoSource)
                          );
                          setLoadedLogoSource("");
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="modal__showcase-empty">
                    <ImageIcon size={28} />
                  </div>
                )}

                <div
                  className={`modal__actions ${isAdding ? "modal__actions--adding" : ""}`}
                >
                  {(isInstalled || hasCustomExecutable) && (
                    <button
                      type="button"
                      className="button button--primary modal__play-button"
                      onClick={() => {
                        if (isPlaying || isSessionActive) return;
                        onPlayGame(displayGame);
                      }}
                      disabled={isPlaying || isSessionActive}
                      aria-busy={isPlaying}
                    >
                      {isPlaying ? (
                        <span className="modal__add-spinner modal__add-spinner--light" aria-hidden="true" />
                      ) : (
                        <Play size={20} strokeWidth={2} />
                      )}
                      <span className="button__label modal__action-label">
                        {isSessionActive
                          ? appearance.language === "en"
                            ? "Playing"
                            : "Jogando"
                          : isPlaying
                            ? appearance.language === "en"
                              ? "Launching"
                              : "Iniciando"
                            : appearance.language === "en"
                              ? "Play"
                              : "Jogar"}
                      </span>
                    </button>
                  )}
                  {isAdding ? (
                    <div
                      className="modal__adding-state"
                      aria-label={
                        appearance.language === "en"
                          ? "Adding game"
                          : "Adicionando jogo"
                      }
                    >
                      <span className="modal__add-progress" />
                    </div>
                  ) : isAdded ? (
                    <>
                      <button
                        type="button"
                        className="button button--primary modal__remove-button"
                        onClick={() => onRemoveGame(displayGame)}
                        disabled={isRemoving}
                      >
                        {isRemoving ? (
                          <>
                            <span
                              className="modal__add-spinner modal__add-spinner--light"
                              aria-hidden="true"
                            />
                            <span className="button__label modal__action-label">
                              {appearance.language === "en"
                                ? "Removing"
                                : "Removendo"}
                            </span>
                          </>
                        ) : (
                          <>
                            <Trash2 size={18} aria-hidden="true" />
                            <span className="button__label modal__action-label">
                              {appearance.language === "en"
                                ? "Remove"
                                : "Remover"}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""}`}
                        onClick={() => onToggleFavorite(displayGame)}
                        aria-pressed={isFavorite}
                        aria-label={
                          isFavorite
                            ? appearance.language === "en"
                              ? `Remove ${displayGame.title} from favorites`
                              : `Remover ${displayGame.title} dos favoritos`
                            : appearance.language === "en"
                              ? `Add ${displayGame.title} to favorites`
                              : `Adicionar ${displayGame.title} aos favoritos`
                        }
                      >
                        <Heart
                          size={20}
                          fill={isFavorite ? "currentColor" : "none"}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}`}
                        onClick={() => setIsBackupOptionsOpen(true)}
                        aria-label={
                          appearance.language === "en"
                            ? "Backup settings"
                            : "Ajustes de backup"
                        }
                      >
                        <Settings size={20} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      {!hasCustomExecutable && (
                        <button
                          type="button"
                          className="button button--primary modal__add-button"
                          onClick={() => onQueueGame(displayGame)}
                        >
                          <Download size={20} />
                          <span className="button__label modal__action-label">
                            {appearance.language === "en" ? "Add" : "Adicionar"}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""}`}
                        onClick={() => onToggleFavorite(displayGame)}
                        aria-pressed={isFavorite}
                        aria-label={
                          isFavorite
                            ? appearance.language === "en"
                              ? `Remove ${displayGame.title} from favorites`
                              : `Remover ${displayGame.title} dos favoritos`
                            : appearance.language === "en"
                              ? `Add ${displayGame.title} to favorites`
                              : `Adicionar ${displayGame.title} aos favoritos`
                        }
                      >
                        <Heart
                          size={20}
                          fill={isFavorite ? "currentColor" : "none"}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}`}
                        onClick={() => setIsBackupOptionsOpen(true)}
                        aria-label={
                          appearance.language === "en"
                            ? "Backup settings"
                            : "Ajustes de backup"
                        }
                      >
                        <Settings size={20} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="modal__details">
              <div className="modal__details-main">
                <div className="modal__main-title-block">
                  <h3>{displayGame.title}</h3>
                  <div className="modal__main-title-meta">
                    {displayGame.publishers?.filter(Boolean).join(", ") && (
                      <span>{displayGame.publishers.filter(Boolean).join(", ")}</span>
                    )}
                    {displayGame.release && <span>{displayGame.release}</span>}
                  </div>
                </div>

                <GallerySlider
                  screenshots={screenshots}
                  movies={displayGame.movies}
                  gameTitle={displayGame.title}
                  language={appearance.language}
                />

                {aboutTheGameHtml && (
                  <section
                    className="modal__about-section"
                    aria-label={
                      appearance.language === "en"
                        ? "About the game"
                        : "Sobre o jogo"
                    }
                  >
                    <div className="modal__about-heading">
                      <strong>
                        {appearance.language === "en"
                          ? "About the game"
                          : "Sobre o jogo"}
                      </strong>
                    </div>
                    <div
                      ref={aboutContentShellRef}
                      className={`modal__about-content-shell ${isAboutExpanded ? "modal__about-content-shell--expanded" : ""}`}
                      style={
                        !isAboutExpanded && aboutCollapsedMaxHeight !== null
                          ? {
                              height: aboutCollapsedMaxHeight,
                              maxHeight: aboutCollapsedMaxHeight,
                            }
                          : undefined
                      }
                    >
                      <div
                        className="modal__about-content"
                        dangerouslySetInnerHTML={{ __html: aboutTheGameHtml }}
                      />
                      {!isAboutExpanded && (
                        <div className="modal__about-fade" aria-hidden="true" />
                      )}
                    </div>
                    <div className="modal__about-actions" ref={aboutActionsRef}>
                      <button
                        type="button"
                        className="button button--outline modal__about-toggle"
                        onClick={() => setIsAboutExpanded((value) => !value)}
                      >
                        {isAboutExpanded
                          ? appearance.language === "en"
                            ? "Show less"
                            : "Ver menos"
                          : appearance.language === "en"
                            ? "Show more"
                            : "Ver mais"}
                      </button>
                    </div>
                  </section>
                )}
              </div>

              <aside className="modal__sidebar" ref={sidebarRef}>
                {shouldShowDetailLoading ? (
                  <GameDetailsLoadingSections />
                ) : (
                  <>
                    {achievements.length > 0 && (
                      <section
                        className="modal__achievements-section"
                        aria-label={
                          appearance.language === "en"
                            ? "Achievements"
                            : "Conquistas"
                        }
                      >
                        <div className="modal__achievements-heading">
                          <Trophy size={16} />
                          <strong>
                            {appearance.language === "en"
                              ? "Achievements"
                              : "Conquistas"}
                          </strong>
                          <span>{unlockedAchievementsCount}</span>
                        </div>

                        <ul className="modal__achievements-grid">
                          {visibleAchievements.map((achievement) => (
                            <AchievementIcon
                              achievement={achievement}
                              key={achievement.name}
                              onSelect={
                                onViewAchievements
                                  ? handleViewAchievements
                                  : undefined
                              }
                            />
                          ))}
                        </ul>

                        {hasMoreAchievements && onViewAchievements && (
                          <button
                            type="button"
                            className="modal__achievements-toggle"
                            onClick={handleViewAchievements}
                          >
                            {t("achievements.viewMore")}
                            <ChevronDown size={16} />
                          </button>
                        )}
                      </section>
                    )}

                    <GameRequirementsSection
                      requirements={displayGame.pcRequirements}
                    />

                    {visibleChips.length > 0 && (
                      <section
                        className="modal__chips-section"
                        aria-label={
                          appearance.language === "en"
                            ? "Genres and tags"
                            : "Gêneros e Tags"
                        }
                      >
                        <div className="modal__chips-heading">
                          <TagsIcon size={16} />
                          <strong>
                            {appearance.language === "en"
                              ? "Genres and tags"
                              : "Gêneros e Tags"}
                          </strong>
                        </div>
                        <div className="modal__chips">
                          {visibleChips.map((chip) => (
                            <span className="modal__chip" key={chip}>
                              {chip}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}

                    <ReviewRecommendationSidebar
                      summary={overallGameReviewsSummary ?? gameReviewsSummary}
                      isLoading={isLoadingReviews}
                      fallbackPositiveRatio={displayGame.steamPositiveRatio}
                      fallbackReviewCount={displayGame.steamReviewCount}
                      language={appearance.language}
                    />
                  </>
                )}
              </aside>

              <section
                className="modal__reviews-section"
                ref={reviewsSectionRef}
                aria-label={
                  appearance.language === "en"
                    ? "Steam reviews"
                    : "Reviews da Steam"
                }
              >
                <div className="modal__reviews-heading">
                  <div className="modal__reviews-heading-title">
                    <MessageCircle size={16} aria-hidden="true" />
                    <strong>
                      {appearance.language === "en"
                        ? "Player reviews"
                        : "Reviews dos jogadores"}
                    </strong>
                  </div>
                </div>

                <div
                  className="modal__reviews-filters"
                  role="tablist"
                  aria-label={
                    appearance.language === "en"
                      ? "Review filters"
                      : "Filtros de reviews"
                  }
                >
                  {steamReviewFilters.map((filter) => (
                    <button
                      type="button"
                      className={`modal__reviews-filter ${activeReviewFilter === filter ? "modal__reviews-filter--active" : ""}`}
                      onClick={() => {
                        setActiveReviewFilter(filter);
                        setActiveReviewPage(1);
                      }}
                      aria-selected={activeReviewFilter === filter}
                      role="tab"
                      key={filter}
                    >
                      {steamReviewFilterLabel(filter, appearance.language)}
                    </button>
                  ))}
                </div>

                {isLoadingReviews ? (
                  <div className="modal__reviews-loading">
                    <span className="modal__add-spinner modal__add-spinner--light" aria-hidden="true" />
                    <span>
                      {appearance.language === "en"
                        ? "Loading reviews"
                        : "Carregando reviews"}
                    </span>
                  </div>
                ) : gameReviews.length > 0 ? (
                  <>
                    <div
                      className="modal__reviews-list"
                      key={`${activeReviewFilter}-${activeReviewPage}`}
                    >
                      {visibleGameReviews.map((review) => (
                        <SteamReviewCard
                          review={review}
                          language={appearance.language}
                          key={review.recommendationid}
                        />
                      ))}
                    </div>
                    {reviewPageCount > 1 && (
                      <nav
                        className="modal__reviews-pagination"
                        aria-label={
                          appearance.language === "en"
                            ? "Review pages"
                            : "Páginas de reviews"
                        }
                      >
                        {reviewPaginationItems.map((item, index) =>
                          item === "ellipsis" ? (
                            <span
                              className="modal__reviews-pagination-ellipsis"
                              aria-hidden="true"
                              key={`ellipsis-${index}`}
                            >
                              ...
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={`modal__reviews-page ${activeReviewPage === item ? "modal__reviews-page--active" : ""}`}
                              onClick={() => handleReviewPageChange(item)}
                              aria-current={
                                activeReviewPage === item ? "page" : undefined
                              }
                              key={item}
                            >
                              {item}
                            </button>
                          )
                        )}
                      </nav>
                    )}
                  </>
                ) : (
                  <p className="modal__reviews-empty">
                    {appearance.language === "en"
                      ? "No reviews found for this filter and language."
                      : "Nenhum review encontrado neste filtro e idioma."}
                  </p>
                )}
              </section>
            </section>
          </article>
        </div>
      )}
      <BackupOptionsModal
        open={isBackupOptionsOpen && Boolean(displayGame)}
        gameId={displayGame?.id ?? ""}
        gameTitle={displayGame?.title ?? ""}
        automaticBackupEnabled={automaticBackupEnabled}
        backupAvailable={isAdded || hasCustomExecutable}
        backupOutputPath={backupOutputPath}
        customExecutablePath={customExecutablePath}
        userCollections={userCollections}
        onClose={() => setIsBackupOptionsOpen(false)}
        onToggleAutomaticBackup={(enabled) => {
          if (!displayGame) return;
          onToggleAutomaticBackup(displayGame, enabled);
          setIsBackupOptionsOpen(false);
        }}
        onSelectBackupOutputPath={onSelectBackupOutputPath}
        onSelectGameExecutable={() => {
          if (!displayGame) return;
          onSelectGameExecutable(displayGame);
        }}
        onRemoveGameExecutable={() => {
          if (!displayGame) return;
          onRemoveGameExecutable(displayGame);
        }}
        onAddGameToCollection={(collectionId) => {
          if (!displayGame) return;
          onAddGameToCollection?.(displayGame, collectionId);
        }}
        onRemoveGameFromCollection={(collectionId) => {
          if (!displayGame) return;
          onRemoveGameFromCollection(displayGame, collectionId);
        }}
      />
    </>
  );
}
