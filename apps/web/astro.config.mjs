import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://couch.avoid.quest",
  adapter: cloudflare(),
  vite: { plugins: [tailwindcss()] },
});
