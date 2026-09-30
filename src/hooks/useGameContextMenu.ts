import { useCallback, useEffect, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import { useAppData } from "../context/AppDataContext";
import { useOverlay } from "../context/OverlayContext";
import { useSettings } from "../context/settings";
import { ghostboxApi } from "../lib/ghostboxApi";
import {
  useCollectionContextMenu,
  type UseCollectionContextMenuOptions,
} from "./useCollectionContextMenu";

type GameContextMenuOptions = Pick<
  UseCollectionContextMenuOptions,
  | "game"
  | "onOpenGame"
  | "includeFavorites"
  | "directFavoriteAction"
  | "onlyCollectionActions"
  | "excludeCollectionId"
>;

export function useGameContextMenu(options: GameContextMenuOptions) {
  const {
    favoriteGameIds,
    availableLibraryGameAppIds,
    addedLibraryGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    hiddenProfileGameIds,
    setProfileGameHidden,
    profileHistoryGames,
    steamAccountStats,
    queueGame,
    handlePlayGame,
    requestRemoveGame,
    toggleFavoriteGame,
    addGameToUserCollection,
    removeGameFromCollection,
  } = useAppData();
  const { openAchievements, showToast } = useOverlay();
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";

  const appId = options.game?.appId || options.game?.id.replace(/^steam-/, "") || "";
  const isLibraryGame = availableLibraryGameAppIds.has(appId) || addedLibraryGameAppIds.has(appId);
  const isProfileHidden = Boolean(appId && hiddenProfileGameIds.has(appId));

  // Espelha o universo ocultável das Configurações (perfil): biblioteca,
  // favoritos e histórico entram pelo `hasGameKey` do hook de coleção; aqui
  // somamos o que ele não vê — histórico do perfil e owned da Steam. Jogo de
  // catálogo não possuído fica fora e não recebe "Ocultar no perfil".
  const hideableGameAppIds = useMemo(() => {
    const keys = new Set<string>();
    for (const historyGame of profileHistoryGames) {
      const id = historyGame.id?.trim();
      const historyAppId = historyGame.appId?.trim();
      if (id) keys.add(id);
      if (historyAppId) {
        keys.add(historyAppId);
        if (/^\d+$/.test(historyAppId)) keys.add(`steam-${historyAppId}`);
      }
      const steamId = id?.match(/^steam-(\d+)$/i)?.[1];
      if (steamId) keys.add(steamId);
    }
    for (const playtime of steamAccountStats?.ownedPlaytimes ?? []) {
      const ownedAppId = playtime.appId?.trim();
      if (!ownedAppId) continue;
      keys.add(ownedAppId);
      keys.add(`steam-${ownedAppId}`);
    }
    return keys;
  }, [profileHistoryGames, steamAccountStats?.ownedPlaytimes]);
  const [steamInstallCheck, setSteamInstallCheck] = useState<{
    appId: string;
    installed: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSteamInstallCheck(null);
    if (!appId || !isLibraryGame || options.onlyCollectionActions) return;

    void ghostboxApi.isSteamGameInstalled(appId)
      .then((installed) => {
        if (!cancelled) setSteamInstallCheck({ appId, installed });
      })
      .catch(() => {
        if (!cancelled) setSteamInstallCheck({ appId, installed: false });
      });

    return () => {
      cancelled = true;
    };
  }, [appId, isLibraryGame, options.onlyCollectionActions]);

  const handleToggleHidden = useCallback(
    (game: GhostBoxGame) => {
      const targetAppId = game.appId.trim();
      if (!targetAppId) return;
      const hidden = hiddenProfileGameIds.has(targetAppId);
      setProfileGameHidden(targetAppId, !hidden);
      showToast(
        hidden
          ? isEnglish ? "Visible on profile" : "Visível no perfil"
          : isEnglish ? "Hidden from profile" : "Ocultado no perfil",
        hidden
          ? isEnglish
            ? `"${game.title}" will appear on your profile again.`
            : `"${game.title}" voltará a aparecer no seu perfil.`
          : isEnglish
            ? `"${game.title}" will no longer appear on your profile.`
            : `"${game.title}" não aparecerá mais no seu perfil.`,
        "success",
      );
    },
    [hiddenProfileGameIds, isEnglish, setProfileGameHidden, showToast],
  );

  const handleOpenInSteam = useCallback(
    (game: GhostBoxGame) => {
      const numericId = resolveSteamNumericId(game);
      if (!numericId) return;
      void ghostboxApi
        .openExternalUrl(`https://store.steampowered.com/app/${numericId}`)
        .catch((error: unknown) =>
          showToast(
            isEnglish ? "View in store" : "Ver na loja",
            error instanceof Error
              ? error.message
              : isEnglish
                ? "Could not open the store page."
                : "Não foi possível abrir a página da loja.",
            "error",
          ),
        );
    },
    [isEnglish, showToast],
  );

  return useCollectionContextMenu({
    ...options,
    favoriteGameIds,
    libraryGameAppIds: availableLibraryGameAppIds,
    removableGameAppIds: addedLibraryGameAppIds,
    steamInstallConfirmed: steamInstallCheck?.appId === appId && steamInstallCheck.installed,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    isProfileHidden,
    hideableGameAppIds,
    onAddGame: queueGame,
    onPlayGame: handlePlayGame,
    onOpenAchievements: openAchievements,
    onRemoveGame: requestRemoveGame,
    onToggleFavorite: toggleFavoriteGame,
    onToggleHidden: handleToggleHidden,
    onOpenInSteam: handleOpenInSteam,
    onAddGameToCollection: addGameToUserCollection,
    onRemoveGameFromCollection: removeGameFromCollection,
  });
}

function resolveSteamNumericId(game: GhostBoxGame): string {
  const raw = game.appId?.trim() || game.id.replace(/^steam-/i, "").trim();
  return /^\d+$/.test(raw) ? raw : "";
}
