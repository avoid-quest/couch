import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { version } from "../package.json";

const packaged = { version: "0.1.0", revision: "0123456789abcdef0123456789abcdef01234567", dataFormat: 1, target: "x86_64-unknown-linux-gnu", packaged: true };
for (const metadata of [undefined, packaged]) {
  test(`browser build identity ${metadata ? "retains embedded release metadata" : "defaults to unpackaged in source mode"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-frontend-build-"));
    try {
      const entry = join(directory, "fixture.ts");
      await writeFile(entry, `import { buildInfo, loadedBuild, buildKey } from ${JSON.stringify(resolve(import.meta.dir, "../src/shared/build.ts"))};
globalThis.result = { buildInfo, loadedBuild, key: buildKey(loadedBuild) };`);
      const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: true,
        define: metadata ? { "COUCH_BUILD_INFO": JSON.stringify(JSON.stringify(metadata)) } : {},
      });
      expect(build.success).toBe(true);
      const browser: { result?: { buildInfo: unknown; loadedBuild: unknown; key: string | null } } = {};
      // No process global, as in the browser loading the source server's bundle.
      runInNewContext(await build.outputs[0]!.text(), browser);
      expect(browser.result?.buildInfo).toEqual(metadata ?? { version, revision: null, dataFormat: 1, target: null, packaged: false });
      expect(browser.result?.loadedBuild).toEqual({ version: metadata?.version ?? version, revision: metadata?.revision ?? null, dataFormat: 1 });
      expect(browser.result?.key).toBe(metadata ? `${metadata.version}:${metadata.revision}:1` : null);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
