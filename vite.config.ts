import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

// scripts/build.ts writes the release identity before the client build runs;
// a standalone `vite build` or the dev server falls back to the unsigned shape
// shared/build.ts already tolerates at runtime.
const buildInfo = (() => {
  try {
    return readFileSync("src-tauri/build-info.json", "utf8");
  } catch {
    return JSON.stringify({ version: "0.0.0-dev", revision: null, dataFormat: 1, target: null, packaged: false });
  }
})();

export default defineConfig({
  root: "src/client",
  base: "./",
  plugins: [
    tanstackRouter({ routesDirectory: "./routes", generatedRouteTree: "./routeTree.gen.ts" }),
    react(),
    tailwindcss(),
    // App-shell precache only (#338): the generated worker precaches the build's
    // static assets and leaves every API and WebSocket request on the network.
    // Registration is manual in the client entry so the Tauri webview never
    // registers it.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["icons/pwa-192.png", "icons/pwa-512.png"],
      manifest: {
        name: "Couch",
        short_name: "Couch",
        description: "A media player for your library and online sources",
        theme_color: "#0a0a0a",
        background_color: "#0b1119",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      },
    }),
  ],
  define: { "COUCH_BUILD_INFO": JSON.stringify(buildInfo) },
  server: { port: 1420, strictPort: true },
  build: { outDir: "../../dist", emptyOutDir: true },
});
