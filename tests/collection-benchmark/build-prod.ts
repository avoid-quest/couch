import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";

const repo = process.cwd(), root = join(repo, "build/couch-review-render");
await build({
  configFile: false, root,
  resolve: { alias: { "@": join(repo, "src/client") } },
  plugins: [react(), tailwindcss()],
  define: {
    COUCH_BUILD_INFO: JSON.stringify(JSON.stringify({ version: "0.4.0", revision: null, dataFormat: 1, packaged: false })),
    COUCH_TV_OVERRIDE: "true",
  },
  build: {
    outDir: process.env.COUCH_RENDER_OUTPUT ?? join(root, "prod"),
    emptyOutDir: true, rollupOptions: { input: join(root, "prod.html") },
  },
});
