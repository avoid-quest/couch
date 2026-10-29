import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduledCapture } from "../src/server/scheduled-capture";

const until = async (check: () => boolean) => { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error("Capture output did not arrive"); await new Promise(resolve => setTimeout(resolve, 10)); } };

test("a streaming encoder makes progress with 50 ms of input without waiting for a large raw-demux packet", async t => {
  const errors: string[] = [], wires = new Set<string>();
  const source = createScheduledCapture(async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", error => errors.push(error));
  t.after(() => source.close());
  source.subscribe(event => { if (event.type === "chunk") wires.add(event.wire); });
  for (let sequence = 0; sequence < 5; sequence++) assert.equal(source.write({ generation: "short", sequence,
    samplePosition: sequence * 480, capturedAtUs: 1_000_000 + sequence * 10_000,
    sampleRate: 48000, channels: 2, pcm: new Float32Array(960).fill(.25) }), true);
  await until(() => errors.length > 0 || wires.size === 2);
  assert.deepEqual(errors, []);
  assert.deepEqual([...wires].sort(), ["opus", "pcm"]);
});

test("a bounded browser capture gap becomes silence without ending the source", async t => {
  const errors: string[] = [], pcm: Buffer[] = [];
  const source = createScheduledCapture(async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", error => errors.push(error));
  t.after(() => source.close());
  source.subscribe(event => { if (event.type === "chunk" && event.wire === "pcm") pcm.push(event.data); });
  for (let sequence = 0; sequence < 120; sequence++) {
    if (sequence === 2) continue; // The browser worker reports the skipped sample position.
    assert.equal(source.write({ generation: "gap", sequence, samplePosition: sequence * 480,
      capturedAtUs: 1_000_000 + sequence * 10_000, sampleRate: 48000, channels: 2,
      pcm: new Float32Array(960).fill(.25) }), true);
  }
  await until(() => errors.length > 0 || Buffer.concat(pcm).length > 1440 * 4 + 1);
  assert.deepEqual(errors, []);
  const bytes = Buffer.concat(pcm);
  assert.equal(bytes.readInt16LE(960 * 4), 0);
  assert.equal(bytes.readInt16LE(1439 * 4), 0);
  assert.equal(bytes.readInt16LE(1440 * 4), 8192);
});

test("FFmpeg converts native mono/stereo rates to PCM and Opus and retires old capture generations", { timeout: 15_000 }, async t => {
  const errors: string[] = [], output: { wire: string; at: number; duration: number; data: Buffer; generation: number }[] = [];
  let generation = 0;
  const source = createScheduledCapture(async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", error => errors.push(error));
  t.after(() => source.close());
  source.subscribe(event => { if (event.type === "chunk") output.push({ ...event, generation }); });
  for (const [sampleRate, channels] of [[44100, 1], [48000, 2]] as const) {
    const origin = 1_000_000 + generation * 10_000_000;
    const count = 180, frames = sampleRate / 100;
    for (let sequence = 0; sequence < count; sequence++) {
      // An intentionally non-nominal source clock checks that deadlines use the
      // measured block times, not a new clock synthesized from encoded samples.
      assert.equal(source.write({ generation: `capture-${generation}`, sequence, samplePosition: sequence * frames, capturedAtUs: origin + sequence * 10_010,
        sampleRate, channels, pcm: Float32Array.from({ length: frames * channels }, (_, i) => channels === 1 || i % 2 === 0 ? .25 : -.5) }), true);
    }
    await until(() => errors.length > 0 || ["pcm", "opus"].every(wire => output.filter(chunk => chunk.generation === generation && chunk.wire === wire).length >= 80));
    assert.deepEqual(errors, []);
    const pcm = output.filter(chunk => chunk.generation === generation && chunk.wire === "pcm");
    const opus = output.filter(chunk => chunk.generation === generation && chunk.wire === "opus");
    assert.ok(pcm.length && opus.length);
    assert.ok(opus.every(chunk => chunk.duration === 5_000), "Live Opus uses 5 ms frames");
    assert.equal(pcm[0]!.at, origin);
    assert.ok(opus[0]!.at < origin, "Opus pre-skip maps before the first captured sample");
    const last = pcm.at(-1)!;
    // Times follow each 10 ms block's measured capture time; a 5 ms chunk may start mid-block.
    const position = (pcm.length - 1) * 5_000, block = Math.floor(position / 10_000);
    assert.equal(last.at, origin + block * 10_010 + position - block * 10_000, "capture time mapping survives source clock drift");
    const bytes = Buffer.concat(pcm.map(chunk => chunk.data));
    // Skip converter startup and inspect native channel order/mono upmix.
    assert.equal(bytes.readInt16LE(4096), channels === 1 ? Math.round(8192 / Math.SQRT2) : 8192);
    assert.equal(bytes.readInt16LE(4098), channels === 1 ? bytes.readInt16LE(4096) : -16384);
    generation++;
  }
  assert.equal(source.write({ generation: "capture-1", sequence: 180, samplePosition: 180 * 480, capturedAtUs: 0,
    sampleRate: 44100, channels: 2, pcm: new Float32Array(960) }), false, "an unannounced input format change is rejected");
});
