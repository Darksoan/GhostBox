import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { SettingsProvider } from "./context/settings";
import { queryClient } from "./lib/queryClient";

async function waitForInterfaceFonts() {
  if (!("fonts" in document)) return;

  await Promise.race([
    Promise.all([
      document.fonts.load('400 14px "Open Sans"'),
      document.fonts.load('500 14px "Open Sans"'),
      document.fonts.load('600 14px "Open Sans"'),
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 900)),
  ]);
}

void waitForInterfaceFonts().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
