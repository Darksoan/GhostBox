import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, totalPages, onPageChange }: PaginationControlsProps) {
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
    <div className="pagination-controls">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="pagination-controls__arrow"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="pagination-controls__numbers">
        {pages.map((p, i) => (
          <button
            key={`${p}-${i}`}
            type="button"
            className={`pagination-controls__page ${p === page ? "pagination-controls__page--active" : ""} ${typeof p !== "number" ? "pagination-controls__page--ellipsis" : ""}`}
            disabled={typeof p !== "number"}
            onClick={() => typeof p === "number" && onPageChange(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="pagination-controls__arrow"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
