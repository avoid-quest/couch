import { watch } from "node:fs";
import { readFile } from "node:fs/promises";

// Bundles Core with its dependencies into one ESM file that Node, and the
// app's utilityProcess, run.
export const coreBundle = "build/core.mjs";

// A release build passes the identity of the dist it serves, so browsers loading
// that dist see a matching build. Development builds carry none, like Vite's dev
// server. The bundle is rewritten only when it changed, so `node --watch`
// restarts Core only then.
export async function buildCore(identity?: string) {
  const result = await Bun.build({ entrypoints: ["src/main.ts"], target: "node", format: "esm", minify: !!identity, ...(identity ? { define: { COUCH_BUILD_INFO: JSON.stringify(identity) } } : {}) });
  if (!result.success) throw new AggregateError(result.logs, "Core build failed");
  const bundle = await result.outputs[0]!.text();
  if (bundle !== await readFile(coreBundle, "utf8").catch(() => null)) await Bun.write(coreBundle, bundle);
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
