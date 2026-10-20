// Exercise the actual runner fragments without starting its audio environment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "bun:test";
import { waitUntil } from "./audio-lab/deadline";

const source = readFileSync(new URL("./live-audio.native.ts", import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "ts" });
function fragment(start: string, end: string) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, "Runner test seam must exist");
  return source.slice(first, last);
}

test("graph completion includes stdout emitted after the direct process exits", async () => {
  const predicate = source.match(/await until\(\(\) => ([^,\n]+), "(?:audio measurement|recorder stdout drain)"/)?.[1];
  assert(predicate, "Test must use the runner's actual graph completion condition");
  const scope: any = { spawn, join, Buffer, performance, waitUntil,
    root: process.cwd(), env: process.env, directory: "/unused", writeFileSync() {}, readFileSync() { return ""; } };
  runInNewContext(transpiler.transformSync(fragment("const processes:", "\nconst command =") +
    `\nglobalThis.launch = launch; globalThis.drain = graph => until(() => ${predicate}, "graph drain", 2000);`), scope);
  // The descendant inherits the pipe, so direct-process exit precedes EOF.
  const child = scope.launch("graph", ["node", "-e", `
    process.stdout.write('first,');
    require('node:child_process').spawn(process.execPath,
      ['-e', "setTimeout(() => process.stdout.write('last'), 250)"],
      { stdio: ['ignore', 1, 2] }).unref();
  `]);
  const closed = once(child, "close");
  let received = "";
  child.stdout.on("data", (chunk: Buffer) => { received += chunk.toString(); });
  try {
    await scope.drain(child);
    assert.equal(child.exitCode, 0);
    assert.equal(received, "first,last", "Final PCM must arrive before analysis finishes");
  } finally { await closed; }
});

test("short final CPU windows preserve the full-window baseline and discover descendants", () => {
  let now = 0, ticks = 0, descendant = false;
  const child = { pid: 42 };
  const scope: any = { performance: { now: () => now }, availableParallelism: () => 4,
    process: { cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 100 }) },
    processes: [child], processNames: new Map([[child, "graph"]]), clockTicks: 100, pageSize: 4096,
    readdirSync: () => descendant ? ["42", "99"] : ["42"],
    readFileSync(path: string) {
      const pid = path.includes("/99/") ? 99 : 42;
      const fields = Array(22).fill("0");
      fields[1] = pid === 99 ? "42" : "1"; fields[2] = String(pid);
      fields[11] = String(ticks); fields[19] = "123"; fields[21] = "1";
      return `${pid} (fixture) ${fields.join(" ")}`;
    } };
  runInNewContext(transpiler.transformSync(fragment("const resources =", "const resourceTimer =") +
    "\nglobalThis.sample = sampleResources; globalThis.resources = resources; globalThis.descendants = observedDescendants;"), scope);
  now = 1000; scope.sample();
  now = 2000; ticks = 100; scope.sample();
  assert.equal(scope.resources.cpuPercentMax, 100);
  now = 2001; ticks = 101; descendant = true; scope.sample();
  assert.equal(scope.descendants.get(99), "123", "Cleanup must still discover descendants during a short window");
  assert.equal(scope.resources.cpuPercentMax, 100, "A quantized tick over 1 ms must not produce a 1000% spike");
  assert.equal(scope.resources.sampleCount, 2);
  now = 3000; ticks = 200; descendant = false; scope.sample();
  assert.equal(scope.resources.cpuPercentMax, 100, "The skipped call must not advance tick or time baselines");
  assert.equal(scope.resources.perProcessGroup.graph.cpuPercentMax, 100);
  assert.equal(scope.resources.sampleCount, 3);
});
