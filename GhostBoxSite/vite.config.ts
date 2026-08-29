import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Caminhos canonizados via realpath NATIVO: no Windows o caso do caminho
// informado pode divergir do caso canônico no disco (`E:\ghostbox` vs
// `E:\GhostBox`), e o plugin `vite:html-inline-proxy` compara `config.root`
// com os ids resolvidos pelo Rollup por comparação de string — o Rollup
// canonicaliza ids com realpath nativo, então `root` e os inputs precisam da
// mesma canonização ou o proxy de CSS inline das rotas de política não
// encontra o módulo e o build quebra. `realpathSync` (a versão JS) preserva a
// caixa do input e não resolve; `.native` sim. No Linux/CI é identidade.
const siteRoot = realpathSync.native(fileURLToPath(new URL(".", import.meta.url)));
const siteInput = (relative: string) =>
  realpathSync.native(fileURLToPath(new URL(relative, import.meta.url)));

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
        index: siteInput("./index.html"),
        terms: siteInput("./terms/index.html"),
        privacy: siteInput("./privacy/index.html"),
        refund: siteInput("./refund/index.html"),
      },
    },
  },
});
