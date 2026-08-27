import { pendingScrollIdle } from "./scrollIdle";

/**
 * Limita quantas tarefas assíncronas correm ao mesmo tempo.
 *
 * O ganho não é só suavizar o pico: a tarefa só é criada quando chega a vez
 * dela, então quem desiste antes disso (troca de página, lista re-renderizada)
 * nunca chega a tocar a rede. Disparar tudo de uma vez torna esse cancelamento
 * impossível — a requisição já saiu.
 */
export function createRequestQueue(
  concurrency: number,
  /**
   * Portão opcional de despacho. Retorna `null` quando pode despachar agora, ou
   * uma promise para segurar a fila inteira até ela resolver. Nenhum slot é
   * ocupado durante a espera — a fila só fica parada.
   */
  waitUntilReady?: () => Promise<void> | null,
  /**
   * Tempo máximo por tarefa antes de liberar o slot à força. Sem isso, uma
   * tarefa que nunca resolve (request pendurada) prende um slot para sempre —
   * com concorrência baixa, poucas tarefas travadas já entopem a fila inteira.
   * A tarefa original continua rodando em segundo plano; só o slot é liberado.
   */
  timeoutMs?: number
) {
  let active = 0;
  let deferred = false;
  const waiting: Array<() => void> = [];

  const pump = () => {
    if (active >= concurrency || waiting.length === 0) return;

    const ready = waitUntilReady?.();
    if (ready) {
      // Um só re-agendamento por espera: `pump` é chamado uma vez por tarefa
      // enfileirada e sem isso cada uma somaria um observador.
      if (deferred) return;
      deferred = true;
      void ready.then(() => {
        deferred = false;
        pump();
      });
      return;
    }

    while (active < concurrency && waiting.length > 0) {
      const start = waiting.shift();
      if (!start) return;
      active += 1;
      start();
    }
  };

  return {
    enqueue<T>(run: () => Promise<T> | T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          let settled: Promise<T>;
          try {
            settled = Promise.resolve(run());
          } catch (error) {
            settled = Promise.reject(error);
          }

          let freed = false;
          const free = () => {
            if (freed) return;
            freed = true;
            active -= 1;
            pump();
          };

          let timer: ReturnType<typeof setTimeout> | undefined;
          if (timeoutMs) {
            timer = setTimeout(() => {
              free();
              reject(new Error("Request queue task timed out"));
            }, timeoutMs);
          }

          settled.then(
            (value) => {
              if (freed) return;
              clearTimeout(timer);
              free();
              resolve(value);
            },
            (error) => {
              if (freed) return;
              clearTimeout(timer);
              free();
              reject(error);
            }
          );
        });
        pump();
      });
    },
  };
}

/**
 * Fila compartilhada do enriquecimento de cards. Uma só para todas as páginas:
 * duas listas montando ao mesmo tempo somam no mesmo teto em vez de dobrarem a
 * carga no worker. Segura durante a rolagem, quando os cards visíveis ainda
 * estão mudando e buscar detalhes deles seria desperdício.
 */
const GAME_CARD_ENRICHMENT_TIMEOUT_MS = 15_000;

export const gameCardEnrichmentQueue = createRequestQueue(
  6,
  pendingScrollIdle,
  GAME_CARD_ENRICHMENT_TIMEOUT_MS
);
