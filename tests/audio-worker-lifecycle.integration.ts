import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { createSendspin } from "../src/server/sendspin";
import type { PlayerState } from "../src/shared/protocol";
import { nodeExecutables } from "./executable.fixture";

const until = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Expected worker lifecycle event did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-worker-lifecycle-"));
  const executables = nodeExecutables(directory, { workers: true });
  const threads = process.getBuiltinModule("node:worker_threads"),
    Original = threads.Worker;
  let worker!: Worker;
  threads.Worker = class extends Original {
    constructor(file: string | URL, options?: WorkerOptions) {
      super(file, options);
      worker = this;
    }
  };
  syncBuiltinESMExports();
  const source = createServer((_request, response) => response.end("synthetic source"));
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const script = join(directory, "ffmpeg");
  writeFileSync(script, "#!couch-test-node\nsetInterval(() => {}, 1000);\n");
  const states: PlayerState[] = [];
  const audio = createSendspin({
    name: "Worker ownership",
    admit: () => true,
    changed() {},
    ffmpeg: async () => script,
  });
  const failures: unknown[] = [];
  worker.on("error", (error) => failures.push(error));
  t.after(async () => {
    try {
      await audio.close();
    } finally {
      threads.Worker = Original;
      syncBuiltinESMExports();
      const forced = await executables.close();
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
      assert.deepEqual(
        forced,
        { children: [], workers: [] },
        "production teardown must retire every owned child and worker before fixture cleanup",
      );
    }
  });
  return {
    audio,
    states,
    script,
    worker,
    failures,
    executables,
    load: {
      type: "load" as const,
      playbackId: "item",
      source: `http://127.0.0.1:${(source.address() as { port: number }).port}/input`,
    },
  };
}

test("a malformed encoder fails only its owner", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  writeFileSync(
    f.script,
    "#!couch-test-node\nprocess.stdout.write(Buffer.alloc(64, 120)); setInterval(() => {}, 1000);\n",
  );
  const healthy: PlayerState[] = [];
  const group = f.audio.group("healthy", (state) => healthy.push(state));
  group.send({ ...f.load, paused: true });
  await until(() => healthy.length > 0);
  const bad = f.audio.group("bad", (state) => f.states.push(state));
  bad.members([{ deviceId: "unconnected", level: 100 }]);
  bad.send(f.load);
  await until(() => f.states.some((state) => state.status === "error"));
  assert.match(f.states.at(-1)!.error!, /broken Ogg stream/);
  assert.deepEqual(f.failures, [], "an encoder parser failure must never become a worker error");
  assert.equal(
    healthy.some((state) => state.status === "error"),
    false,
    "the other programme must not fail",
  );
  await until(() => f.executables.active().length === 0);
  group.send({ ...f.load, paused: true, startPosition: 4 });
  await until(() => healthy.at(-1)?.position === 4);
  assert.equal(
    healthy.at(-1)!.status,
    "paused",
    "an independent group remains usable after the malformed encoder",
  );
  assert.notEqual(f.worker.threadId, -1, "the shared worker survives");
});
