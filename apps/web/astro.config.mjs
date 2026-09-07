import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://couch.avoid.quest",
  vite: { plugins: [tailwindcss()] },
});
