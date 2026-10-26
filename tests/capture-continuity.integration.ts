import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledCapture } from "../src/server/scheduled-capture";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import { opusDuration } from "../src/server/audio-packets";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function at(deadline: number) {
  while (serverNowUs() < deadline) await sleep(Math.max(1, (deadline - serverNowUs()) / 1000));
}

test("live capture prewarms only its header, adopts the first generation and restarts later generations", { timeout: 5000 }, async t => {
  const children: { writes: Buffer[]; child: ReturnType<typeof childProcess.spawn>; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args), writes: Buffer[] = [];
    children.push({ child, writes, closed: new Promise(resolve => child.once("close", () => resolve())) });
    const write = child.stdin!.write;
    t.mock.method(child.stdin!, "write", function (this: NonNullable<typeof child.stdin>, ...values: Parameters<typeof write>) {
      writes.push(Buffer.from(values[0])); return write.apply(this, values);
    });
    return child;
  });
  syncBuiltinESMExports();
  const errors: string[] = [], chunks: { at: number; duration: number; received: number }[][] = [[], []];
  let generation = 0;
  const source = createScheduledCapture({ intent: "live" }, async () => ffmpeg, error => errors.push(error));
  t.after(async () => { source.close(); await Promise.all(children.map(child => child.closed)); observer.mock.restore(); syncBuiltinESMExports(); });
  source.subscribe(event => { if (event.type === "chunk" && event.wire === "opus") chunks[generation]!.push({ at: event.at, duration: event.duration, received: serverNowUs() }); });
  const preparedBy = performance.now() + 1000;
  while (!children.length && performance.now() < preparedBy) await sleep(1);
  assert.equal(children.length, 1, "Live must open its actual encoder before the first PCM packet");
  await sleep(30);
  assert.equal(Buffer.concat(children[0]!.writes).length, 58, "preparation writes one WAV header and no fabricated samples");
  assert.ok(chunks.every(generation => generation.length === 0), "a header-only encoder emits no audio");
  for (generation = 0; generation < 2; generation++) {
    const origin = serverNowUs(), captured = origin - 20_000;
    const left = (generation + 1) / 8, right = -(generation + 1) / 4;
    const pcm = Float32Array.from({ length: 960 }, (_, i) => i % 2 ? right : left);
    for (let sequence = 0; sequence < 12; sequence++) {
      await at(origin + sequence * 10_000);
      assert.equal(source.write({ generation: `prewarm-${generation}`, sequence, samplePosition: sequence * 480,
        capturedAtUs: captured + sequence * 10_000, sampleRate: 48000, channels: 2, pcm }), true);
    }
    const firstDeadline = captured + 100_000 - 2500, lastDeadline = firstDeadline + 10 * 10_000;
    while (chunks[generation]!.length < 11 && serverNowUs() < lastDeadline) await sleep(1);
    assert.equal(chunks[generation]!.length, 11, "all complete packets survive, including each generation's first packet");
    chunks[generation]!.forEach((chunk, index) => {
      assert.equal(chunk.at, firstDeadline + index * 10_000); assert.equal(chunk.duration, 10_000);
      assert.ok(chunk.received < chunk.at, "preparation never moves a deadline to hide startup");
    });
    assert.equal(children.length, generation + 1, "the initial generation adopts the prewarmed child; later generations restart once");
    const encodedInput = Buffer.concat(children[generation]!.writes).subarray(58);
    assert.ok(encodedInput.length > 0 && encodedInput.length % 8 === 0);
    for (let i = 0; i < encodedInput.length; i += 8) {
      assert.equal(encodedInput.readFloatLE(i), left, "prewarm/reset preserves the generation's real left samples");
      assert.equal(encodedInput.readFloatLE(i + 4), right, "prewarm/reset preserves distinct right samples without padding");
    }
  }
  assert.deepEqual(errors, []);
});

test("capture prewarm respects close and replacement while the helper is resolving", { timeout: 5000 }, async t => {
  const children: { child: ReturnType<typeof childProcess.spawn>; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    children.push({ child, closed: new Promise(resolve => child.once("close", () => resolve())) });
    return child;
  });
  syncBuiltinESMExports();
  const errors: string[] = [], sources: ReturnType<typeof createScheduledCapture>[] = [];
  t.after(async () => { sources.forEach(source => source.close()); await Promise.all(children.map(child => child.closed)); observer.mock.restore(); syncBuiltinESMExports(); });
  for (const reject of [false, true]) {
    const helper = Promise.withResolvers<string>();
    let requested = 0;
    const source = createScheduledCapture({ intent: "live" }, () => { requested++; return helper.promise; }, error => errors.push(error));
    sources.push(source);
    assert.equal(requested, 1, "Live requests its helper before PCM");
    source.close();
    if (reject) helper.reject(new Error("closed helper lookup")); else helper.resolve(ffmpeg);
    await sleep(10);
    assert.equal(children.length, 0, "a closed pending prewarm cannot spawn");
    assert.equal(source.error(), undefined, "a closed helper rejection cannot fail the publication");
  }
  let relaxedLookups = 0;
  const relaxed = createScheduledCapture({ intent: "relaxed" }, async () => { relaxedLookups++; return ffmpeg; }, error => errors.push(error));
  sources.push(relaxed);
  await sleep(10); assert.equal(relaxedLookups, 0, "relaxed capture remains lazy");
  const helpers = [Promise.withResolvers<string>(), Promise.withResolvers<string>()];
  let requested = 0;
  const source = createScheduledCapture({ intent: "live" }, () => helpers[requested++]!.promise, error => errors.push(error));
  sources.push(source);
  const captured = serverNowUs() - 20_000;
  const packet = { sequence: 0, samplePosition: 0, capturedAtUs: captured, sampleRate: 48000, channels: 2 as const, pcm: new Float32Array(960) };
  assert.equal(source.write({ ...packet, generation: "initial" }), true);
  assert.equal(requested, 1, "first PCM adopts the unresolved prewarm");
  assert.equal(source.write({ ...packet, generation: "replacement" }), true);
  assert.equal(requested, 2, "a later generation requests a fresh encoder");
  helpers[0]!.resolve(ffmpeg); await sleep(10);
  assert.equal(children.length, 0, "the replaced helper cannot resurrect its child");
  const chunks: number[] = [];
  source.subscribe(event => { if (event.type === "chunk" && event.wire === "opus") chunks.push(event.at); });
  helpers[1]!.resolve(ffmpeg);
  assert.equal(source.write({ ...packet, generation: "replacement", sequence: 1, samplePosition: 480, capturedAtUs: captured + 10_000 }), true);
  const deadline = captured + 100_000 - 2500;
  while (!chunks.length && serverNowUs() < deadline) await sleep(1);
  assert.equal(chunks[0], deadline, "the replacement retains its real first Opus packet");
  chunks.forEach((chunk, index) => assert.equal(chunk, deadline + index * 10_000));
  assert.equal(children.length, 1);
  source.close(); await children[0]!.closed;
  // An already-spawned header-only prewarm must also be reaped without PCM.
  const idle = createScheduledCapture({ intent: "live" }, async () => ffmpeg, error => errors.push(error));
  sources.push(idle);
  const until = performance.now() + 1000;
  while (children.length < 2 && performance.now() < until) await sleep(1);
  assert.equal(children.length, 2);
  idle.close(); await children[1]!.closed;
  assert.deepEqual(errors, []);
});

test("live encoded chunks reach the receiver without waiting for the housekeeping poll", { timeout: 5000 }, async t => {
  const key = Identity.generate(), errors: string[] = [], frames: number[] = [];
  const core = createScheduledAudio({ identity: Identity.generate().privateB64u, name: "Prompt capture fixture", admit: id => id === key.peerId, changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  const group = core.group("prompt", () => {}), server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER], { encryption: { identity: key }, playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [] } });
  client.addAudioChunkListener(at => frames.push(at));
  t.after(async () => { group.close(); core.close(); await client.disconnect(); await new Promise<void>(resolve => sockets.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}/sendspin`, { timeoutMs: 2000 });
  await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 });
  const readyUntil = performance.now() + 1000;
  while (!core.status().timings.some(([id, lead]) => id === key.peerId && lead === 25) && performance.now() < readyUntil) await sleep(5);
  assert.equal(core.connected(key.peerId), true, "the real encrypted receiver identified");
  assert.ok(core.status().timings.some(([id, lead]) => id === key.peerId && lead === 25), "receiver timing reached Core before capture");
  // Hold only the fixed capture's housekeeping callback. Real encoding,
  // encryption, sockets and receiver delivery must still make progress.
  const interval = globalThis.setInterval;
  let held = 0;
  t.mock.method(globalThis, "setInterval", (callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 5) { held++; return interval(() => {}, 60_000); }
    return interval(callback, delay, ...args);
  });
  core.registerSource("capture", { intent: "live" }); group.members([{ deviceId: key.peerId, level: 100 }]);
  group.send({ type: "load", playbackId: "prompt", source: "", liveSourceId: "capture", live: true, intent: "live" });
  const origin = serverNowUs();
  for (let sequence = 0; sequence < 40; sequence++) {
    await at(origin + sequence * 10_000);
    assert.equal(core.writeSource("capture", { generation: "prompt", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10_000 - 10_000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }), true);
  }
  assert.equal(held, 1, "the fixed capture poll was held");
  assert.deepEqual(errors, []);
  assert.ok(frames.length >= 20, `received ${frames.length} chunks while the poll was held`);
  for (let i = 1; i < frames.length; i++) assert.equal(frames[i]! - frames[i - 1]!, 10_000, "prompt sends retain the source's fixed grid");
});

for (const ageMs of [20, 40]) test(`10 ms capture aged ${ageMs} ms retains every Opus interval and does not repeatedly buffer`, { timeout: 5000 }, async t => {
  const errors: string[] = [], chunks: { at: number; received: number; duration: number }[] = [];
  const states: { at: number; status: string; buffering?: boolean }[] = [];
  const source = createScheduledCapture({ intent: "live" }, async () => ffmpeg, error => errors.push(error));
  const core = createScheduledAudio({ identity: Identity.generate().privateB64u, name: "Continuity fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  const group = core.group("continuity", state => states.push({ at: serverNowUs(), status: state.status, buffering: state.buffering }));
  t.after(() => { source.close(); group.close(); core.close(); });
  source.subscribe(event => { if (event.type === "chunk" && event.wire === "opus") chunks.push({ at: event.at, received: serverNowUs(), duration: opusDuration(event.data) }); });
  core.registerSource("capture", { intent: "live" });
  group.send({ type: "load", playbackId: "continuity", source: "", liveSourceId: "capture", live: true, intent: "live" });
  const started = serverNowUs(), captured = started - ageMs * 1000, count = 150;
  for (let sequence = 0; sequence < count; sequence++) {
    await at(started + sequence * 10_000);
    const packet = { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: captured + sequence * 10_000,
      sampleRate: 48000, channels: 2 as const,
      pcm: Float32Array.from({ length: 960 }, (_, i) => .2 * Math.sin(2 * Math.PI * (sequence * 480 + Math.floor(i / 2)) * (i % 2 ? 880 : 440) / 48000)) };
    assert.equal(source.write(packet), true); assert.equal(core.writeSource("capture", packet), true);
  }
  // The encoder's lookahead leaves the final Opus frame incomplete without an
  // EOF flush. All other frames, including startup, must arrive by their deadlines.
  const firstDeadline = captured + 100_000 - 2500; // libopus lowdelay's 120-sample pre-skip.
  const lastDeadline = firstDeadline + (count - 2) * 10_000;
  while (chunks.length < count - 1 && serverNowUs() < lastDeadline) await sleep(1);
  t.diagnostic(JSON.stringify({ ageMs, inputPackets: count, chunks, states }));
  assert.deepEqual(errors, []);
  assert.equal(chunks.length, count - 1, "every complete frame must survive; no startup/warmup exclusion");
  assert.equal(chunks[0]!.at, firstDeadline, "startup cannot silently skip the first frame");
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(chunks[i]!.at, firstDeadline + i * 10_000, "no missing or retimed intervals");
    assert.equal(chunks[i]!.duration, 10_000);
    assert.ok(chunks[i]!.received < chunks[i]!.at, "each frame is emitted before its unchanged deadline");
  }
  const playing = states.findIndex(state => state.status === "playing");
  assert.ok(playing >= 0, "the scheduled group must start");
  assert.ok(states[playing]!.at <= firstDeadline + 20_000, "startup state must track the initial deadline");
  assert.ok(states.slice(playing).every(state => state.status === "playing" && !state.buffering), "no recurring loading after startup while capture continues");
});

test("capture resets open one valid float WAV stream per generation and retain relaxed PCM", { timeout: 5000 }, async t => {
  // Observe the public child-process stdin boundary without substituting FFmpeg
  // or changing its bytes/timing. Each actual encoder must accept the stream.
  const pipes: { writes: Buffer[]; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    const writes: Buffer[] = [];
    pipes.push({ writes, closed: new Promise(resolve => child.once("close", () => resolve())) });
    const write = child.stdin!.write;
    t.mock.method(child.stdin!, "write", function (this: NonNullable<typeof child.stdin>, ...values: Parameters<typeof write>) {
      writes.push(Buffer.from(values[0]));
      return write.apply(this, values);
    });
    return child;
  });
  syncBuiltinESMExports();
  const errors: string[] = [], pcm: Buffer[][] = [[], []], opus: number[][] = [[], []];
  let generation = 0, resets = 0;
  const source = createScheduledCapture({ intent: "relaxed" }, async () => ffmpeg, error => errors.push(error));
  t.after(async () => { source.close(); await Promise.all(pipes.map(pipe => pipe.closed)); observer.mock.restore(); syncBuiltinESMExports(); });
  source.subscribe(event => {
    if (event.type === "reset") resets++;
    if (event.type === "chunk") {
      if (event.wire === "pcm") pcm[generation]!.push(event.data);
      else opus[generation]!.push(event.at);
    }
  });
  for (generation = 0; generation < 2; generation++) {
    const origin = serverNowUs();
    for (let sequence = 0; sequence < 12; sequence++) {
      await at(origin + sequence * 10_000);
      assert.equal(source.write({ generation: `generation-${generation}`, sequence, samplePosition: sequence * 480,
        capturedAtUs: origin + sequence * 10_000 - 20_000, sampleRate: 48000, channels: 2,
        pcm: Float32Array.from({ length: 960 }, (_, index) => index % 2 ? -.5 : .25) }), true);
    }
    const deadline = origin + 1_000_000 - 20_000 - 2500;
    while (opus[generation]!.length < 11 && serverNowUs() < deadline) await sleep(1);
    assert.equal(opus[generation]!.length, 11, "real FFmpeg decodes each generation without losing header-adjacent samples");
    assert.equal(opus[generation]![0], deadline, "relaxed lead and Opus pre-skip remain unchanged");
  }
  assert.deepEqual(errors, []); assert.equal(resets, 2); assert.equal(pipes.length, 2);
  for (let index = 0; index < pipes.length; index++) {
    const bytes = Buffer.concat(pipes[index]!.writes);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF"); assert.equal(bytes.readUInt32LE(4), 0xffffffff);
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    let offset = 12, format: Buffer | undefined, fact: Buffer | undefined;
    while (bytes.toString("ascii", offset, offset + 4) !== "data") {
      const size = bytes.readUInt32LE(offset + 4), chunk = bytes.subarray(offset + 8, offset + 8 + size);
      if (bytes.toString("ascii", offset, offset + 4) === "fmt ") format = chunk;
      if (bytes.toString("ascii", offset, offset + 4) === "fact") fact = chunk;
      offset += 8 + size + size % 2;
    }
    assert.ok(format && fact);
    assert.equal(format.readUInt16LE(0), 3); assert.equal(format.readUInt16LE(2), 2);
    assert.equal(format.readUInt32LE(4), 48000); assert.equal(format.readUInt32LE(8), 384000);
    assert.equal(format.readUInt16LE(12), 8); assert.equal(format.readUInt16LE(14), 32);
    assert.equal(format.readUInt16LE(16), 0); assert.equal(fact.readUInt32LE(0), 0xffffffff);
    assert.equal(bytes.readUInt32LE(offset + 4), 0xffffffff);
    const samples = bytes.subarray(offset + 8), relaxed = Buffer.concat(pcm[index]!);
    assert.equal(relaxed.length, 12 * 480 * 4, "relaxed PCM retains the normalized sample count");
    assert.equal(samples.length, relaxed.length * 2, "exactly one header: no extra framing in PCM payload");
    for (let sample = 0; sample < samples.length / 4; sample++) {
      assert.equal(samples.readFloatLE(sample * 4), sample % 2 ? -.5 : .25);
      assert.equal(relaxed.readInt16LE(sample * 2), sample % 2 ? -16384 : 8192);
    }
  }
});
