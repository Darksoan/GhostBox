import { useEffect, useRef, useState } from "react";
import {
  withCachedImageSources,
  resolveCachedImageSource,
  imageSourceCache,
  loadedImageSources,
  isPredictableSteamAssetSource,
  markGameCoverAvailable,
  markGameCoverFailed,
  resolveSteamHeaderSource,
  resolveSteamLibraryCoverSource,
  steamAppIdFromImageSource,
  type GameCoverKind,
} from "../utils/imageCache";
import {
  isHeaderImageSource,
  isHeroImageSource,
  isLandscapeImageSource,
} from "../utils/image";

export interface LoadableImageState {
  source: string;
  loaded: boolean;
  failed: boolean;
}

function inferCoverKind(sources: string[]): GameCoverKind | null {
  if (sources.some((source) => isHeaderImageSource(source) || isLandscapeImageSource(source))) {
    return "header";
  }
  if (
    sources.some(
      (source) =>
        /library_(?:600x900|capsule)/i.test(source) ||
        /hero_capsule/i.test(source),
    )
  ) {
    return "portrait";
  }
  return null;
}

function inferCoverAppId(sources: string[]) {
  for (const source of sources) {
    const appId = steamAppIdFromImageSource(source);
    if (appId) return appId;
  }
  return "";
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

export type LoadableImageOptions = {
  appId?: string;
  kind?: GameCoverKind;
  /** Force failure after this many ms so lists can hide broken covers. */
  failTimeoutMs?: number;
};

export function useLoadableImageState(
  sources: string[],
  options: LoadableImageOptions = {},
): LoadableImageState {
  const sourceKey = sources.join("\n");
  // The last source we successfully painted. Kept across source-array identity
  // changes (e.g. when the cache resolution reorders the array) so the cover
  // never resets to the raw URL and flickers while a new source resolves.
  const lastGoodSourceRef = useRef<string>("");
  const coverKind = options.kind ?? inferCoverKind(sources);
  const coverAppId = options.appId || inferCoverAppId(sources);
  const failTimeoutMs = options.failTimeoutMs ?? 0;

  const [state, setState] = useState<LoadableImageState>(() => {
    const readySource = findReadySource(sources);
    if (readySource) {
      lastGoodSourceRef.current = readySource;
      return { source: readySource, loaded: true, failed: false };
    }
    return { source: sources[0] ?? "", loaded: false, failed: false };
  });

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let failTimer: ReturnType<typeof setTimeout> | null = null;

    const firstSource = sources[0] ?? "";

    // Empty source list means "not loading yet" (e.g. lazy GameCard), not a failure.
    if (!firstSource) {
      lastGoodSourceRef.current = "";
      setState({ source: "", loaded: false, failed: false });
      return;
    }

    const fail = () => {
      if (cancelled || resolved) return;
      resolved = true;
      if (failTimer !== null) {
        clearTimeout(failTimer);
        failTimer = null;
      }
      lastGoodSourceRef.current = "";
      // Only mark app covers failed when we actually attempted a full cascade.
      if (coverAppId && coverKind && sources.length > 0) {
        markGameCoverFailed(coverAppId, coverKind);
      }
      setState({ source: "", loaded: false, failed: true });
    };

    const commit = (source: string) => {
      if (cancelled) return;
      if (resolved) return;

      resolved = true;
      if (failTimer !== null) {
        clearTimeout(failTimer);
        failTimer = null;
      }
      loadedImageSources.add(source);
      lastGoodSourceRef.current = source;
      if (coverAppId && coverKind) {
        markGameCoverAvailable(coverAppId, coverKind);
      }
      setState({ source, loaded: true, failed: false });
    };

    if (failTimeoutMs > 0) {
      failTimer = setTimeout(() => {
        fail();
      }, failTimeoutMs);
    }

    // Synchronous shortcut: a source from this set already decoded before, so
    // paint it immediately (no reset, no extra Image() round-trip).
    const readySource = findReadySource(sources);
    if (readySource) {
      commit(readySource);
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
        return { source: firstSource, loaded: true, failed: false };
      }

      lastGoodSourceRef.current = "";
      return { source: firstSource, loaded: false, failed: false };
    });

    const loadSource = (index: number) => {
      if (cancelled || resolved) return;
      if (index >= sources.length) {
        fail();
        return;
      }

      const source = sources[index];
      if (!source) {
        fail();
        return;
      }

      if (typeof Image === "undefined") {
        commit(source);
        return;
      }

      if (loadedImageSources.has(source)) {
        commit(source);
        return;
      }

      const tryNextSource = () => {
        if (!cancelled && !resolved) loadSource(index + 1);
      };

      const tryResolvedFallback = () => {
        const loadFallbackImage = (resolvedSource: string) => {
          if (cancelled || resolved || !resolvedSource || resolvedSource === source) {
            tryNextSource();
            return;
          }

          const fallbackImage = new Image();
          fallbackImage.decoding = "async";
          fallbackImage.referrerPolicy = "no-referrer";
          fallbackImage.onload = () => commit(resolvedSource);
          fallbackImage.onerror = tryNextSource;
          fallbackImage.src = resolvedSource;
        };

        const tryHashedSteamLibraryCover = () => {
          // library_hero / landscape art: never block on SteamCMD header resolve.
          // Just walk the next CDN candidate (fast). SteamCMD is for hashed
          // portrait library capsules only.
          if (isHeroImageSource(source) || isLandscapeImageSource(source)) {
            tryNextSource();
            return;
          }

          if (isHeaderImageSource(source)) {
            const appId = steamAppIdFromImageSource(source);
            if (!appId) {
              tryNextSource();
              return;
            }

            void resolveSteamHeaderSource(appId)
              .then(loadFallbackImage)
              .catch(tryNextSource);
            return;
          }

          const appId = steamAppIdFromImageSource(source);
          if (!appId) {
            tryNextSource();
            return;
          }

          void resolveSteamLibraryCoverSource(appId)
            .then(loadFallbackImage)
            .catch(tryNextSource);
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
      image.onload = () => commit(source);
      image.onerror = tryResolvedFallback;
      image.src = source;
    };

    loadSource(0);

    return () => {
      cancelled = true;
      if (failTimer !== null) {
        clearTimeout(failTimer);
      }
    };
  }, [sourceKey, coverAppId, coverKind, failTimeoutMs]);

  return state;
}

export function useLoadableImageSource(
  sources: string[],
  options: LoadableImageOptions = {},
) {
  return useLoadableImageState(sources, options).source;
}

export function useLoadableImageCover(
  sources: string[],
  options: LoadableImageOptions = {},
) {
  return useLoadableImageState(sources, options);
}
