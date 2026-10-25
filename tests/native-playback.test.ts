import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { prepareNativePlayback } from "../app/native-playback";

const helper = (scenario = "normal") => spawn(process.execPath, [process.cwd() + "/tests/fixtures/native-playback-helper.mjs", scenario], { stdio: ["pipe", "pipe", "pipe"] });
const until = async (ready: () => boolean) => { for (let n = 0; n < 100 && !ready(); n++) await sleep(10); assert(ready()); };

test("native output preserves PCM/deadlines, controls and acknowledged frame accounting", async () => {
  const child = helper(), events: Record<string, unknown>[] = [], failures: Error[] = [];
  const output = await prepareNativePlayback(child, error => failures.push(error), event => events.push(event));
  try {
    assert.equal(output.format.maxQueueUs, 20500);
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    output.setVolume(73); output.setMuted(true);
    const expectedNativeTarget = Number(process.hrtime.bigint() / 1000n) + 50000;
    output.write(pcm, performance.now() * 1000 + 50000);
    await until(() => events.some(event => event.event === "write"));
    const packet = events.find(event => event.event === "fixture-packet")!;
    assert.equal(packet.pcm, pcm.toString("base64"));
    assert.equal(packet.sequence, 0);
    assert(Math.abs(Number(packet.target) - expectedNativeTarget) < 2000, "preserved mapped deadline");
    assert.deepEqual(events.filter(event => event.event === "fixture-control").map(({ op, value }) => [op, value]), [[1, 73], [2, 1]]);
    await output.stop();
    const closed = events.find(event => event.event === "closed")!;
    assert.equal(closed.receivedFrames, 2); assert.equal(closed.writtenFrames, 2);
    assert.deepEqual(failures, []);
  } finally { await output.stop(); }
});

for (const scenario of ["wrong-rate", "trivial"]) test(`rejects ${scenario} preparation and retires its child`, async () => {
  const child = helper(scenario), failures: Error[] = [];
  await assert.rejects(prepareNativePlayback(child, error => failures.push(error)));
  assert.equal(failures.length, 1); assert.notEqual(child.exitCode, null);
});

for (const scenario of ["bad-sequence", "bad-frames"]) test(`rejects ${scenario} acknowledgement`, async () => {
  const child = helper(scenario), failures: Error[] = [];
  const output = await prepareNativePlayback(child, error => failures.push(error));
  output.write(Buffer.alloc(8), performance.now() * 1000 + 50000);
  await output.closed;
  assert.match(failures[0]!.message, /PCM order/);
  assert.throws(() => output.write(Buffer.alloc(8), performance.now() * 1000 + 50000), /stopped/);
});

test("abort before readiness closes the owned child without reporting a playback failure", async () => {
  const child = helper("wait"), abort = new AbortController(), failures: Error[] = [];
  const pending = prepareNativePlayback(child, error => failures.push(error), undefined, abort.signal);
  abort.abort();
  await assert.rejects(pending, /stopped/);
  assert.notEqual(child.exitCode, null); assert.deepEqual(failures, []);
});

test("partial PCM frames fail without reaching the helper", async () => {
  const events: Record<string, unknown>[] = [], failures: Error[] = [];
  const output = await prepareNativePlayback(helper(), error => failures.push(error), event => events.push(event));
  assert.throws(() => output.write(Buffer.alloc(3), performance.now() * 1000 + 50000), /Invalid/);
  await output.closed;
  assert.equal(failures.length, 1); assert(!events.some(event => event.event === "write"));
});

test("a stalled output cannot grow its PCM pipe without bound", async () => {
  const failures: Error[] = [];
  const output = await prepareNativePlayback(helper("blocked"), error => failures.push(error));
  assert.throws(() => {
    for (let i = 0; i < 1000; i++) output.write(Buffer.alloc(8192), performance.now() * 1000 + 50000);
  }, /cannot keep up/);
  await output.closed;
  assert.equal(failures.length, 1);
});
