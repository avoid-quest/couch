import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { Identity, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledCapture } from "../src/server/scheduled-capture";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import { opusDuration } from "../src/server/audio-packets";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function at(deadline: number) {
  while (serverNowUs() < deadline) await sleep(Math.max(1, (deadline - serverNowUs()) / 1000));
}

for (const ageMs of [20, 40]) test(`10 ms capture aged ${ageMs} ms retains every Opus interval and does not repeatedly buffer`, { timeout: 5000 }, async t => {
  const errors: string[] = [], chunks: { at: number; received: number; duration: number }[] = [];
  const states: { at: number; status: string; buffering?: boolean }[] = [];
  const source = createScheduledCapture({ intent: "live" }, async () => ffmpeg, error => errors.push(error));
  const core = createScheduledAudio({ identity: Identity.generate().privateB64u, name: "Continuity fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  const group = core.group("continuity", state => states.push({ at: serverNowUs(), status: state.status, buffering: state.buffering }));
  t.after(() => { source.close(); group.close(); core.close(); });
  source.subscribe(event => { if (event.type === "chunk") chunks.push({ at: event.at, received: serverNowUs(), duration: opusDuration(event.data) }); });
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
