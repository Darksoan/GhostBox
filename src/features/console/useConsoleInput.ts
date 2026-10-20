import { useEffect, useRef, useSyncExternalStore } from "react";

export type ConsoleDirection = "up" | "down" | "left" | "right";

export type ConsoleInputHandlers = {
  /** Camadas (visualizador, painel lateral): devolver false deixa a ação seguir para a camada de baixo. */
  /** ○ / Esc / Backspace. */
  onBack?: () => void | boolean;
  /** L1 / Q. */
  onPrevTab?: () => void | boolean;
  /** R1 / E. */
  onNextTab?: () => void | boolean;
  /** □ / F — recebe o elemento focado (cards marcam `data-console-game`). */
  onFavourite?: (focused: HTMLElement | null) => void | boolean;
  /** △ / Tab-less "detalhes" — recebe o elemento focado. */
  onDetails?: (focused: HTMLElement | null) => void | boolean;
};

const FOCUSABLE = "[data-console-focus]";

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && !element.closest("[aria-hidden='true'], [inert]");
}

function isTypingTarget(element: Element | null) {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

/**
 * Navegação espacial: dentre os focáveis visíveis do escopo, escolhe o mais próximo
 * na direção pedida. O eixo principal pesa 1 e o desalinhamento no eixo cruzado pesa 2,
 * então "direita" prefere o vizinho da mesma linha a um card mais perto na diagonal.
 */
export function moveConsoleFocus(scope: HTMLElement, direction: ConsoleDirection): boolean {
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
  if (candidates.length === 0) return false;
  const active = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)
    ? document.activeElement.closest<HTMLElement>(FOCUSABLE) ?? document.activeElement
    : null;
  if (!active) {
    focusConsoleElement(candidates[0]);
    return true;
  }

  const from = active.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === active) continue;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    let primary: number;
    let cross: number;
    switch (direction) {
      case "right": if (rect.left < from.right - 4) continue; primary = rect.left - from.right; cross = Math.abs(y - fromY); break;
      case "left": if (rect.right > from.left + 4) continue; primary = from.left - rect.right; cross = Math.abs(y - fromY); break;
      case "down": if (rect.top < from.bottom - 4) continue; primary = rect.top - from.bottom; cross = Math.abs(x - fromX); break;
      case "up": if (rect.bottom > from.top + 4) continue; primary = from.top - rect.bottom; cross = Math.abs(x - fromX); break;
    }
    const score = Math.max(0, primary) + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best) return false;
  focusConsoleElement(best);
  return true;
}

export function focusConsoleElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

/**
 * Modo de entrada. "controller" (controle ou teclado) desenha o foco, as dicas de botão e esconde o
 * cursor; "pointer" (mouse) tira o foco visível e deixa os efeitos para o hover. O app troca sozinho
 * conforme o que a pessoa usa, então quem não tem controle navega só com o mouse.
 */
export type ConsoleInputMode = "controller" | "pointer";

const modeListeners = new Set<() => void>();
let inputMode: ConsoleInputMode = hasConnectedGamepad() ? "controller" : "pointer";
// Onde o foco estava ao trocar para o mouse (ou onde uma tela pediu foco nesse meio-tempo):
// a primeira tecla ou botão do controle devolve o foco para lá em vez de recomeçar do topo.
let parkedFocus: HTMLElement | null = null;

function hasConnectedGamepad() {
  try {
    return typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
      && Array.from(navigator.getGamepads()).some((pad) => Boolean(pad?.connected));
  } catch {
    return false;
  }
}

function subscribeGamepadConnection(listener: () => void) {
  window.addEventListener("gamepadconnected", listener);
  window.addEventListener("gamepaddisconnected", listener);
  return () => {
    window.removeEventListener("gamepadconnected", listener);
    window.removeEventListener("gamepaddisconnected", listener);
  };
}

export function useConsoleGamepadConnected() {
  return useSyncExternalStore(subscribeGamepadConnection, hasConnectedGamepad, hasConnectedGamepad);
}

export function getConsoleInputMode() { return inputMode; }

function setConsoleInputMode(next: ConsoleInputMode) {
  if (next === inputMode) return;
  inputMode = next;
  modeListeners.forEach((listener) => listener());
}

function subscribeInputMode(listener: () => void) {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

export function useConsoleInputMode() {
  return useSyncExternalStore(subscribeInputMode, getConsoleInputMode, getConsoleInputMode);
}

type ConsoleLayer = { scope: React.RefObject<HTMLElement>; handlers: React.MutableRefObject<ConsoleInputHandlers> };
const layers: ConsoleLayer[] = [];

/**
 * Camada sobreposta (visualizador de capturas, painel de opções): enquanto aberta, o foco não sai
 * dela e as ações passam primeiro pelos handlers dela.
 */
export function useConsoleLayer(scope: React.RefObject<HTMLElement>, handlers: ConsoleInputHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const layer = { scope, handlers: handlersRef };
    layers.push(layer);
    return () => { layers.splice(layers.indexOf(layer), 1); };
  }, [scope]);
}

function topLayer() { return layers[layers.length - 1]; }

/** Pedido de foco de uma tela: aplica já no modo controle; no modo mouse, guarda para depois. */
export function requestConsoleFocus(element: HTMLElement | null | undefined) {
  if (!element) return;
  if (inputMode === "controller") focusConsoleElement(element);
  else parkedFocus = element;
}

const BUTTON = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, up: 12, down: 13, left: 14, right: 15 } as const;
const STICK_THRESHOLD = 0.55;
const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 120;

/**
 * Teclado e controle mapeados para as mesmas ações. O controle é lido por polling
 * (Gamepad API não emite eventos de botão) com detecção de borda e auto-repetição
 * no direcional/analógico, como nos menus de console.
 */
export function useConsoleInput(scopeRef: React.RefObject<HTMLElement>, handlers: ConsoleInputHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const currentScope = () => topLayer()?.scope.current ?? scopeRef.current;
    const move = (direction: ConsoleDirection) => {
      const scope = currentScope();
      if (scope) moveConsoleFocus(scope, direction);
    };
    type Action = "onBack" | "onPrevTab" | "onNextTab" | "onFavourite" | "onDetails";
    const dispatch = (action: Action, element?: HTMLElement | null) => {
      for (const layer of [...layers].reverse()) {
        const handler = layer.handlers.current[action];
        if (handler && handler(element ?? null) !== false) return;
      }
      handlersRef.current[action]?.(element ?? null);
    };
    const activate = () => focused()?.click();
    const focusedInScope = () => {
      const active = focused();
      const scope = currentScope();
      return Boolean(active && scope?.contains(active) && active.closest(FOCUSABLE));
    };
    /** Volta ao modo controle; devolve true quando só restaurou o foco (o primeiro toque não move). */
    const wake = () => {
      setConsoleInputMode("controller");
      if (focusedInScope()) return false;
      const scope = currentScope();
      const target = parkedFocus;
      parkedFocus = null;
      if (target?.isConnected && scope?.contains(target) && isVisible(target)) focusConsoleElement(target);
      else if (scope) moveConsoleFocus(scope, "down");
      return true;
    };
    const toPointer = () => {
      if (inputMode === "pointer") return;
      const active = focused();
      if (active && focusedInScope() && !isTypingTarget(active)) {
        parkedFocus = active;
        active.blur();
      }
      setConsoleInputMode("pointer");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const typing = isTypingTarget(document.activeElement);
      const directions: Record<string, ConsoleDirection> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      const direction = directions[event.key];
      if (direction) {
        // No campo de busca, esquerda/direita movem o cursor do texto.
        if (typing && (direction === "left" || direction === "right")) return;
        event.preventDefault();
        if (!wake()) move(direction);
        return;
      }
      if (event.key === "Enter" && !typing && !focusedInScope()) {
        event.preventDefault();
        wake();
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) setConsoleInputMode("controller");
      if (event.key === "Escape" || (event.key === "Backspace" && !typing)) {
        event.preventDefault();
        if (typing) (document.activeElement as HTMLElement).blur();
        dispatch("onBack");
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (key === "q") { event.preventDefault(); dispatch("onPrevTab"); }
      else if (key === "e") { event.preventDefault(); dispatch("onNextTab"); }
      else if (key === "f") { event.preventDefault(); dispatch("onFavourite", focused()); }
      else if (key === "i") { event.preventDefault(); dispatch("onDetails", focused()); }
    };

    let frame = 0;
    const pressed = new Set<number>();
    const repeat = new Map<ConsoleDirection, number>();

    const poll = () => {
      frame = requestAnimationFrame(poll);
      const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((entry): entry is Gamepad => Boolean(entry && entry.connected));
      if (!pad) return;
      const now = performance.now();
      const isDown = (index: number) => Boolean(pad.buttons[index]?.pressed);
      const edge = (index: number) => {
        const down = isDown(index);
        const fired = down && !pressed.has(index);
        if (down) pressed.add(index); else pressed.delete(index);
        return fired;
      };

      const anyInput = pad.buttons.some((button) => button.pressed) || pad.axes.some((axis) => Math.abs(axis) > STICK_THRESHOLD);
      if (anyInput && inputMode === "pointer") {
        // O toque que acorda o controle só devolve o foco; nada é acionado por ele.
        wake();
        pad.buttons.forEach((button, index) => { if (button.pressed) pressed.add(index); });
        for (const direction of ["up", "down", "left", "right"] as ConsoleDirection[]) repeat.set(direction, now + REPEAT_DELAY_MS);
        return;
      }

      if (edge(BUTTON.cross)) activate();
      if (edge(BUTTON.circle)) dispatch("onBack");
      if (edge(BUTTON.square)) dispatch("onFavourite", focused());
      if (edge(BUTTON.triangle)) dispatch("onDetails", focused());
      if (edge(BUTTON.l1)) dispatch("onPrevTab");
      if (edge(BUTTON.r1)) dispatch("onNextTab");

      const [axisX = 0, axisY = 0] = pad.axes;
      const held: Record<ConsoleDirection, boolean> = {
        up: isDown(BUTTON.up) || axisY < -STICK_THRESHOLD,
        down: isDown(BUTTON.down) || axisY > STICK_THRESHOLD,
        left: isDown(BUTTON.left) || axisX < -STICK_THRESHOLD,
        right: isDown(BUTTON.right) || axisX > STICK_THRESHOLD,
      };
      for (const direction of Object.keys(held) as ConsoleDirection[]) {
        if (!held[direction]) { repeat.delete(direction); continue; }
        const next = repeat.get(direction);
        if (next === undefined) {
          move(direction);
          repeat.set(direction, now + REPEAT_DELAY_MS);
        } else if (now >= next) {
          move(direction);
          repeat.set(direction, now + REPEAT_INTERVAL_MS);
        }
      }
    };

    let lastPointer: { x: number; y: number } | null = null;
    // Só movimento real conta: rolar a página por baixo de um cursor parado também gera mousemove.
    const onMouseMove = (event: MouseEvent) => {
      const previous = lastPointer;
      lastPointer = { x: event.clientX, y: event.clientY };
      if (previous && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >= 4) toPointer();
    };
    const onPointerDown = (event: PointerEvent) => { if (event.pointerType === "mouse") toPointer(); };
    const onWheel = () => toPointer();
    // Clique do mouse não deixa foco preso no botão (o anel de foco é do controle); campos de texto continuam recebendo foco.
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(FOCUSABLE) : null;
      if (target && !isTypingTarget(target)) event.preventDefault();
    };
    const scope = scopeRef.current;

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    scope?.addEventListener("mousedown", onMouseDown);
    frame = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("wheel", onWheel);
      scope?.removeEventListener("mousedown", onMouseDown);
      cancelAnimationFrame(frame);
    };
  }, [scopeRef]);
}
