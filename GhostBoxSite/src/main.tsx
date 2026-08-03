import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function SitePlaceholder() {
  return <main aria-label="GhostBox">GhostBox</main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SitePlaceholder />
  </StrictMode>,
);
