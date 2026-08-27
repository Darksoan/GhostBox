import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const siteRoot = fileURLToPath(new URL(".", import.meta.url));

// Entrypoint isolado do site institucional. Não compartilha config com o app
// Tauri: `npm run build` continua saindo em dist/ e não enxerga esta pasta.
export default defineConfig({
  root: siteRoot,
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  server: {
    port: 1430,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      // Uma entrada por rota estática. As três políticas já existiam no site no
      // ar nesses caminhos; mantê-las evita quebrar links do Stripe e do rodapé.
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        refund: fileURLToPath(new URL("./refund/index.html", import.meta.url)),
      },
    },
  },
});
