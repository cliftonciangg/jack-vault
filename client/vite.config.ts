import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The server runs on :8080 (npm start in the parent folder). In dev, Vite proxies
// /api and /ws there, so the browser sees one origin and no CORS setup is needed.
const server = process.env.JACK_VAULT_SERVER ?? "http://localhost:8080";

export default defineConfig(({ mode }) => ({
  base: "./",
  resolve: {
    // Demo mode runs the real server engine in the browser. Its RNG module imports
    // node:crypto for the server's CryptoRng, which the browser build never uses.
    alias: { "node:crypto": fileURLToPath(new URL("./src/api/crypto-shim.ts", import.meta.url)) },
  },
  define: { __FORCE_DEMO__: JSON.stringify(mode === "demo") },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/office": server,
      "/ws": { target: server.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: mode === "demo" ? "dist-demo" : "dist",
    assetsInlineLimit: mode === "demo" ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 2000,
    // The demo build is one self-contained HTML file, so no lazy chunks.
    rollupOptions: mode === "demo" ? { output: { inlineDynamicImports: true } } : {},
  },
}));
