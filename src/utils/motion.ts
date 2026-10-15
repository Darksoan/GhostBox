/**
 * Movimento desligado apenas pelo toggle interno de aparências (classe
 * `no-animations` em `documentElement`, ver `context/settings`).
 * Deliberadamente NÃO lê `prefers-reduced-motion` do SO: quem desliga
 * efeitos no Windows (10/11) continua vendo as animações do app.
 * Componentes que orquestram animação em JS precisam da mesma resposta
 * que o CSS — sem isso o JS agenda uma troca esperando um fade que o
 * CSS não vai mais fazer.
 */
export function isMotionDisabled(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.classList.contains("no-animations");
}
