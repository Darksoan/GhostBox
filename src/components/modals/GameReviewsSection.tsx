import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BarChart3, ChevronDown, ChevronLeft, MessageCircle } from "lucide-react";
import type { SteamGameReview, SteamGameReviewsResult } from "../../lib/ghostboxApi.types";
import { loadGameReviewsCached } from "../../utils/gameCache";
import { useCollapsiblePanelHeight } from "../../hooks/useCollapsiblePanelHeight";
import { formatCompactPlaytime } from "../../utils/time";

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
  if (filter === "positive") return language === "en" ? "Most positive" : "Mais positivas";
  if (filter === "negative") return language === "en" ? "Most negative" : "Mais negativas";
  return language === "en" ? "Most recent" : "Mais recentes";
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
  return summary?.total_reviews ?? summary?.num_reviews ?? positive + negative;
}

function formatReviewNumber(value: number, language: "pt" | "en") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR").format(value);
}

function formatReviewCountLabel(value: number, language: "pt" | "en") {
  if (value <= 0) return language === "en" ? "No reviews" : "Sem análises";
  return `${formatReviewNumber(value, language)} ${language === "en" ? "reviews" : "análises"}`;
}

function getReviewSentimentLabel(percent: number, reviewCount: number, language: "pt" | "en") {
  if (reviewCount < 10) return language === "en" ? "Few reviews" : "Poucas análises";
  if (percent >= 95) return language === "en" ? "Overwhelmingly positive" : "Extremamente positivas";
  if (percent >= 85) return language === "en" ? "Very positive" : "Muito positivas";
  if (percent >= 70) return language === "en" ? "Positive" : "Positivas";
  if (percent >= 40) return language === "en" ? "Mixed" : "Mistas";
  if (percent >= 20) return language === "en" ? "Negative" : "Negativas";
  return language === "en" ? "Very negative" : "Muito negativas";
}

function getReviewScoreFillColor(percent: number) {
  if (percent < 40) return "var(--danger)";
  return "var(--text-strong)";
}

function ReviewRecommendationSidebar({
  summary,
  totalSummary,
  isLoading,
  fallbackPositiveRatio,
  fallbackReviewCount,
  language,
}: {
  summary?: SteamGameReviewsResult["query_summary"];
  totalSummary?: SteamGameReviewsResult["query_summary"];
  isLoading: boolean;
  fallbackPositiveRatio?: number;
  fallbackReviewCount?: number;
  language: "pt" | "en";
}) {
  const fallbackPercent =
    typeof fallbackPositiveRatio === "number" && Number.isFinite(fallbackPositiveRatio)
      ? Math.round(fallbackPositiveRatio * 100)
      : null;
  const displaySummary = totalSummary ?? summary;
  const overallPercent = getRecommendedPercent(displaySummary) ?? fallbackPercent;
  const totalReviews =
    getReviewSummaryTotal(displaySummary) ||
    (typeof fallbackReviewCount === "number" && Number.isFinite(fallbackReviewCount) ? fallbackReviewCount : 0);
  const positiveReviews = displaySummary?.total_positive ?? 0;
  const negativeReviews = displaySummary?.total_negative ?? 0;
  const hasBreakdown = positiveReviews > 0 || negativeReviews > 0;
  const meterFill = getReviewScoreFillColor(overallPercent ?? 0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [reviewPanelRef, reviewPanelHeight] = useCollapsiblePanelHeight();

  if (!isLoading && overallPercent === null) return null;

  return (
    <section
      className="modal__review-summary-section"
      aria-label={language === "en" ? "Review recommendation" : "Recomendação das análises"}
    >
      <button
        type="button"
        className="modal__review-summary-heading modal__sidebar-section-toggle"
        aria-expanded={!isCollapsed}
        aria-controls="modal-review-summary-panel"
        onClick={() => setIsCollapsed((value) => !value)}
      >
        <BarChart3 size={18} aria-hidden="true" />
        <strong>{language === "en" ? "Recommendation" : "Recomendação"}</strong>
        <ChevronDown
          className="modal__sidebar-section-chevron"
          size={16}
          aria-hidden="true"
        />
      </button>

      <div
        ref={reviewPanelRef}
        className="modal__sidebar-section-content"
        id="modal-review-summary-panel"
        aria-hidden={isCollapsed}
        data-collapsed={isCollapsed ? "true" : "false"}
        style={{ height: isCollapsed ? 0 : reviewPanelHeight } as CSSProperties}
      >
        {isLoading && overallPercent === null ? (
          <div className="modal__review-summary-loading">
            {language === "en" ? "Loading reviews" : "Carregando análises"}
          </div>
        ) : (
          <div className="modal__review-summary-card">
            <div className="modal__review-summary-score">
              <strong>{overallPercent}%</strong>
              <span>{language === "en" ? "recommend" : "recomendam"}</span>
            </div>
            <span className="modal__review-summary-sentiment">
              {getReviewSentimentLabel(overallPercent ?? 0, totalReviews, language)}
            </span>
            <div className="modal__review-summary-meter" aria-hidden="true">
              <span style={{ width: `${overallPercent ?? 0}%`, backgroundColor: meterFill }} />
            </div>
            {hasBreakdown ? (
              <div className="modal__review-summary-breakdown">
                <span className="modal__review-summary-breakdown-item modal__review-summary-breakdown-item--positive">
                  <strong>{formatReviewNumber(positiveReviews, language)}</strong>
                  <span>{language === "en" ? "positive" : "positivas"}</span>
                </span>
                <span className="modal__review-summary-breakdown-item modal__review-summary-breakdown-item--negative">
                  <strong>{formatReviewNumber(negativeReviews, language)}</strong>
                  <span>{language === "en" ? "negative" : "negativas"}</span>
                </span>
              </div>
            ) : (
              <span className="modal__review-summary-count">
                {formatReviewCountLabel(totalReviews, language)}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function getReviewPaginationItems(totalPages: number, activePage: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (activePage <= 4) return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  if (activePage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const;
  }
  return [1, "ellipsis", activePage - 1, activePage, activePage + 1, "ellipsis", totalPages] as const;
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

function SteamReviewCard({ review, language }: { review: SteamGameReview; language: "pt" | "en" }) {
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
          <img className="modal__review-avatar" src={avatarUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="modal__review-avatar modal__review-avatar--empty" />
        )}
        <div className="modal__review-author-copy">
          <strong>{authorName}</strong>
          <span>
            {formatCompactPlaytime(playtimeAtReview * 60_000)} {language === "en" ? "at review" : "no review"}
            {reviewDate ? ` · ${reviewDate}` : ""}
          </span>
        </div>
      </div>
      <p className={`modal__review-text ${isExpanded ? "modal__review-text--expanded" : ""}`}>{reviewText}</p>
      {isLongReview && (
        <button type="button" className="modal__review-toggle" onClick={() => setIsExpanded((value) => !value)}>
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

interface GameReviewsSectionProps {
  gameId: string;
  fallbackPositiveRatio?: number;
  fallbackReviewCount?: number;
  language: "pt" | "en";
  summaryContainer?: HTMLElement | null;
}

export function GameReviewsSection({
  gameId,
  fallbackPositiveRatio,
  fallbackReviewCount,
  language,
  summaryContainer,
}: GameReviewsSectionProps) {
  const [gameReviews, setGameReviews] = useState<SteamGameReview[]>([]);
  const [gameReviewsSummary, setGameReviewsSummary] = useState<SteamGameReviewsResult["query_summary"]>();
  const [overallGameReviewsSummary, setOverallGameReviewsSummary] = useState<SteamGameReviewsResult["query_summary"]>();
  const [globalGameReviewsSummary, setGlobalGameReviewsSummary] = useState<SteamGameReviewsResult["query_summary"]>();
  const [activeReviewFilter, setActiveReviewFilter] = useState<SteamReviewFilter>("all");
  const [activeReviewPage, setActiveReviewPage] = useState(1);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setSortDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortDropdownOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortDropdownOpen]);

  useEffect(() => {
    if (nearViewport) return;
    const node = sectionRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "700px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport) return;

    let cancelled = false;
    const steamLanguage = steamReviewLanguage(language);
    setIsLoadingReviews(true);
    setGameReviews([]);
    setGameReviewsSummary(undefined);
    setActiveReviewPage(1);

    loadGameReviewsCached(gameId, steamLanguage, activeReviewFilter)
      .then(async (result) => {
        if (cancelled) return;
        let displayResult = result;
        const localizedReviewCount = result.reviews?.length ?? 0;

        if (localizedReviewCount < reviewsPerPage) {
          const globalResult = await loadGameReviewsCached(
            gameId,
            "all",
            activeReviewFilter
          ).catch(() => null);
          if (cancelled) return;
          if (
            globalResult &&
            (globalResult.reviews?.length ?? 0) > localizedReviewCount
          ) {
            displayResult = globalResult;
          }
        }

        setGameReviews(displayResult.reviews ?? []);
        setGameReviewsSummary(displayResult.query_summary);
        if (activeReviewFilter === "all") {
          setOverallGameReviewsSummary(displayResult.query_summary);
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
  }, [activeReviewFilter, language, gameId, nearViewport]);

  useEffect(() => {
    if (!nearViewport) return;

    let cancelled = false;
    setGlobalGameReviewsSummary(undefined);

    loadGameReviewsCached(gameId, "all", "all")
      .then((result) => {
        if (!cancelled) setGlobalGameReviewsSummary(result.query_summary);
      })
      .catch(() => {
        if (!cancelled) setGlobalGameReviewsSummary(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, nearViewport]);

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
  const reviewPaginationItems = getReviewPaginationItems(reviewPageCount, activeReviewPage);

  function handleReviewPageChange(page: number) {
    if (page === activeReviewPage) return;
    setActiveReviewPage(page);
    window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const recommendationSummary = (
    <ReviewRecommendationSidebar
      summary={overallGameReviewsSummary ?? gameReviewsSummary}
      totalSummary={globalGameReviewsSummary}
      isLoading={isLoadingReviews}
      fallbackPositiveRatio={fallbackPositiveRatio}
      fallbackReviewCount={fallbackReviewCount}
      language={language}
    />
  );

  return (
    <>
      {summaryContainer
        ? createPortal(recommendationSummary, summaryContainer)
        : recommendationSummary}

      <section className="modal__reviews-section" ref={sectionRef} aria-label={language === "en" ? "Steam reviews" : "Reviews da Steam"}>
        <div className="modal__reviews-heading">
          <div className="modal__reviews-heading-title">
            <MessageCircle size={16} aria-hidden="true" />
            <strong>{language === "en" ? "Player reviews" : "Reviews dos jogadores"}</strong>
          </div>

          <div
            className={`settings-dropdown modal__reviews-sort ${sortDropdownOpen ? "settings-dropdown--open" : ""}`}
            ref={sortDropdownRef}
          >
            <button
              type="button"
              className="settings-dropdown__trigger modal__reviews-sort-trigger"
              aria-haspopup="listbox"
              aria-expanded={sortDropdownOpen}
              aria-label={language === "en" ? "Sort reviews" : "Ordenar reviews"}
              onClick={() => setSortDropdownOpen((current) => !current)}
            >
              <span className="modal__reviews-sort-label">
                <small>{language === "en" ? "Sort" : "Ordenar"}</small>
                <span>{steamReviewFilterLabel(activeReviewFilter, language)}</span>
              </span>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            {sortDropdownOpen && (
              <div
                className="settings-dropdown__menu"
                role="listbox"
                aria-label={language === "en" ? "Sort reviews by" : "Ordenar reviews por"}
              >
                {steamReviewFilters
                  .filter((filter) => filter !== activeReviewFilter)
                  .map((filter) => (
                    <button
                      type="button"
                      className="settings-dropdown__option"
                      role="option"
                      key={filter}
                      onClick={() => {
                        setActiveReviewFilter(filter);
                        setActiveReviewPage(1);
                        setSortDropdownOpen(false);
                      }}
                    >
                      <span>{steamReviewFilterLabel(filter, language)}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {isLoadingReviews ? (
          <div className="modal__reviews-loading">
            <span className="modal__add-spinner modal__add-spinner--light" aria-hidden="true" />
            <span>{language === "en" ? "Loading reviews" : "Carregando reviews"}</span>
          </div>
        ) : gameReviews.length > 0 ? (
          <>
            <div className="modal__reviews-list" key={`${activeReviewFilter}-${activeReviewPage}`}>
              {visibleGameReviews.map((review) => (
                <SteamReviewCard review={review} language={language} key={review.recommendationid} />
              ))}
            </div>
            {reviewPageCount > 1 && (
              <nav className="modal__reviews-pagination" aria-label={language === "en" ? "Review pages" : "Páginas de reviews"}>
                {reviewPaginationItems.map((item, index) =>
                  item === "ellipsis" ? (
                    <span className="modal__reviews-pagination-ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>
                      ...
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`modal__reviews-page ${activeReviewPage === item ? "modal__reviews-page--active" : ""}`}
                      onClick={() => handleReviewPageChange(item)}
                      aria-current={activeReviewPage === item ? "page" : undefined}
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
            {language === "en" ? "No reviews found for this filter and language." : "Nenhum review encontrado neste filtro e idioma."}
          </p>
        )}
      </section>
    </>
  );
}
