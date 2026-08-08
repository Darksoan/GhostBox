import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useSettings } from "../../context/settings";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, totalPages, onPageChange }: PaginationControlsProps) {
  const { t } = useSettings();
  const pages = useMemo(() => {
    const result: (number | string)[] = [];
    const range = 3;

    if (totalPages <= range + 1) {
      for (let i = 1; i <= totalPages; i++) result.push(i);
    } else {
      let start = Math.max(1, page - Math.floor(range / 2));
      let end = start + range - 1;

      if (end > totalPages) {
        end = totalPages;
        start = Math.max(1, end - range + 1);
      }

      for (let i = start; i <= end; i++) result.push(i);

      if (end < totalPages) {
        if (end < totalPages - 1) result.push("...");
        result.push(totalPages);
      }
    }

    return result;
  }, [page, totalPages]);

  return (
    <nav className="pagination-controls" aria-label={t("catalogue.pagination.label")}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="pagination-controls__arrow"
        aria-label={t("catalogue.pagination.previous")}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      <div className="pagination-controls__numbers">
        {pages.map((p, i) => (
          typeof p === "number" ? (
            <button
              key={`${p}-${i}`}
              type="button"
              className={`pagination-controls__page ${p === page ? "pagination-controls__page--active" : ""}`}
              aria-current={p === page ? "page" : undefined}
              aria-label={`${t("catalogue.pagination.page")} ${p}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ) : (
            <span
              key={`${p}-${i}`}
              className="pagination-controls__page pagination-controls__page--ellipsis"
              aria-hidden="true"
            >
              {p}
            </span>
          )
        ))}
      </div>

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="pagination-controls__arrow"
        aria-label={t("catalogue.pagination.next")}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
