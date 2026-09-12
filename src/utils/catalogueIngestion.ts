import type { GhostBoxGame } from "../data";
import { ingestRemoteGameByAppId } from "../data";

const completedAppIds = new Set<string>();
const pendingAppIds = new Set<string>();

type IngestionDependencies = {
  ingest?: (appId: string) => Promise<void>;
  invalidate: () => Promise<unknown> | void;
};

/**
 * Registra no catálogo jogos descobertos fora do D1. O modal nunca aguarda
 * esse trabalho; sucesso é lembrado durante a sessão e falha pode ser tentada
 * novamente na próxima abertura.
 */
export async function ingestCatalogueGameOnOpen(
  game: GhostBoxGame,
  dependencies: IngestionDependencies,
) {
  const appId = game.appId?.trim() ?? "";
  if (
    game.databaseAddedAt ||
    !/^\d{1,10}$/.test(appId) ||
    completedAppIds.has(appId) ||
    pendingAppIds.has(appId)
  ) {
    return false;
  }

  pendingAppIds.add(appId);
  try {
    await (dependencies.ingest ?? ingestRemoteGameByAppId)(appId);
    completedAppIds.add(appId);
    await dependencies.invalidate();
    return true;
  } finally {
    pendingAppIds.delete(appId);
  }
}

export function resetCatalogueIngestionSessionForTests() {
  completedAppIds.clear();
  pendingAppIds.clear();
}
