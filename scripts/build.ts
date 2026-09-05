import { mkdir, rm } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

const targets: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("Build on Linux or macOS for this first desktop slice.");

await rm("dist", { recursive: true, force: true });
await mkdir("src-tauri/binaries", { recursive: true });

const frontend = await Bun.build({
  entrypoints: ["src/client/index.html"],
  outdir: "dist",
  target: "browser",
  minify: true,
  plugins: [tailwind],
});
if (!frontend.success) throw new AggregateError(frontend.logs, "Frontend build failed");

const server = await Bun.build({
  entrypoints: ["src/main.ts"],
  compile: {
    outfile: `src-tauri/binaries/couch-server-${target}`,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  minify: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!server.success) throw new AggregateError(server.logs, "Sidecar build failed");
console.log(`Built frontend and Bun sidecar for ${target}`);
