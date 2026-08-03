import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import App from "./App";
import { SettingsProvider } from "./context/settings";
import { OverlayProvider } from "./context/OverlayContext";
import { AppDataProvider } from "./context/AppDataContext";
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
            <OverlayProvider>
              <AppDataProvider>
                <App />
              </AppDataProvider>
            </OverlayProvider>
          </SettingsProvider>
        </QueryClientProvider>
      )}
    </React.StrictMode>
  );
}

renderApp();
