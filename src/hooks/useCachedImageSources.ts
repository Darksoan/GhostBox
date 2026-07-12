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
import { isHeaderImageSource, isHeroImageSource } from "../utils/image";

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

    const firstSource = sources[0] ?? "";

    if (!firstSource) {
      lastGoodSourceRef.current = "";
      setState({ source: "", loaded: false });
      return;
    }

    const commit = (source: string) => {
      if (cancelled) return;
      if (resolved) return;

      resolved = true;
      loadedImageSources.add(source);
      lastGoodSourceRef.current = source;
      setState({ source, loaded: true });
    };

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
        return { source: firstSource, loaded: true };
      }

      lastGoodSourceRef.current = "";
      return { source: firstSource, loaded: false };
    });

    const loadSource = (index: number) => {
      const source = sources[index];
      if (!source || cancelled || resolved) return;

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
          // Library capsule is portrait-only. Never substitute it for failed
          // header/hero loads — that swaps a correct landscape art for a
          // vertical cover after first paint.
          if (isHeaderImageSource(source) || isHeroImageSource(source)) {
            tryNextSource();
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
