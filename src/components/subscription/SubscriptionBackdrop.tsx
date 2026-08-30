import { useMemo } from "react";

import type { GhostBoxGame } from "../../data";
import { useGamesQuery } from "../../queries/games";
import { useCachedImageSources, useLoadableImageState } from "../../hooks/useCachedImageSources";
import { gamePortraitPreviewSources } from "../../utils/image";
import { uniqueSources } from "../../utils/imageCache";

const RAIL_COUNT = 6;
// As capas dividem a largura do trilho por flex, então este número controla o
// tamanho de cada capa — não a cobertura. A cobertura é garantida no CSS.
const TILES_PER_RAIL = 12;
const TILES_NEEDED = RAIL_COUNT * TILES_PER_RAIL;
// Folga sobre o necessário: parte do catálogo não tem nota nem capa utilizável,
// e é o excedente que evita cair na repetição.
const CATALOGUE_FETCH_LIMIT = 240;

/**
 * Capa individual. Vive em componente próprio porque a resolução de arte da
 * Steam é feita por hooks (manifesto + fallback de CDN) e hook não roda em loop.
 */
function BackdropTile({ game }: { game: GhostBoxGame }) {
  const rawSources = useMemo(() => {
    const proxyPortrait = game.coverUrl?.replace(
      /\/header\.jpg(?:[?#].*)?$/i,
      "/library_600x900.jpg",
    );

    return uniqueSources([
      ...gamePortraitPreviewSources(game),
      // O proxy do catálogo é a última tentativa estável: ele evita que um
      // bloqueio/limite do CDN da Steam deixe toda a textura invisível.
      proxyPortrait,
      game.coverUrl,
      ...(game.coverFallbacks ?? []),
    ]);
  }, [game]);
  const sources = useCachedImageSources(rawSources);
  const image = useLoadableImageState(sources);

  return (
    <div
      className={`subscription-backdrop__tile${image.loaded ? " is-loaded" : ""}`}
      style={image.source ? { backgroundImage: `url("${image.source}")` } : undefined}
      aria-hidden="true"
    />
  );
}

/**
 * Fundo da tela de assinatura: capas dos jogos mais bem avaliados do catálogo,
 * dispostas em trilhos estáticos e inclinados.
 *
 * A arte fica sob um scrim pesado de propósito: a paleta da interface continua
 * sendo a neutra do app, as capas entram só como textura e profundidade.
 */
export function SubscriptionBackdrop() {
  // O catálogo, não a biblioteca do usuário: uma biblioteca pequena não tinha
  // capas suficientes para os trilhos e o preenchimento caía em repetição.
  // O backend só ordena por "popular", então a nota é aplicada aqui.
  const catalogueQuery = useGamesQuery({
    limit: CATALOGUE_FETCH_LIMIT,
    sort: "popular",
  });

  const games = useMemo(() => {
    const pool = catalogueQuery.data?.games ?? [];

    const seen = new Set<string>();
    const unique: GhostBoxGame[] = [];
    for (const game of pool) {
      const key = game.appId || game.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(game);
    }

    // Metacritic quando existe; senão a nota interna normalizada para a mesma
    // faixa de 0-100, para os dois critérios serem comparáveis.
    // O catálogo público serializa notas ausentes como `0`, não como `null`.
    // Só valores positivos são notas reais; para os sem nota, preservamos a
    // ordem popular do endpoint para o backdrop continuar com capas deslogado.
    const score = (game: GhostBoxGame) => {
      const metacritic = game.metacriticScore;
      if (typeof metacritic === "number" && metacritic > 0) return metacritic;

      const rating = game.rating;
      if (typeof rating === "number" && rating > 0) return rating * 20;

      return 0;
    };

    return unique
      .map((game, index) => ({ game, index, score: score(game) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, TILES_NEEDED)
      .map(({ game }) => game);
  }, [catalogueQuery.data]);

  if (games.length === 0) return null;

  // Fatias sequenciais e disjuntas. A versão anterior indexava com `%`, então
  // uma lista menor que o total de capas dava a volta e o mesmo jogo reaparecia
  // em vários trilhos. Aqui, faltando jogos, nascem menos trilhos — nunca
  // repetição. As capas têm `flex: 1`, então um trilho curto continua cobrindo.
  const rails: GhostBoxGame[][] = [];
  for (let railIndex = 0; railIndex < RAIL_COUNT; railIndex += 1) {
    const start = railIndex * TILES_PER_RAIL;
    const slice = games.slice(start, start + TILES_PER_RAIL);
    if (slice.length === 0) break;
    rails.push(slice);
  }

  return (
    <div className="subscription-backdrop" aria-hidden="true">
      {/*
        O giro vive aqui dentro, nunca no elemento que corta. Se o mesmo nó
        tivesse `overflow: hidden` e `rotate`, a caixa de corte giraria junto e
        apareceriam as quinas diagonais do próprio recorte.
      */}
      <div className="subscription-backdrop__stage">
        {rails.map((rail, railIndex) => (
          <div
            key={railIndex}
            className={`subscription-backdrop__rail subscription-backdrop__rail--${(railIndex % 3) + 1}`}
          >
            {/* Duplicado para o loop do marquee fechar sem salto. */}
            {[0, 1].map((copy) => (
              <div className="subscription-backdrop__run" key={copy}>
                {rail.map((game, index) => (
                  <BackdropTile key={`${game.appId || game.id}-${index}`} game={game} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="subscription-backdrop__scrim" />
    </div>
  );
}
