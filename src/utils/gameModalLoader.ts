type GameModalModule = typeof import("../components/modals/GameModal");

let gameModalModulePromise: Promise<GameModalModule> | null = null;
let loadedGameModalModule: GameModalModule | null = null;

export function loadGameModalModule() {
  if (loadedGameModalModule) return Promise.resolve(loadedGameModalModule);

  if (!gameModalModulePromise) {
    gameModalModulePromise = import("../components/modals/GameModal")
      .then((module) => {
        loadedGameModalModule = module;
        return module;
      })
      .catch((error) => {
        gameModalModulePromise = null;
        throw error;
      });
  }

  return gameModalModulePromise;
}

export function getLoadedGameModalModule() {
  return loadedGameModalModule;
}

export function preloadGameModalModule() {
  void loadGameModalModule().catch(() => undefined);
}
