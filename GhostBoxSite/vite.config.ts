import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const siteDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: siteDirectory,
  plugins: [react()],
  publicDir: path.resolve(siteDirectory, "..", "public"),
  server: {
    port: 4173,
    strictPort: false,
  },
  build: {
    outDir: path.resolve(siteDirectory, "dist"),
    emptyOutDir: true,
  },
});
