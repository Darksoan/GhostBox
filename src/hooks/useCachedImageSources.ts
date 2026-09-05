import { useEffect, useRef, useState } from "react";
import {
  withCachedImageSources,
  resolveCachedImageSource,
  forgetCachedImageSource,
  getCachedImageSource,
  loadedImageSources,
  markImageSourceLoaded,
  isPredictableSteamAssetSource,
  isStandardSteamHeaderSource,
  resolveSteamHeaderSource,
  resolveSteamLibraryCoverSource,
  steamAppIdFromImageSource,
  steamAppIdsFromSources,
} from "../utils/imageCache";
import {
  isHeaderImageSource,
  isHeroImageSource,
  isLandscapeImageSource,
} from "../utils/image";
import { subscribeSteamAssetManifest } from "../utils/steamAssetManifest";

export interface LoadableImageState {
  source: string;
  loaded: boolean;
  failed: boolean;
}

// Returns a source we already know decoded successfully (this session), so it
// can be painted synchronously without resetting to the raw URL and flickering.
function findReadySource(sources: string[]): string | null {
  for (const source of sources) {
    if (loadedImageSources.has(source)) return source;
    const cachedSource = getCachedImageSource(source);
    if (cachedSource && loadedImageSources.has(cachedSource)) {
      return cachedSource;
    }
  }
  return null;
}

export function useCachedImageSources(
  sources: string[],
  {
    resolveUncached = true,
    preserveSourceOrder = false,
    cacheSteamHeaders = false,
    prioritizeCached = false,
  }: {
    resolveUncached?: boolean;
    preserveSourceOrder?: boolean;
    cacheSteamHeaders?: boolean;
    prioritizeCached?: boolean;
  } = {}
) {
  const currentKey = sources.join("\n");
  const sourceKeyRef = useRef<string>(currentKey);

  const [cachedSources, setCachedSources] = useState(() =>
    withCachedImageSources(sources, { preserveSourceOrder, prioritizeCached })
  );

  const updateCachedSources = () => {
    const nextSources = withCachedImageSources(sources, {
      preserveSourceOrder,
      prioritizeCached,
    });
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

    // O manifesto chega depois do primeiro paint; sem isso a URL com hash só
    // entraria na lista no próximo render por outro motivo.
    const unsubscribeManifest = subscribeSteamAssetManifest(() => {
      if (!cancelled) updateCachedSources();
    }, steamAppIdsFromSources(sources));

    const unresolvedIdentities = new Set<string>();
    const unresolvedSources = sources.filter((source) => {
      if (
        getCachedImageSource(source) ||
        loadedImageSources.has(source) ||
        (isPredictableSteamAssetSource(source) &&
          !(cacheSteamHeaders && isStandardSteamHeaderSource(source)))
      ) {
        return false;
      }

      const identity = isStandardSteamHeaderSource(source)
        ? `steam-header:${steamAppIdFromImageSource(source)}`
        : source;
      if (unresolvedIdentities.has(identity)) return false;
      unresolvedIdentities.add(identity);
      return true;
    });

    if (resolveUncached && unresolvedSources.length) {
      Promise.all(
        unresolvedSources.map((source) =>
          resolveCachedImageSource(source, {
            cachePredictable:
              cacheSteamHeaders && isStandardSteamHeaderSource(source),
          })
        )
      ).then(() => {
        if (!cancelled) updateCachedSources();
      });
    } else {
      updateCachedSources();
    }

    return () => {
      cancelled = true;
      unsubscribeManifest();
    };
  }, [
    currentKey,
    resolveUncached,
    preserveSourceOrder,
    cacheSteamHeaders,
    prioritizeCached,
  ]);

  return cachedSources;
}

type LoadableImageOptions = {
  /** Force failure after this many ms so lists can hide broken covers. */
  failTimeoutMs?: number;
  /**
   * Walk the list strictly in order, ignoring the "already decoded" shortcut.
   *
   * The shortcut paints whichever source decoded before, even when it sits at
   * the end of the list — great against flicker in lists, wrong for a hero that
   * ranks its sources by resolution, because a thumbnail loaded elsewhere wins
   * over the high-density art at the top.
   */
  preferOrder?: boolean;
  /** Paint the first working source immediately, then try preferred upgrades. */
  progressive?: boolean;
  /**
   * Muda de valor para refazer a cadeia de carregamento com as mesmas URLs
   * (voltou a ficar online, usuário pediu retry). Sem isso um erro de rede
   * pontual congela a imagem em `failed` até a lista de sources mudar.
   */
  retryToken?: number | string;
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
  const failTimeoutMs = options.failTimeoutMs ?? 0;
  const preferOrder = options.preferOrder === true;
  const progressive = options.progressive === true;
  const retryToken = options.retryToken ?? 0;

  const [state, setState] = useState<LoadableImageState>(() => {
    const readySource = preferOrder ? null : findReadySource(sources);
    if (readySource) {
      lastGoodSourceRef.current = readySource;
      return { source: readySource, loaded: true, failed: false };
    }
    return { source: sources[0] ?? "", loaded: false, failed: false };
  });

  useEffect(() => {
    let cancelled = false;
    let firstResolved = false;
    let finished = false;
    let failTimer: ReturnType<typeof setTimeout> | null = null;

    const firstSource = sources[0] ?? "";

    // Empty source list means "not loading yet" (e.g. lazy GameCard), not a failure.
    if (!firstSource) {
      lastGoodSourceRef.current = "";
      setState({ source: "", loaded: false, failed: false });
      return;
    }

    const fail = () => {
      if (cancelled || firstResolved || finished) return;
      finished = true;
      if (failTimer !== null) {
        clearTimeout(failTimer);
        failTimer = null;
      }
      lastGoodSourceRef.current = "";
      setState({ source: "", loaded: false, failed: true });
    };

    const finish = () => {
      finished = true;
      if (failTimer !== null) {
        clearTimeout(failTimer);
        failTimer = null;
      }
    };

    const commit = (source: string, index: number) => {
      if (cancelled || finished) return;

      if (!firstResolved) {
        firstResolved = true;
        if (!(progressive && index === 0)) finish();
      } else {
        finish();
      }
      markImageSourceLoaded(source);
      lastGoodSourceRef.current = source;
      setState({ source, loaded: true, failed: false });
    };

    if (failTimeoutMs > 0) {
      failTimer = setTimeout(() => {
        fail();
      }, failTimeoutMs);
    }

    // Synchronous shortcut: a source from this set already decoded before, so
    // paint it immediately (no reset, no extra Image() round-trip).
    const readySource = preferOrder ? null : findReadySource(sources);
    if (readySource && !progressive) {
      commit(readySource, sources.indexOf(readySource));
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
      if (cancelled || finished) return;
      if (index >= sources.length) {
        if (firstResolved) finish();
        else fail();
        return;
      }

      const source = sources[index];
      if (!source) {
        if (firstResolved) finish();
        else fail();
        return;
      }

      if (typeof Image === "undefined") {
        commit(source, index);
        if (progressive && index === 0 && !finished) loadSource(index + 1);
        return;
      }

      if (loadedImageSources.has(source)) {
        commit(source, index);
        if (progressive && index === 0 && !finished) loadSource(index + 1);
        return;
      }

      const tryNextSource = () => {
        // Um source que falhou não pode continuar no cache: se ele for o
        // arquivo em disco de outra URL, o mapa persistido devolveria o mesmo
        // caminho morto no próximo boot e a imagem nunca mais se recuperaria.
        forgetCachedImageSource(source);
        if (!cancelled && !finished) loadSource(index + 1);
      };

      const tryResolvedFallback = () => {
        const loadFallbackImage = (resolvedSource: string) => {
          if (cancelled || finished || !resolvedSource || resolvedSource === source) {
            tryNextSource();
            return;
          }

          const fallbackImage = new Image();
          fallbackImage.decoding = "async";
          fallbackImage.fetchPriority = progressive && index === 0 ? "high" : "low";
          fallbackImage.referrerPolicy = "no-referrer";
          fallbackImage.onload = () => {
            commit(resolvedSource, index);
            if (progressive && index === 0 && !finished) loadSource(index + 1);
          };
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
      image.fetchPriority = progressive && index === 0 ? "high" : "low";
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        commit(source, index);
        if (progressive && index === 0 && !finished) loadSource(index + 1);
      };
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
  }, [sourceKey, failTimeoutMs, preferOrder, progressive, retryToken]);

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
