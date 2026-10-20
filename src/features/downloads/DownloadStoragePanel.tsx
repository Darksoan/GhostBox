import { useQuery } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useSettings } from "../../context/settings";
import { useDownloadsDirectory } from "../../hooks/useDownloadsDirectory";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { selectedDownloadDestination, downloadStorageUsedPercent } from "../../utils/downloadStorage";
import { formatGigabytes } from "../../utils/formatBytes";

export function DownloadStoragePanel({ isActive }: { isActive: boolean }) {
  const { t, appearance } = useSettings();
  const directory = useDownloadsDirectory();
  const { data = [], isPending, isFetching, isError } = useQuery({
    queryKey: ["selected-download-storage", directory],
    queryFn: () => ghostboxApi.listDownloadDestinations(undefined, directory),
    enabled: isActive && !!directory.trim(),
    staleTime: 15_000,
    refetchInterval: isActive && directory.trim() ? 30_000 : false,
    retry: false,
  });
  const selected = selectedDownloadDestination(directory, data);
  const used = selected ? downloadStorageUsedPercent(selected) : null;
  const locale = appearance.language === "en" ? "en-US" : "pt-BR";

  return (
    <section className="downloads-panel downloads-storage" aria-label={t("downloads.storage")}>
      <div className="downloads-storage__header">
        <h3 className="downloads-panel__title"><HardDrive aria-hidden="true" />{t("downloads.storage")}</h3>
      </div>
      <div className="downloads-storage__body" aria-busy={isFetching}>
        {!directory ? <p>{t("downloads.noSelectedStorage")}</p>
          : isPending ? <p role="status">{t("downloads.loadingDisks")}</p>
          : isError ? <p role="alert">{t("downloads.diskError")}</p>
          : !selected ? <p>{t("downloads.unavailable")}</p>
          : <>
            <div className="downloads-storage__identity">
              <strong>{selected.label || t(`downloads.${selected.kind === "network" ? "networkDisk" : selected.kind === "removable" ? "removableDisk" : "fixedDisk"}`)}{selected.drive && ` (${selected.drive})`}</strong>
              <p className="downloads-storage__capacity">{!selected.available ? t("downloads.unavailable") : used === null ? "—"
                : t("downloads.availableSpace", { free: formatGigabytes(selected.freeBytes, locale), total: formatGigabytes(selected.totalBytes, locale) })}</p>
            </div>
            {used !== null && <div className="downloads-storage__meter" role="meter" aria-label={t("downloads.usedSpace")}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)}>
              <span style={{ width: `${used}%` }} />
            </div>}
          </>}
      </div>
    </section>
  );
}
