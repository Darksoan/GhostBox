type GameModalModule = typeof import("../components/modals/GameModal");

let gameModalModulePromise: Promise<GameModalModule> | null = null;

export function loadGameModalModule() {
  if (!gameModalModulePromise) {
    gameModalModulePromise = import("../components/modals/GameModal").catch(
      (error) => {
        gameModalModulePromise = null;
        throw error;
      },
    );
  }

  return gameModalModulePromise;
}

export function preloadGameModalModule() {
  void loadGameModalModule().catch(() => undefined);
}
