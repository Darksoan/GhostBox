import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
// Inter Variable: arquivo único com os pesos 100–900 disponíveis. É o que
// sustenta os pesos reais dos tokens --weight-* em _semantic.scss (400).
import "@fontsource-variable/inter";
import App from "./App";
import { SettingsProvider } from "./context/settings";
import { OverlayProvider } from "./context/OverlayContext";
import { AppDataProvider } from "./context/AppDataContext";
import { AuthProvider } from "./context/AuthContext";
import { AuthGate } from "./features/auth/AuthGate";
import { queryClient } from "./lib/queryClient";
import { TrayMenu } from "./components/tray/TrayMenu";

const isTrayMenu = new URLSearchParams(window.location.search).get("tray") === "1";

// Alt isolado não deve ativar os realces nativos de menu/foco do WebView.
// Não interfere em AltGr nem nas demais teclas dos atalhos com Alt.
function preventStandaloneAltDefault(event: KeyboardEvent) {
  if (
    event.key === "Alt" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    event.preventDefault();
  }
}

window.addEventListener("keydown", preventStandaloneAltDefault, { capture: true });
window.addEventListener("keyup", preventStandaloneAltDefault, { capture: true });

// O app usa menu de contexto próprio (`ContextMenu`). Sem este bloqueio o
// WebView abre o menu nativo do navegador em qualquer clique direito fora
// dos cards (fundo, textos, header, inputs), por cima/abaixo do menu do app.
window.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {isTrayMenu ? (
        <SettingsProvider>
          <TrayMenu />
        </SettingsProvider>
      ) : (
        <QueryClientProvider client={queryClient}>
          <SettingsProvider>
            <AuthProvider>
              <OverlayProvider>
                <AppDataProvider>
                  <AuthGate>
                    <App />
                  </AuthGate>
                </AppDataProvider>
              </OverlayProvider>
            </AuthProvider>
          </SettingsProvider>
        </QueryClientProvider>
      )}
    </React.StrictMode>
  );
}

renderApp();
