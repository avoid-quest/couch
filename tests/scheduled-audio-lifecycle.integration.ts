import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import type { PlayerState } from "../src/shared/protocol";

test("retired FFmpeg stderr, error and close cannot change the replacement programme", async t => {
  const cp = process.getBuiltinModule("node:child_process");
  const children: (ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdio: PassThrough[] })[] = [];
  const spawn = cp.spawn;
  cp.spawn = (() => {
    const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough(), stdio: [new PassThrough(), new PassThrough(), new PassThrough(), new PassThrough()], kill: () => true });
    children.push(child); return child;
  }) as typeof spawn;
  syncBuiltinESMExports();
  const source = createServer((_request, response) => response.end("synthetic source"));
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const states: PlayerState[] = [], errors: string[] = [];
  let requested!: () => void;
  const started = () => new Promise<void>(resolve => { requested = resolve; });
  const audio = createScheduledAudio({ name: "Run ownership", admit: () => false, changed() {}, ffmpeg: async () => { queueMicrotask(() => requested()); return "synthetic-ffmpeg"; }, logError: (_id, _source, error) => errors.push(error) });
  const group = audio.group("programme", state => states.push(state));
  t.after(async () => {
    group.close(); const closing = audio.close();
    for (const child of children) child.emit("close", 0);
    await closing;
    cp.spawn = spawn; syncBuiltinESMExports();
    source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(source.address() as { port: number }).port}/input`;
  group.members([{ deviceId: "unconnected", level: 100 }]);
  const a = started(); group.send({ type: "load", playbackId: "A", source: url }); await a;
  // Flush the source/helper continuation, using the actual module's state publication.
  while (!children.length) await new Promise(resolve => setImmediate(resolve));
  children[0]!.stderr.write("Duration: 00:00:12.00\n");
  group.members([{ deviceId: "unconnected", level: 90 }]);
  assert.equal(states.at(-1)!.duration, 12, "current run metadata remains valid");
  const b = started(); group.send({ type: "load", playbackId: "B", source: url, radio: true }); await b;
  while (children.length < 2) await new Promise(resolve => setImmediate(resolve));
  children[0]!.stderr.write("Duration: 00:09:59.00\n");
  children[0]!.emit("error", new Error("retired error")); children[0]!.emit("close", 1);
  group.members([{ deviceId: "unconnected", level: 80 }]);
  assert.equal(states.at(-1)!.playbackId, "B");
  assert.equal(states.at(-1)!.duration, null, "A's late Duration must not become B's duration");
  assert.equal(states.at(-1)!.seekable, false);
  assert.deepEqual(errors, []);
  children[1]!.stderr.write("Duration: 00:00:25.00\n");
  group.members([{ deviceId: "unconnected", level: 70 }]);
  assert.equal(states.at(-1)!.duration, 25);
  assert.equal(states.at(-1)!.seekable, false, "current radio metadata retains its seekability");
  children[1]!.emit("close", 1);
  assert.equal(states.at(-1)!.status, "error");
  assert.equal(errors.length, 1, "a current nonzero close still fails its own programme");
});
