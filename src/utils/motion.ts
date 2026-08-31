/**
 * Movimento desligado quando o usuário pediu (toggle de aparências vira a
 * classe `no-animations` em `documentElement`, ver `context/settings`) ou
 * quando o sistema pede (prefers-reduced-motion). Componentes que orquestram
 * animação em JS precisam da mesma resposta que o CSS — sem isso o JS agenda
 * uma troca esperando um fade que o CSS não vai mais fazer.
 */
export function isMotionDisabled(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.classList.contains("no-animations")) return true;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
}
