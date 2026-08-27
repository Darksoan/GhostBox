import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/app.scss";
import App from "./App";

// Marca que há JS antes do primeiro paint: os estados escondidos de reveal só
// valem sob html.js, então sem script o conteúdo nasce visível.
document.documentElement.classList.add("js");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
