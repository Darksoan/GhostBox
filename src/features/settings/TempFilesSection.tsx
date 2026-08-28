import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { StorageCategoryId } from "../../lib/ghostboxApi.types";
import { formatStorageSize } from "../../utils/formatBytes";
import "./TempFilesSection.scss";

// Espelha PURE_CACHE_CATEGORIES em src-tauri/src/storage_audit.rs: são as
// únicas categorias que `clear_app_caches` apaga.
const TEMP_CATEGORY_IDS: StorageCategoryId[] = [
  "images",
  "catalogueCache",
  "steamcmd",
];

export function TempFilesSection() {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const [bytes, setBytes] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const loadUsage = useCallback(async () => {
    const usage = await ghostboxApi.storageUsage();
    setBytes(
      usage.categories
        .filter((category) => TEMP_CATEGORY_IDS.includes(category.id))
        .reduce((total, category) => total + category.bytes, 0),
    );
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const handleClear = useCallback(async () => {
    setIsClearing(true);
    try {
      const result = await ghostboxApi.clearAppCaches();
      showToast(
        result.failed.length > 0
          ? t("settings.tempFiles.errorTitle")
          : t("settings.tempFiles.successTitle"),
        t("settings.tempFiles.successMessage", {
          freed: formatStorageSize(result.freedBytes),
        }),
        result.failed.length > 0 ? "error" : "success",
      );
      await loadUsage();
    } finally {
      setIsClearing(false);
    }
  }, [loadUsage, showToast, t]);

  return (
    <section
      className="temp-files-section"
      aria-label={t("settings.tempFiles.title")}
    >
      <div className="temp-files-section__heading">
        <h3>{t("settings.tempFiles.title")}</h3>
        <p>
          {bytes === null
            ? t("settings.tempFiles.description")
            : t("settings.tempFiles.descriptionWithSize", {
                size: formatStorageSize(bytes),
              })}
        </p>
      </div>
      <button
        type="button"
        className="temp-files-section__button"
        onClick={() => void handleClear()}
        disabled={isClearing || bytes === 0}
      >
        {isClearing ? (
          <Loader2
            size={16}
            className="temp-files-section__spinner"
            aria-hidden="true"
          />
        ) : (
          <Trash2 size={16} aria-hidden="true" />
        )}
        {isClearing ? t("settings.tempFiles.clearing") : t("settings.tempFiles.clear")}
      </button>
    </section>
  );
}
