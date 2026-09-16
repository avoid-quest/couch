import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
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
  ],
  define: { "COUCH_BUILD_INFO": JSON.stringify(buildInfo) },
  server: { port: 1420, strictPort: true },
  build: { outDir: "../../dist", emptyOutDir: true },
});
