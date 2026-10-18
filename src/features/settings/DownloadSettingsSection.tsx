import { useEffect, useId, useState } from "react";
import { CircleAlert, HardDrive } from "lucide-react";
import { useSettings } from "../../context/settings";
import { useDownloadsDirectory } from "../../hooks/useDownloadsDirectory";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { DownloadDestination } from "../../lib/ghostboxApi.types";
import { writeStoredDownloadsDir } from "../../lib/downloadManager";
import { formatGigabytes } from "../../utils/formatBytes";
import { registeredDownloadLibraries, selectedDownloadDestination } from "../../utils/downloadStorage";
import "./DownloadSettingsSection.scss";

export function DownloadSettingsSection({ steamPath }: { steamPath: string }) {
  const { appearance, t } = useSettings();
  const directory = useDownloadsDirectory();
  const id = useId();
  const [destinations, setDestinations] = useState<DownloadDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    void ghostboxApi.listDownloadDestinations(steamPath || undefined)
      .then((result) => { if (!disposed) setDestinations(registeredDownloadLibraries(result)); })
      .catch((reason) => { if (!disposed) setError(String(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [steamPath, revision]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const libraries = registeredDownloadLibraries(destinations);
  const selected = selectedDownloadDestination(directory, libraries);

  return (
    <section className="settings-options download-library-settings" aria-labelledby={`${id}-title`}>
      <div className="download-library-settings__heading">
        <h3 id={`${id}-title`}>{t("downloads.destinationTitle")}</h3>
        <p id={`${id}-hint`}>{t("downloads.libraryDestinationHint")}</p>
      </div>
      <div className="download-library-settings__grid" role="radiogroup" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} aria-busy={loading}>
        {libraries.map((destination) => {
          const checked = selected?.path === destination.path;
          const name = destination.label || t(`downloads.${destination.kind === "network" ? "networkDisk" : destination.kind === "removable" ? "removableDisk" : "fixedDisk"}`);
          const label = destination.drive ? `${name} (${destination.drive})` : name;
          const capacity = !destination.available ? t("downloads.unavailable") : destination.totalBytes > 0
            ? t("downloads.freeSpaceOnly", { free: formatGigabytes(destination.freeBytes, appearance.language === "en" ? "en-US" : "pt-BR") }) : "—";
          const showPath = !destination.drive || libraries.filter((library) => library.drive.toLowerCase() === destination.drive.toLowerCase()).length > 1;
          return (
            <label className="download-library-settings__option" key={destination.path}>
              <input type="radio" name={`${id}-library`} value={destination.path} checked={checked}
                disabled={loading || !!error || !destination.available} aria-label={`${label} ${capacity} ${destination.path}`}
                onChange={(event) => {
                  if (event.target.checked && destination.isLibrary && destination.available && !loading && !error) writeStoredDownloadsDir(destination.path);
                }} />
              <span className="download-library-settings__option-body">
                {destination.available ? <HardDrive aria-hidden="true" /> : <CircleAlert className="download-library-settings__warning" aria-hidden="true" />}
                <span className="download-library-settings__name"><strong>{label}</strong>{showPath && <span>{destination.path}</span>}</span>
                <span className="download-library-settings__capacity">
                  <span>{capacity}</span>
                  <span className="download-library-settings__check" aria-hidden="true">
                    <svg viewBox="0 0 10.1668 10.1668" width={12} height={12}><path d="M1 5.52L3.92 9.17L9.17 1" /></svg>
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {loading && libraries.length === 0 && <p className="download-library-settings__message" role="status">{t("downloads.loadingDisks")}</p>}
      {!loading && !error && libraries.length === 0 && <p className="download-library-settings__message">{t("downloads.noRegisteredLibraries")}</p>}
      {error && <div className="download-library-settings__error" role="alert">
        <p>{t("downloads.diskError")} {error}</p>
        <button className="button button--outline" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>{t("downloads.retry")}</button>
      </div>}
    </section>
  );
}
