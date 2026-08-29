import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrato do pipeline de carregamento da home: as mudanças abaixo são o que
 * tira os cards do skeleton mais rápido. Quebrar qualquer uma delas traz de
 * volta os atrasos — fila de enriquecimento competindo por slot com buscas
 * que a página nem exibe, e rede bloqueando na frente de cache em disco.
 */
describe("Home loading pipeline", () => {
  const enrichmentHook = readFileSync(
    "src/hooks/useEnrichedGameCards.ts",
    "utf8"
  );
  const shelvesHook = readFileSync("src/hooks/useHomeShelves.ts", "utf8");
  const homePage = readFileSync("src/pages/HomePage.tsx", "utf8");
  const catalogueCache = readFileSync(
    "src-tauri/src/catalogue_cache.rs",
    "utf8"
  );

  it("makes achievement enrichment opt-out", () => {
    expect(enrichmentHook).toContain("includeAchievements = true");
    expect(enrichmentHook).toContain("if (!includeAchievements) return;");
  });

  it("skips achievement fetches on every home rail and the personal calendar", () => {
    // Nenhum card da home renderiza progresso de conquista, então cada busca
    // de conquista é um slot da fila (concorrência 6) gasto para nada. As
    // quatro shelves e o calendário pedem enriquecimento com o quarto
    // argumento em `false`.
    const shelfCall = (shelf: string) =>
      new RegExp(
        `useEnrichedGameCards\\(\\s*selection\\.${shelf},\\s*shelfSizes\\.${shelf},\\s*true,\\s*false\\s*\\)`
      );

    expect(shelfCall("recommended").test(shelvesHook)).toBe(true);
    expect(shelfCall("newReleases").test(shelvesHook)).toBe(true);
    expect(shelfCall("topSellers").test(shelvesHook)).toBe(true);
    expect(shelfCall("topRated").test(shelvesHook)).toBe(true);

    expect(
      /useEnrichedGameCards\(\s*personalCalendarGames,\s*homePersonalCalendarEnrichmentLimit,\s*true,\s*false\s*\)/.test(
        homePage
      )
    ).toBe(true);
  });

  it("serves stale catalogue cache entries immediately and refreshes in background", () => {
    // A janela fresh é de 30 minutos; sem stale-while-revalidate, todo boot
    // depois disso bloqueava featured e cada card na rede antes de responder.
    // Dentro da janela stale (7 dias) o disco responde na hora e o refresh
    // acontece em background, deduplicado por chave.
    expect(catalogueCache).toContain("fn spawn_background_cache_refresh");
    expect(catalogueCache).toContain("spawn_background_cache_refresh(app, url, cache_key)");
    expect(catalogueCache).toContain("BACKGROUND_REFRESH_IN_FLIGHT");

    const fetchFnStart = catalogueCache.indexOf(
      "pub async fn fetch_json_with_cache"
    );
    const fetchFnEnd = catalogueCache.indexOf(
      "fn inject_updated_at",
      fetchFnStart
    );
    const fetchFn = catalogueCache.slice(fetchFnStart, fetchFnEnd);
    // O caminho rápido aceita entrada dentro da janela stale, não só da fresh.
    expect(fetchFn).toContain("is_fresh(&entry)");
    expect(fetchFn).toContain("is_usable_stale(&entry)");

    // O refresh em background é silencioso: emitir o evento de cache atualizado
    // card a card faria o frontend invalidar ["games"] e ["home"] inteiros em
    // cascata. A cópia nova vale na próxima leitura.
    const refreshFnStart = catalogueCache.indexOf(
      "fn spawn_background_cache_refresh"
    );
    const refreshFn = catalogueCache.slice(
      refreshFnStart,
      catalogueCache.indexOf("pub async fn fetch_json_with_cache")
    );
    expect(refreshFn).not.toContain("CATALOGUE_CACHE_UPDATED_EVENT");
  });

  it("starts the personal calendar pool before the wishlist answers", () => {
    // A wishlist só alimenta exclusões do planejamento e o pool tem folga
    // grande; serializar as duas viagens de rede atrasava a seção inteira.
    expect(homePage).toContain("wishlistPromise");
    expect(
      /loadHomePersonalCalendarPool\(\s*new Set\(libraryGameAppIds\)\s*\)/.test(
        homePage
      )
    ).toBe(true);
  });
});
