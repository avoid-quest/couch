import { readFileSync, realpathSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { frontendPaths } from "./src/shared/page-paths";
import { version } from "./package.json";

// scripts/build.ts writes the release identity before the client build runs;
// a standalone `vite build` falls back to an unsigned identity. Development
// always uses an unsigned identity so old release output cannot block its API.
const buildInfo = (() => {
  try {
    return readFileSync("build/build-info.json", "utf8");
  } catch {
    return JSON.stringify({ version: "0.0.0-dev", revision: null, dataFormat: 1, packaged: false });
  }
})();
// index.html preloads the latin Inter Tight and Mona Sans so the first paint is in them. The build resolves those paths to
// the assets the stylesheet uses; the dev server serves them where the stylesheet asks, under /@fs/.
const fonts = ["node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2", "node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2"];
export default defineConfig(({ command }) => ({
  clearScreen: false,
  root: "src/client",
  // Core serves the application at /. Relative asset/worker URLs would
  // instead resolve below a refreshed route.
  base: "/",
  resolve: { alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) } },
  plugins: [
    tanstackRouter({ autoCodeSplitting: true, routesDirectory: "./routes", generatedRouteTree: "./routeTree.gen.ts" }),
    react(),
    tailwindcss(),
    { name: "couch-font-preload", apply: "serve", transformIndexHtml: { order: "pre", handler: html => fonts.reduce((html, font) => html.replace(`../../${font}`, `/@fs${realpathSync(font)}`), html) } },
    // App-shell precache only (#338): the generated worker precaches the build's
    // static assets and leaves every API and WebSocket request on the network.
    // Registration is manual in the client entry so the app window never
    // registers it.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["icons/pwa-192.png", "icons/pwa-512.png", "icons/pwa-maskable-512.png"],
      manifest: {
        name: "Couch",
        short_name: "Couch",
        description: "A media player everyone shares",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
    "COUCH_BUILD_INFO": JSON.stringify(command === "serve" ? JSON.stringify({ version, revision: null, dataFormat: 1, packaged: false }) : buildInfo),
    // Lets a browser tab opt into the TV presentation (src/client/session/presentation.ts) in development
    // and scratch builds only; a release build leaves the override out.
    "COUCH_TV_OVERRIDE": JSON.stringify(command === "serve" || process.env.COUCH_TV_OVERRIDE === "1"),
  },
  // Browser clients are same-origin with Core; the dev proxy supplies that
  // origin so `vite` (and browser-driven loops) pair with `bun run server:dev`.
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
  build: { outDir: "../../dist", emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: "exports-only", input: { main: "src/client/index.html", capture: "src/client/capture-audio.html" } } },
}));
