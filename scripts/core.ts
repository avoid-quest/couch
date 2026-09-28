import { watch } from "node:fs";
import { readFile } from "node:fs/promises";

// Bundles Core with its dependencies into one ESM file that Node runs.
export const coreBundle = "build/core.mjs";

// A release build passes the identity of the dist it serves, so browsers loading
// that dist see a matching build. Development builds carry none, like Vite's dev
// server. The bundle is rewritten only when it changed, so `node --watch` and
// `tauri dev` restart Core only then.
export async function buildCore(identity?: string) {
  const result = await Bun.build({ entrypoints: ["src/main.ts"], target: "node", format: "esm", minify: !!identity, ...(identity ? { define: { COUCH_BUILD_INFO: JSON.stringify(identity) } } : {}) });
  if (!result.success) throw new AggregateError(result.logs, "Core build failed");
  const bundle = await result.outputs[0]!.text();
  if (bundle !== await readFile(coreBundle, "utf8").catch(() => null)) await Bun.write(coreBundle, bundle);
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
