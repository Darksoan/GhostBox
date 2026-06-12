import { useEffect, useRef, useState } from "react";
import {
  withCachedImageSources,
  resolveCachedImageSource,
  imageSourceCache,
  loadedImageSources,
  isPredictableSteamAssetSource,
  resolveSteamLibraryCoverSource,
  steamAppIdFromImageSource,
} from "../utils/imageCache";

export interface LoadableImageState {
  source: string;
  loaded: boolean;
}

// Returns a source we already know decoded successfully (this session), so it
// can be painted synchronously without resetting to the raw URL and flickering.
function findReadySource(sources: string[]): string | null {
  for (const source of sources) {
    if (loadedImageSources.has(source)) return source;
    const cachedSource = imageSourceCache.get(source);
    if (cachedSource && loadedImageSources.has(cachedSource)) {
      return cachedSource;
    }
  }
  return null;
}

export function useCachedImageSources(sources: string[]) {
  const currentKey = sources.join("\n");
  const sourceKeyRef = useRef<string>(currentKey);

  const [cachedSources, setCachedSources] = useState(() =>
    withCachedImageSources(sources)
  );

  const updateCachedSources = () => {
    const nextSources = withCachedImageSources(sources);
    setCachedSources((currentSources) =>
      currentSources.join("\n") === nextSources.join("\n")
        ? currentSources
        : nextSources
    );
  };

  useEffect(() => {
    let cancelled = false;
    const hasSourceChanged = sourceKeyRef.current !== currentKey;

    if (hasSourceChanged) {
      sourceKeyRef.current = currentKey;
      updateCachedSources();
    }

    const unresolvedSources = sources.filter(
      (source) =>
        !imageSourceCache.has(source) &&
        !loadedImageSources.has(source) &&
        !isPredictableSteamAssetSource(source)
    );

    if (!unresolvedSources.length) {
      updateCachedSources();
      return;
    }

    Promise.all(
      unresolvedSources.map((source) => resolveCachedImageSource(source))
    ).then(() => {
      if (!cancelled) updateCachedSources();
    });

    return () => {
      cancelled = true;
    };
  }, [currentKey]);

  return cachedSources;
}

export function useLoadableImageState(sources: string[]): LoadableImageState {
  const sourceKey = sources.join("\n");
  // The last source we successfully painted. Kept across source-array identity
  // changes (e.g. when the cache resolution reorders the array) so the cover
  // never resets to the raw URL and flickers while a new source resolves.
  const lastGoodSourceRef = useRef<string>("");

  const [state, setState] = useState<LoadableImageState>(() => {
    const readySource = findReadySource(sources);
    if (readySource) {
      lastGoodSourceRef.current = readySource;
      return { source: readySource, loaded: true };
    }
    return { source: sources[0] ?? "", loaded: false };
  });

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    // Priority index is derived from the `sources` array ordering (0 = highest
    // priority). We track it so that if we temporarily commit a lower
    // priority "fallback", we can attempt an upgrade back to preferred
    // sources without requiring an app restart.
    let fallbackRetryAttemptsLeft = 2;
    let upgradeDone = false;
    let upgradeScheduled = false;

    const firstSource = sources[0] ?? "";

    if (!firstSource) {
      lastGoodSourceRef.current = "";
      setState({ source: "", loaded: false });
      return;
    }

    const getPriorityIndex = (source: string) => sources.indexOf(source);

    const commit = (source: string, options?: { upgrade?: boolean; priorityIndex?: number }) => {
      if (cancelled) return;
      // Only block commits after the initial resolution, unless this commit
      // is explicitly an "upgrade" (used to replace a fallback).
      if (!options?.upgrade && resolved) return;

      resolved = true;
      const priorityIndex = options?.priorityIndex ?? getPriorityIndex(source);

      loadedImageSources.add(source);
      lastGoodSourceRef.current = source;
      setState({ source, loaded: true });

      // If we committed a lower-priority source (a fallback), schedule a
      // best-effort upgrade attempt back to preferred sources.
      if (
        options?.upgrade !== true &&
        !upgradeDone &&
        !upgradeScheduled &&
        priorityIndex > 0 &&
        fallbackRetryAttemptsLeft > 0
      ) {
        upgradeScheduled = true;

        const preferredSources = sources.slice(0, priorityIndex);
        const scheduleUpgrade = () => {
          if (cancelled || upgradeDone) return;
          if (fallbackRetryAttemptsLeft <= 0) return;

          fallbackRetryAttemptsLeft -= 1;

          // Try the preferred sources in parallel; commit whichever loads first.
          let pending = preferredSources.length;
          preferredSources.forEach((preferredSource) => {
            if (cancelled) return;

            if (loadedImageSources.has(preferredSource)) {
              upgradeDone = true;
              commit(preferredSource, { upgrade: true });
              return;
            }

            const image = new Image();
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.onload = () => {
              if (cancelled || upgradeDone) return;
              upgradeDone = true;
              commit(preferredSource, { upgrade: true });
            };
            image.onerror = () => {
              pending -= 1;
              if (cancelled || upgradeDone) return;

              if (pending === 0) {
                if (fallbackRetryAttemptsLeft > 0) {
                  window.setTimeout(scheduleUpgrade, 2500);
                }
              }
            };
            image.src = preferredSource;
          });
        };

        window.setTimeout(scheduleUpgrade, 2500);
      }
    };

    // Synchronous shortcut: a source from this set already decoded before, so
    // paint it immediately (no reset, no extra Image() round-trip).
    const readySource = findReadySource(sources);
    if (readySource) {
      const readyPriorityIndex = sources.findIndex(
        (source) => source === readySource || imageSourceCache.get(source) === readySource
      );
      commit(readySource, {
        priorityIndex: readyPriorityIndex === -1 ? 0 : readyPriorityIndex,
      });
      return () => {
        cancelled = true;
      };
    }

    // Keep the previously painted cover while we resolve the new source. Only
    // fall back to the raw first source when we have nothing painted yet.
    setState((current) => {
      if (
        current.loaded &&
        lastGoodSourceRef.current &&
        sources.includes(lastGoodSourceRef.current)
      ) {
        return current;
      }

      if (loadedImageSources.has(firstSource)) {
        lastGoodSourceRef.current = firstSource;
        return { source: firstSource, loaded: true };
      }

      lastGoodSourceRef.current = "";
      return { source: firstSource, loaded: false };
    });

    const loadBatch = (startIndex: number) => {
      const batch = sources.slice(startIndex, startIndex + 4);
      if (!batch.length) return;

      if (typeof Image === "undefined") {
        commit(batch[0], { priorityIndex: getPriorityIndex(batch[0]) });
        return;
      }

      let failedCount = 0;

      batch.forEach((source) => {
        if (loadedImageSources.has(source)) {
          commit(source, { priorityIndex: getPriorityIndex(source) });
          return;
        }

        const markFailed = () => {
          failedCount += 1;
          if (!cancelled && !resolved && failedCount === batch.length) {
            loadBatch(startIndex + batch.length);
          }
        };

        const tryResolvedFallback = () => {
          const loadFallbackImage = (resolvedSource: string) => {
            if (
              cancelled ||
              resolved ||
              !resolvedSource ||
              resolvedSource === source
            ) {
              markFailed();
              return;
            }

            const fallbackImage = new Image();
            fallbackImage.decoding = "async";
            fallbackImage.referrerPolicy = "no-referrer";
            fallbackImage.onload = () =>
              commit(resolvedSource, { priorityIndex: getPriorityIndex(source) });
            fallbackImage.onerror = markFailed;
            fallbackImage.src = resolvedSource;
          };

          const tryHashedSteamLibraryCover = () => {
            const appId = steamAppIdFromImageSource(source);
            if (!appId) {
              markFailed();
              return;
            }

            void resolveSteamLibraryCoverSource(appId)
              .then(loadFallbackImage)
              .catch(markFailed);
          };

          void resolveCachedImageSource(source, { steamAssetFallback: true })
            .then((resolvedSource) => {
              if (!resolvedSource || resolvedSource === source) {
                tryHashedSteamLibraryCover();
                return;
              }

              loadFallbackImage(resolvedSource);
            })
            .catch(tryHashedSteamLibraryCover);
        };

        const image = new Image();
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.onload = () => commit(source, { priorityIndex: getPriorityIndex(source) });
        image.onerror = tryResolvedFallback;
        image.src = source;
      });
    };

    loadBatch(0);

    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  return state;
}

export function useLoadableImageSource(sources: string[]) {
  return useLoadableImageState(sources).source;
}

export function useLoadableImageCover(sources: string[]) {
  return useLoadableImageState(sources);
}
