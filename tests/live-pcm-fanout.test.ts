import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Live PCM fanout on Core's Node runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-live-pcm-"));
  try {
    // Hold admission ready at this seam; production PCM admission remains a
    // separate gate. Capture, scheduling, encryption and sockets are unchanged.
    const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "live-pcm-fanout.fixture.ts")], outdir: directory, target: "node", plugins: [{
      name: "admitted-fanout-fixture",
      setup(build) {
        build.onLoad({ filter: /\/output-admission\.ts$/ }, () => ({ loader: "ts",
          contents: 'export const liveOutputAdmission = session => ({ state: session ? "ready" : "preparing" });' }));
      },
    }] });
    expect(bundle.success).toBe(true);
    const result = spawnSync("node", ["--test", bundle.outputs[0]!.path], { encoding: "utf8", timeout: 10000 });
    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: expect.any(String) });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15000);
