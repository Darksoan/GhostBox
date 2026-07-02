import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { SettingsProvider } from "./context/settings";
import { OverlayProvider } from "./context/OverlayContext";
import { AppDataProvider } from "./context/AppDataContext";
import { queryClient } from "./lib/queryClient";
import { TrayMenu } from "./components/tray/TrayMenu";

async function waitForInterfaceFonts() {
  if (!("fonts" in document)) return;

  await Promise.race([
    Promise.all([
      document.fonts.load('400 14px "Open Sans"'),
      document.fonts.load('500 14px "Open Sans"'),
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 900)),
  ]);
}

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

if (isTrayMenu) {
  renderApp();
} else {
  void waitForInterfaceFonts().finally(renderApp);
}
