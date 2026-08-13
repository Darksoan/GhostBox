import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const windowMaximizedStorageKey = "ghostbox:window-maximized:v1";

/**
 * Store único de módulo em vez de um `useState` por componente. Cada consumidor
 * com estado próprio começava em `false` e só virava `true` depois do
 * round-trip de `isMaximized()` — ou seja, toda montagem da Home pintava os
 * cards no tamanho de janela restaurada e os encolhia na frente do usuário um
 * frame depois. Com o valor no módulo, remontagens (trocar de aba e voltar,
 * restaurar a janela) já leem o estado final no primeiro render.
 */
let isMaximizedState = readStoredWindowMaximized();
let started = false;
let settleTimeoutId: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/**
 * Semente do primeiro render do processo. O estado da janela persiste entre
 * sessões (o sistema reabre o app como estava), então o último valor conhecido
 * acerta na largura esmagadora das vezes e mata o salto também no arranque
 * frio, onde não há nada em memória para consultar. Se errar, o `refresh()`
 * abaixo corrige — mas aí é uma janela que mudou de estado entre sessões, não
 * todo carregamento.
 */
function readStoredWindowMaximized() {
  try {
    return window.localStorage.getItem(windowMaximizedStorageKey) === "true";
  } catch {
    return false;
  }
}

function setIsMaximizedState(next: boolean) {
  if (next === isMaximizedState) return;
  isMaximizedState = next;

  try {
    window.localStorage.setItem(windowMaximizedStorageKey, next ? "true" : "false");
  } catch {
    // O estado continua correto na sessão sem localStorage; só o arranque
    // seguinte perde a semente.
  }

  listeners.forEach((listener) => listener());
}

function refresh() {
  try {
    const win = getCurrentWindow();

    // Minimizar reporta `isMaximized() === false` mesmo numa janela que estava
    // maximizada (o estado "zoomed" fica indefinido enquanto minimizada). Sem
    // este filtro o estado cai para `false` durante o minimize e volta para
    // `true` ~120ms depois de restaurar — o CSS de maximizada pisca na frente
    // do usuário logo que a janela reaparece. Ignorando o refresh nesse
    // intervalo, o valor anterior é mantido e o resize do restore já chega com
    // o valor final certo.
    void win
      .isMinimized()
      .then((minimized) => {
        if (minimized) return;
        return win.isMaximized().then(setIsMaximizedState);
      })
      .catch(() => {});
  } catch {
    // Fora do Tauri (vite dev no navegador) não existe janela.
  }
}

// `onResized` dispara a cada frame do arrasto e `isMaximized()` é uma ida ao
// backend: sem o coalescing eram dezenas de round-trips por segundo, cujas
// respostas chegavam fora de ordem e faziam o ícone da titlebar piscar entre
// maximizar/restaurar. Maximizar/restaurar de verdade emite um evento só,
// então o atraso não é percebido.
function scheduleRefresh() {
  if (settleTimeoutId !== null) clearTimeout(settleTimeoutId);
  settleTimeoutId = setTimeout(() => {
    settleTimeoutId = null;
    refresh();
  }, 120);
}

/**
 * Um listener para o processo inteiro, aberto no import e nunca desfeito: o
 * estado da janela é global e vive tanto quanto o app. Antes cada consumidor
 * montava e desmontava o seu, o que além de redundante refazia o round-trip
 * inicial (e o salto visual) a cada remontagem.
 */
function start() {
  if (started) return;

  try {
    const win = getCurrentWindow();
    // Só marca como iniciado depois que a janela respondeu: no import os
    // internals do Tauri podem ainda não estar injetados, e marcar antes
    // deixaria o store preso na semente para sempre, sem nunca reassinar.
    started = true;
    refresh();
    void win.onResized(scheduleRefresh);
  } catch {
    // Fora do Tauri não há evento de janela para assinar; a próxima
    // `subscribe` tenta de novo.
  }
}

start();

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return isMaximizedState;
}

/**
 * Estado real de maximização da janela. Maximizar e restaurar emitem `resize`,
 * então o listener cobre tanto o botão da titlebar quanto o snap do sistema.
 *
 * Fora do Tauri (vite dev no navegador) não existe janela: retorna `false`.
 */
export function useWindowMaximized(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
