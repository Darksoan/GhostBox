import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type {
  ClearResult,
  StorageCategoryId,
  StorageUsageCategory,
  StorageUsage,
} from "../../lib/ghostboxApi.types";
import { formatStorageSize } from "../../utils/formatBytes";
import "./StorageSection.scss";

function categoryLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  id: StorageCategoryId,
): string {
  return t(`settings.storage.categories.${id}`);
}

export function StorageSection() {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearingCaches, setIsClearingCaches] = useState(false);
  const [clearingId, setClearingId] = useState<StorageCategoryId | null>(null);

  const loadUsage = useCallback(async (withSpinner: boolean) => {
    if (withSpinner) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      setUsage(await ghostboxApi.storageUsage());
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage(false);
  }, [loadUsage]);

  const reportClearResult = useCallback(
    (result: ClearResult) => {
      if (result.failed.length > 0) {
        const failedLabels = result.failed
          .map((failure) => categoryLabel(t, failure.id as StorageCategoryId))
          .join(", ");
        showToast(
          t("settings.storage.clearErrorTitle"),
          t("settings.storage.clearPartialMessage", {
            freed: formatStorageSize(result.freedBytes),
            failed: failedLabels,
          }),
          "error",
        );
        return;
      }

      showToast(
        t("settings.storage.clearSuccessTitle"),
        t("settings.storage.clearSuccessMessage", {
          freed: formatStorageSize(result.freedBytes),
        }),
        "success",
      );
    },
    [showToast, t],
  );

  const handleClearCaches = useCallback(async () => {
    setIsClearingCaches(true);
    try {
      reportClearResult(await ghostboxApi.clearAppCaches());
      await loadUsage(true);
    } finally {
      setIsClearingCaches(false);
    }
  }, [loadUsage, reportClearResult]);

  const handleClearCategory = useCallback(
    async (id: StorageCategoryId) => {
      setClearingId(id);
      try {
        reportClearResult(await ghostboxApi.clearStorageCategory(id));
        await loadUsage(true);
      } finally {
        setClearingId(null);
      }
    },
    [loadUsage, reportClearResult],
  );

  const categories: StorageUsageCategory[] = usage?.categories ?? [];
  const isBusy = isClearingCaches || clearingId !== null;

  return (
    <section
      className="storage-section"
      aria-label={t("settings.storage.title")}
    >
      <header className="storage-section__header">
        <div className="storage-section__heading">
          <h3>{t("settings.storage.title")}</h3>
          <p>{t("settings.storage.description")}</p>
        </div>
        <div className="storage-section__actions">
          <button
            type="button"
            className="storage-section__button"
            onClick={() => void loadUsage(true)}
            disabled={isBusy || isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 size={14} className="storage-section__spinner" aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            {isRefreshing
              ? t("settings.storage.refreshing")
              : t("settings.storage.refresh")}
          </button>
          <button
            type="button"
            className="storage-section__button storage-section__button--primary"
            onClick={() => void handleClearCaches()}
            disabled={isBusy}
          >
            {isClearingCaches ? (
              <Loader2 size={14} className="storage-section__spinner" aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            {isClearingCaches
              ? t("settings.storage.clearing")
              : t("settings.storage.clearCaches")}
          </button>
        </div>
      </header>

      {isLoading ? (
        <Loader2
          size={18}
          className="storage-section__spinner storage-section__loading"
          aria-hidden="true"
        />
      ) : (
        <>
          <ul className="storage-section__list">
            {categories.map((category) => {
              const clearable = !(category.bytes === 0 && !category.present);
              const isClearing = clearingId === category.id;

              return (
                <li key={category.id} className="storage-section__row">
                  <span className="storage-section__label">
                    {categoryLabel(t, category.id)}
                  </span>
                  <span className="storage-section__size">
                    {formatStorageSize(category.bytes)}
                  </span>
                  <button
                    type="button"
                    className="storage-section__clear"
                    title={
                      clearable
                        ? undefined
                        : t("settings.storage.clearCategoryDescription")
                    }
                    disabled={!clearable || isBusy}
                    onClick={() => void handleClearCategory(category.id)}
                  >
                    {isClearing ? (
                      <Loader2 size={13} className="storage-section__spinner" aria-hidden="true" />
                    ) : null}
                    {t("settings.storage.clearCategory")}
                  </button>
                </li>
              );
            })}
          </ul>
          <footer className="storage-section__total">
            <span>{t("settings.storage.totalLabel")}</span>
            <span className="storage-section__total-value">
              {formatStorageSize(usage?.totalBytes ?? 0)}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
