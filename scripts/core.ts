import { watch } from "node:fs";
import { readFile } from "node:fs/promises";

// Bundles Core and its audio worker for Node and the app's utilityProcess.
export const coreBundle = "build/core.mjs";

// Unminified, so the installed app's log has readable stack traces.
// A release build passes the identity of the dist it serves, so browsers loading
// that dist see a matching build. Development builds carry none, like Vite's dev
// server. Rewrite Core when either bundle changes so `node --watch` also
// replaces the running audio worker after worker-only edits.
export async function buildCore(identity?: string) {
  let workerChanged = false;
  for (const [entry, output] of [["src/server/audio-worker.ts", "build/audio-worker.mjs"], ["src/main.ts", coreBundle]] as const) {
    const result = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", naming: { asset: "[name].[ext]" }, ...(identity ? { define: { COUCH_BUILD_INFO: JSON.stringify(identity) } } : {}) });
    if (!result.success) throw new AggregateError(result.logs, `${entry} build failed`);
    // Files a bundle imports `with { type: "file" }` (the worker's Opus WASM) sit beside it.
    for (const asset of result.outputs.filter(output => output.kind === "asset")) await Bun.write(`build/${asset.path.replace(/^\.\//, "")}`, asset);
    const bundle = await result.outputs[0]!.text();
    const changed = bundle !== await readFile(output, "utf8").catch(() => null);
    if (changed || output === coreBundle && workerChanged) await Bun.write(output, bundle);
    if (output !== coreBundle) workerChanged = changed;
  }
}

// Electron's main process (ESM) and the window's sandboxed preload (CommonJS).
export async function buildApp() {
  for (const [entry, format, output] of [["app/main.ts", "esm", "build/main.mjs"], ["app/preload.ts", "cjs", "build/preload.cjs"]] as const) {
    const result = await Bun.build({ entrypoints: [entry], target: "node", format, external: ["electron"] });
    if (!result.success) throw new AggregateError(result.logs, `${entry} build failed`);
    await Bun.write(output, await result.outputs[0]!.text());
  }
}

export function watchCore() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch("src", { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildCore().catch(error => console.error(error)), 100);
  });
}

// `bun scripts/core.ts --watch` also runs Core under `node --watch`.
if (import.meta.main) {
  await buildCore();
  if (process.argv.includes("--watch")) {
    watchCore();
    const node = Bun.spawn(["node", "--watch", coreBundle], { stdio: ["inherit", "inherit", "inherit"] });
    process.exit(await node.exited);
  }
}
