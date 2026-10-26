import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledCapture } from "../src/server/scheduled-capture";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const packet = (generation: string, capturedAtUs = serverNowUs()) => ({ generation, sequence: 0, samplePosition: 0, capturedAtUs,
  sampleRate: 48000, channels: 2 as const, pcm: Float32Array.from({ length: 960 }, (_, i) => i % 2 ? -.25 : .25) });

test("Live capture emits immediate stereo PCM while the encoder lookup is pending", t => {
  const errors: string[] = [];
  const source = createScheduledCapture({ intent: "live" }, () => new Promise<string>(() => {}), error => errors.push(error));
  t.after(() => source.close());
  const events: Parameters<Parameters<typeof source.subscribe>[0]>[0][] = [];
  source.subscribe(event => events.push(event));
  const capturedAtUs = serverNowUs();
  assert.equal(source.write({ generation: "wire-fixture", sequence: 0, samplePosition: 0, capturedAtUs,
    sampleRate: 48000, channels: 2, pcm: Float32Array.from({ length: 256 }, (_, i) => i % 2 ? -.25 : .25) }), true);
  assert.deepEqual(errors, []);
  assert.equal(events[0]?.type, "reset");
  const chunks = events.filter(event => event.type === "chunk");
  assert.equal(chunks.length, 1, "normalized capture must emit once before FFmpeg resolves");
  const chunk = chunks[0]!;
  assert.equal(chunk.wire, "pcm");
  assert.equal(chunk.at, capturedAtUs + 100_000);
  assert.equal(chunk.data.length, 127 * 4, "normalization retains its interpolation sample");
  assert.equal(chunk.duration, 127 / 48000 * 1e6);
  for (let offset = 0; offset < chunk.data.length; offset += 4) {
    assert.equal(chunk.data.readInt16LE(offset), 8192);
    assert.equal(chunk.data.readInt16LE(offset + 2), -8192);
  }
});

test("encoder startup never replays immediate PCM and retains its FFmpeg lease through close", { timeout: 5000 }, async t => {
  const children: { child: ReturnType<typeof childProcess.spawn>; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    children.push({ child, closed: new Promise(resolve => child.once("close", () => resolve())) });
    return child;
  });
  syncBuiltinESMExports();
  let released = 0;
  const helper = Promise.withResolvers<{ path: string; release: () => void }>();
  const errors: string[] = [], pcm: Buffer[] = [];
  const source = createScheduledCapture({ intent: "live" }, () => helper.promise, error => errors.push(error));
  t.after(async () => {
    source.close();
    await Promise.all(children.map(child => child.closed));
    observer.mock.restore(); syncBuiltinESMExports();
    for (const { child } of children) if (child.pid) assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
  });
  source.subscribe(event => { if (event.type === "chunk" && event.wire === "pcm") pcm.push(event.data); });
  assert.equal(source.write(packet("startup")), true);
  const immediate = [...pcm];
  assert.equal(immediate.length, 2);
  assert.equal(Buffer.concat(immediate).length, 479 * 4);
  helper.resolve({ path: process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", release: () => { released++; } });
  await sleep(10);
  assert.equal(children.length, 1, "the retained Opus encoder actually launched");
  assert.deepEqual(pcm, immediate, "draining encoder input cannot emit PCM again");
  assert.equal(released, 0, "the running encoder holds its executable");
  source.close();
  await children[0]!.closed;
  assert.equal(released, 1);
  assert.deepEqual(errors, []);
});

test("reset and close retire unresolved encoders and release each stale helper lease", async () => {
  const helpers = [Promise.withResolvers<{ path: string; release: () => void }>(), Promise.withResolvers<{ path: string; release: () => void }>()];
  let requested = 0, released = 0;
  const errors: string[] = [], resets: number[] = [], pcm: number[] = [];
  const source = createScheduledCapture({ intent: "live" }, () => helpers[requested++]!.promise, error => errors.push(error));
  try {
    source.subscribe(event => {
      if (event.type === "reset") resets.push(pcm.length);
      if (event.type === "chunk" && event.wire === "pcm") pcm.push(event.data.readInt16LE(0));
    });
    assert.equal(source.write(packet("first")), true);
    assert.equal(requested, 1, "the first generation adopts its unresolved prewarm");
    assert.equal(source.write({ ...packet("second"), pcm: new Float32Array(960).fill(-.5) }), true);
    assert.equal(requested, 2);
    assert.deepEqual(resets, [0, 2]);
    assert.deepEqual(pcm, [8192, 8192, -16384, -16384]);
    source.close();
    helpers.forEach(helper => helper.resolve({ path: "/unused/stale-encoder", release: () => { released++; } }));
    await Promise.resolve();
    assert.equal(released, 2, "stale helpers never spawn and release exactly once");
    assert.equal(source.write(packet("closed")), false);
    assert.deepEqual(errors, []);
  } finally { source.close(); }
});

test("encoder lookup failure explicitly ends both wires instead of silently abandoning PCM", async () => {
  const helper = Promise.withResolvers<string>(), errors: string[] = [];
  const source = createScheduledCapture({ intent: "live" }, () => helper.promise, error => errors.push(error));
  const events: Parameters<Parameters<typeof source.subscribe>[0]>[0][] = [];
  try {
    source.subscribe(event => events.push(event));
    assert.equal(source.write(packet("failure")), true);
    assert.equal(events.filter(event => event.type === "chunk").length, 2);
    helper.reject(new Error("encoder unavailable"));
    await Promise.resolve();
    assert.deepEqual(errors, ["encoder unavailable"]);
    assert.deepEqual(events.at(-1), { type: "error", error: "encoder unavailable" });
    const before = events.length;
    assert.equal(source.write(packet("after-failure")), false);
    await Promise.resolve();
    assert.equal(events.length, before);
  } finally { source.close(); }
});

test("a reset during PCM delivery cannot enqueue retired samples into the replacement encoder", { timeout: 5000 }, async t => {
  const pipes: { writes: Buffer[]; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args), writes: Buffer[] = [];
    pipes.push({ writes, closed: new Promise(resolve => child.once("close", () => resolve())) });
    const write = child.stdin!.write;
    t.mock.method(child.stdin!, "write", function (this: NonNullable<typeof child.stdin>, ...values: Parameters<typeof write>) {
      writes.push(Buffer.from(values[0])); return write.apply(this, values);
    });
    return child;
  });
  syncBuiltinESMExports();
  const helpers = [Promise.withResolvers<string>(), Promise.withResolvers<string>()];
  let lookups = 0, replaced = false;
  const errors: string[] = [];
  const source = createScheduledCapture({ intent: "live" }, () => helpers[lookups++]!.promise, error => errors.push(error));
  t.after(async () => { source.close(); await Promise.all(pipes.map(pipe => pipe.closed)); observer.mock.restore(); syncBuiltinESMExports(); });
  source.subscribe(event => {
    if (event.type === "chunk" && event.wire === "pcm" && !replaced) {
      replaced = true;
      source.write({ ...packet("replacement"), pcm: new Float32Array(960).fill(-.5) });
    }
  });
  assert.equal(source.write(packet("retired")), true);
  assert.equal(lookups, 2);
  helpers.forEach(helper => helper.resolve(process.env.COUCH_TEST_FFMPEG ?? "ffmpeg"));
  await sleep(10);
  assert.equal(pipes.length, 1);
  const input = Buffer.concat(pipes[0]!.writes).subarray(58);
  assert.equal(input.length, 479 * 8, "only the replacement generation enters FFmpeg");
  for (let offset = 0; offset < input.length; offset += 4) assert.equal(input.readFloatLE(offset), -.5);
  assert.deepEqual(errors, []);
});

test("a same-generation write during PCM delivery keeps encoder input in capture order", { timeout: 5000 }, async t => {
  const pipes: { writes: Buffer[]; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args), writes: Buffer[] = [];
    pipes.push({ writes, closed: new Promise(resolve => child.once("close", () => resolve())) });
    const write = child.stdin!.write;
    t.mock.method(child.stdin!, "write", function (this: NonNullable<typeof child.stdin>, ...values: Parameters<typeof write>) {
      writes.push(Buffer.from(values[0])); return write.apply(this, values);
    });
    return child;
  });
  syncBuiltinESMExports();
  const helper = Promise.withResolvers<string>(), errors: string[] = [];
  let appended = false;
  const source = createScheduledCapture({ intent: "live" }, () => helper.promise, error => errors.push(error));
  t.after(async () => { source.close(); await Promise.all(pipes.map(pipe => pipe.closed)); observer.mock.restore(); syncBuiltinESMExports(); });
  const first = { ...packet("ordered"), pcm: new Float32Array(960).fill(.25) };
  source.subscribe(event => {
    if (event.type === "chunk" && event.wire === "pcm" && !appended) {
      appended = true;
      source.write({ ...first, sequence: 1, samplePosition: 480, capturedAtUs: first.capturedAtUs + 10_000, pcm: new Float32Array(960).fill(-.5) });
    }
  });
  assert.equal(source.write(first), true);
  helper.resolve(process.env.COUCH_TEST_FFMPEG ?? "ffmpeg");
  await sleep(10);
  assert.equal(pipes.length, 1);
  const input = Buffer.concat(pipes[0]!.writes).subarray(58);
  for (let offset = 0; offset < 479 * 8; offset += 4) assert.equal(input.readFloatLE(offset), .25, "the complete first block precedes the second");
  assert.equal(input.readFloatLE(input.length - 4), -.5);
  assert.deepEqual(errors, []);
});
