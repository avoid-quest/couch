import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://couch.avoid.quest",
  adapter: cloudflare(),
  session: false,
  // Prerendered pages as about.html, which Cloudflare serves at /about without a redirect.
  build: { format: "file" },
  vite: { plugins: [tailwindcss()] },
});
