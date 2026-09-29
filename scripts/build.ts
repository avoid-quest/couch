import { relative, resolve, sep } from "node:path";
import { version } from "../package.json";
import { build as viteBuild } from "vite";
import { frontendPaths } from "../src/shared/page-paths";

const targets: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu", "linux-x64": "x86_64-unknown-linux-gnu", "win32-x64": "x86_64-pc-windows-msvc",
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`Unsupported build target: ${process.platform}/${process.arch}`);
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
const dirty = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim() !== "";
const buildInfo = JSON.stringify({ version, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : null, dirty, target, dataFormat: 1, bun: Bun.version, packaged: false });
await Bun.write("src-tauri/build-info.json", buildInfo);

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
  compile: { outfile: `src-tauri/binaries/couch-server-${target}`, autoloadDotenv: false, autoloadBunfig: false },
  minify: true,
  plugins: [{ name: "vite-frontend-bytes", setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\]frontend\.ts$/ }, () => ({ contents: frontendModule, loader: "ts" }));
  } }],
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "COUCH_BUILD_INFO": JSON.stringify(buildInfo), "import.meta.env.DEV": "false" },
});
if (!server.success) throw new AggregateError(server.logs, "Sidecar build failed");
console.log(`Built one frontend (Vite), embedded in Tauri assets and the Bun sidecar for ${target}`);
