import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import App from "./App";
import { SettingsProvider } from "./context/settings";
import { OverlayProvider } from "./context/OverlayContext";
import { AppDataProvider } from "./context/AppDataContext";
import { AuthProvider } from "./context/AuthContext";
import { AuthGate } from "./features/auth/AuthGate";
import { queryClient } from "./lib/queryClient";
import { TrayMenu } from "./components/tray/TrayMenu";

const isTrayMenu = new URLSearchParams(window.location.search).get("tray") === "1";

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
                <AuthGate>
                  <AppDataProvider>
                    <App />
                  </AppDataProvider>
                </AuthGate>
              </OverlayProvider>
            </AuthProvider>
          </SettingsProvider>
        </QueryClientProvider>
      )}
    </React.StrictMode>
  );
}

renderApp();
