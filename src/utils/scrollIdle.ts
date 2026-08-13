export const SCROLL_IDLE_DELAY_MS = 220;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let scrolling = false;
let attached = false;
const waiters: Array<() => void> = [];
const idleListeners = new Set<() => void>();

function settle() {
  idleTimer = null;
  scrolling = false;
  const pending = waiters.splice(0, waiters.length);
  for (const resolve of pending) resolve();
  for (const listener of idleListeners) listener();
}

function handleScroll() {
  scrolling = true;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(settle, SCROLL_IDLE_DELAY_MS);
}

function ensureListening() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  // `capture` porque scroll não borbulha: sem isso só o scroll da própria
  // janela seria visto, e as listas do app rolam dentro de containers.
  window.addEventListener("scroll", handleScroll, {
    passive: true,
    capture: true,
  });
}

/**
 * Retorna `null` quando a rolagem está parada e uma promise quando não está.
 *
 * Serve de portão para trabalho especulativo: enquanto o usuário rola, os jogos
 * sob o ponteiro mudam a cada quadro e buscar detalhes deles é jogar requisição
 * fora. O `null` evita alocar uma promise resolvida no caminho comum.
 */
export function pendingScrollIdle(): Promise<void> | null {
  ensureListening();
  if (!scrolling) return null;
  return new Promise<void>((resolve) => waiters.push(resolve));
}

export function isScrolling() {
  ensureListening();
  return scrolling;
}

/**
 * Avisa quando a rolagem para. Serve para quem mede posição na viewport: medir
 * a cada quadro de rolagem faria o elemento medido mudar de tamanho durante a
 * rolagem, que é pior que a medida ficar um instante desatualizada.
 */
export function subscribeScrollIdle(listener: () => void): () => void {
  ensureListening();
  idleListeners.add(listener);
  return () => {
    idleListeners.delete(listener);
  };
}
