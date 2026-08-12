import { useEffect, useMemo, useRef, useState } from "react";

import type { GhostBoxGame } from "../../data";
import { useGamesQuery } from "../../queries/games";
import { useCachedImageSources, useLoadableImageState } from "../../hooks/useCachedImageSources";
import { gamePortraitPreviewSources } from "../../utils/image";

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
  const rawSources = useMemo(() => gamePortraitPreviewSources(game), [game]);
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
 * deslizando em trilhos de velocidades diferentes.
 *
 * A arte fica sob um scrim pesado de propósito: a paleta da interface continua
 * sendo a neutra do app, as capas entram só como textura e profundidade.
 */
export function SubscriptionBackdrop() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

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
    const score = (game: GhostBoxGame) =>
      game.metacriticScore ?? (game.rating > 0 ? game.rating * 20 : 0);

    return unique
      .filter((game) => score(game) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, TILES_NEEDED);
  }, [catalogueQuery.data]);

  // Alvo (para onde o ponteiro aponta) e valor atual (o que está desenhado) são
  // separados. Escrever o alvo direto no CSS fazia os trilhos saltarem: o
  // primeiro movimento do mouse já chega com o cursor longe do centro, então o
  // valor pulava de 0 para o destino em um único frame. Aqui o atual persegue o
  // alvo por interpolação, quadro a quadro, e a entrada do cursor vira
  // deslizamento em vez de teleporte.
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) return;

    // Fração da distância vencida por quadro, e limiar para considerar chegada.
    const EASING = 0.075;
    const EPSILON = 0.0004;

    const step = () => {
      const node = rootRef.current;
      const target = targetRef.current;
      const current = currentRef.current;
      const deltaX = target.x - current.x;
      const deltaY = target.y - current.y;
      const arrived =
        Math.abs(deltaX) < EPSILON && Math.abs(deltaY) < EPSILON;

      current.x = arrived ? target.x : current.x + deltaX * EASING;
      current.y = arrived ? target.y : current.y + deltaY * EASING;

      if (node) {
        node.style.setProperty("--parallax-x", current.x.toFixed(4));
        node.style.setProperty("--parallax-y", current.y.toFixed(4));
      }

      // Para o laço ao alcançar o alvo; o próximo movimento o reinicia.
      frameRef.current = arrived ? null : requestAnimationFrame(step);
    };

    const onPointerMove = (event: PointerEvent) => {
      // -1..1 a partir do centro da janela; cada trilho multiplica por um fator
      // diferente no CSS para criar profundidade.
      targetRef.current = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: (event.clientY / window.innerHeight) * 2 - 1,
      };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [reducedMotion]);

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
    <div
      ref={rootRef}
      className={`subscription-backdrop${reducedMotion ? " subscription-backdrop--still" : ""}`}
      aria-hidden="true"
    >
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
