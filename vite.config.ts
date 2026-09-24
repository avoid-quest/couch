import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { frontendPaths } from "./src/shared/page-paths";
import tauri from "./src-tauri/tauri.conf.json" with { type: "json" };

// scripts/build.ts writes the release identity before the client build runs;
// a standalone `vite build` falls back to an unsigned identity. Development
// always uses an unsigned identity so old release output cannot block its API.
const buildInfo = (() => {
  try {
    return readFileSync("src-tauri/build-info.json", "utf8");
  } catch {
    return JSON.stringify({ version: "0.0.0-dev", revision: null, dataFormat: 1, target: null, packaged: false });
  }
})();
const darkSurface = tauri.app.windows[0]?.backgroundColor;
if (!darkSurface) throw new Error("Missing dark design-system background color.");

export default defineConfig(({ command }) => ({
  clearScreen: false,
  root: "src/client",
  // Both the Tauri asset protocol and the sidecar serve the application at /.
  // Relative asset/worker URLs would instead resolve below a refreshed route.
  base: "/",
  resolve: { alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) } },
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
        theme_color: darkSurface,
        background_color: darkSurface,
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
        navigateFallback: "/index.html",
        navigateFallbackAllowlist: [...new Set(frontendPaths)].map(path => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`)),
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      },
    }),
  ],
  define: {
    "COUCH_BUILD_INFO": JSON.stringify(command === "serve" ? JSON.stringify({ version: tauri.version, revision: null, dataFormat: 1, target: null, packaged: false }) : buildInfo),
    "COUCH_DEV_ORIGIN": JSON.stringify(command === "serve" ? new URL(tauri.build.devUrl).origin : null),
  },
  // Browser clients are same-origin with couch-server; the dev proxy supplies
  // that origin so `vite` (and browser-driven loops) pair with `bun src/main.ts`.
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.COUCH_PORT ?? 4100}`,
        ws: true,
        changeOrigin: true,
        // The server admits its own advertised origins only; present the
        // proxied loopback requests as the target origin.
        headers: { origin: `http://127.0.0.1:${process.env.COUCH_PORT ?? 4100}` },
        // src/client/api/*.ts modules are served from the same URL prefix as
        // the backend; only forward requests that are not module files.
        bypass: request => (/\.(ts|tsx|js|jsx|css|png|svg|woff2?)(\?|$)/.test(request.url ?? "") ? request.url : undefined),
      },
    },
  },
  build: { outDir: "../../dist", emptyOutDir: true },
}));
