import { mkdir, rm } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";
import { version } from "../package.json";
import tauri from "../src-tauri/tauri.conf.json";
import { releaseVersion } from "./release-version";

const targets: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("Build on Linux or macOS for this first desktop slice.");
const cargo = Bun.TOML.parse(await Bun.file("src-tauri/Cargo.toml").text()) as { package: { version: string } };
if (version !== tauri.version || version !== cargo.package.version) throw new Error("package.json, Tauri and Cargo versions must match");
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
const dirty = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim() !== "";
const helpers = await Bun.file("src-tauri/resources/tools.json").exists() ? await Bun.file("src-tauri/resources/tools.json").json() : null;
const buildInfo = JSON.stringify({ version: releaseVersion(version, process.env.COUCH_RELEASE_ID), sourceVersion: version, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : null, dirty, target, bun: Bun.version, packaged: helpers !== null, helpers });
await Bun.write("src-tauri/build-info.json", buildInfo);

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
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.COUCH_BUILD_INFO": JSON.stringify(buildInfo) },
});
if (!server.success) throw new AggregateError(server.logs, "Sidecar build failed");
console.log(`Built frontend and Bun sidecar for ${target}`);
