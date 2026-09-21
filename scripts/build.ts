import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { version } from "../package.json";
import tauri from "../src-tauri/tauri.conf.json";
import { releaseVersion } from "./hosted-policy";
import debian from "../packaging/debian.json";
import { build as viteBuild } from "vite";
import { frontendPaths } from "../src/shared/page-paths";

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
const buildInfo = JSON.stringify({ version: releaseVersion(version), sourceVersion: version, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : null, dirty, target, dataFormat: 1, readableDataFormats: [1], maintenanceProtocol: "maintenance-v1", bun: Bun.version, packaged: helpers !== null, helpers });
await Bun.write("src-tauri/build-info.json", buildInfo);
if (helpers) {
  const host = process.env.COUCH_PACKAGE_FORMAT === "deb" ? debian.depends.map(dependency => dependency.split(" ")[0]) : (await Bun.file("packaging/setup/files.json").json()).common;
  await Bun.write("src-tauri/resources/release.json", JSON.stringify({ ...JSON.parse(buildInfo), schemaVersion: 1, host: { os: "debian", version: "13", architecture: "amd64", session: "x11", packages: host } }));
}

await mkdir("src-tauri/binaries", { recursive: true });

// One client graph: Vite emits dist, which Tauri packages unchanged. The Bun
// sidecar embeds those same bytes, including the generated worker and manifest.
await viteBuild();
const dist = resolve("dist");
const files: string[] = [];
for await (const path of new Bun.Glob("**/*").scan({ cwd: dist, absolute: true, onlyFiles: true })) files.push(path);
files.sort();
const imports: string[] = [], responses: string[] = [];
for (const [index, file] of files.entries()) {
  const path = "/" + relative(dist, file).split(sep).join("/");
  if (/[:*?#\\]/.test(path) || /^\/api(?:\/|$)/.test(path) || frontendPaths.includes(path)) throw new Error(`Frontend output collides with a coordinator route: ${path}`);
  // A file import bypasses every JS/CSS/HTML transform. Do not import the built
  // HTML with Bun's HTML loader: that would create another client graph.
  imports.push(`import file${index} from ${JSON.stringify(file)} with { type: "file" };`);
  const headers = { "Content-Type": Bun.file(file).type || "application/octet-stream", "Cache-Control": "no-cache", ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}) };
  responses.push(`${JSON.stringify(path)}: new Response(Bun.file(file${index}), { headers: ${JSON.stringify(headers)} })`);
}
if (!files.includes(resolve(dist, "index.html"))) throw new Error("Vite did not emit dist/index.html");
const frontendModule = `${imports.join("\n")}\nexport const assets = {${responses.join(",\n")}};\nexport default assets["/index.html"];\n`;
const server = await Bun.build({
  entrypoints: ["src/main.ts"],
  compile: {
    outfile: `src-tauri/binaries/couch-server-${target}`,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  minify: true,
  plugins: [{ name: "vite-frontend-bytes", setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\]frontend\.ts$/ }, () => ({ contents: frontendModule, loader: "ts" }));
  } }],
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "COUCH_BUILD_INFO": JSON.stringify(buildInfo), "import.meta.env.DEV": "false" },
});
if (!server.success) throw new AggregateError(server.logs, "Sidecar build failed");
console.log(`Built one frontend (Vite), embedded in Tauri assets and the Bun sidecar for ${target}`);
