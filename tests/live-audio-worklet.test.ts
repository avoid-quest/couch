// Exact capture worklet source, synthetic graph blocks only: no audio device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test, type TestContext } from "node:test";
import { runInNewContext } from "node:vm";

const browserSource = readFileSync(new URL("./audio-lab/ingress-browser.ts", import.meta.url), "utf8");
const worklet = browserSource.match(/const worklet = `([\s\S]*?)`;/)?.[1];
assert(worklet, "Test must run the actual browser worklet source");

type Packet = { buffer: ArrayBuffer; first: number; dropped: number; discontinuities?: number; missingSamples?: number;
  discardedSamples?: number; emptyInputBlocks?: number; quantumFrames?: number };
function capture(packetMs: 10 | 20) {
  const packets: Packet[] = [];
  let Processor: any;
  const port = {
    onmessage: undefined as ((event: { data: string }) => void) | undefined,
    postMessage(packet: Packet, transfer: ArrayBuffer[]) { packets.push(structuredClone(packet, { transfer })); },
  };
  const scope = { currentFrame: 0, AudioWorkletProcessor: class { port = port; }, registerProcessor(_name: string, processor: any) { Processor = processor; } };
  runInNewContext(worklet!, scope);
  const processor = new Processor({ processorOptions: { frames: packetMs * 48 } });
  function block(frame: number, present = true, acknowledge = true) {
    scope.currentFrame = frame;
    const input = Float32Array.from({ length: 128 }, (_, index) => (frame + index) / 32768);
    const count = packets.length;
    processor.process(present ? [[input]] : [[]], [[new Float32Array(128)]]);
    if (acknowledge) for (let index = count; index < packets.length; index++) port.onmessage!({ data: "ack" });
  }
  return { block, packets, ack: () => port.onmessage!({ data: "ack" }) };
}

function assertSamples(packets: Packet[], packetMs: number) {
  for (const packet of packets) {
    assert.equal(packet.buffer.byteLength, 16 + packetMs * 48 * 4);
    const pcm = new DataView(packet.buffer);
    // Each input sample has a unique, exactly representable value. These short
    // positive ramps quantize to the literal graph-frame number in both ears.
    for (let sample = 0; sample < packetMs * 48; sample++) {
      assert.equal(pcm.getInt16(16 + sample * 4, true), packet.first + sample);
      assert.equal(pcm.getInt16(18 + sample * 4, true), packet.first + sample);
    }
  }
}

for (const packetMs of [10, 20] as const) test(`${packetMs} ms packets accumulate 128-frame graph blocks without shifting sample indices`, () => {
  const f = capture(packetMs);
  for (let frame = 0; frame < 3840; frame += 128) f.block(frame);
  assert.deepEqual(f.packets.map(packet => packet.first), packetMs === 10 ? [0, 480, 960, 1440, 1920, 2400, 2880, 3360] : [0, 960, 1920, 2880]);
  assertSamples(f.packets, packetMs);
});

for (const packetMs of [10, 20] as const) for (const gap of ["empty input", "skipped graph callback"]) test(`${packetMs} ms capture preserves the original packet grid across ${gap}`, () => {
  const f = capture(packetMs);
  for (let frame = 0; frame < 3840; frame += 128) {
    if (frame === 1152 && gap === "skipped graph callback") continue;
    f.block(frame, frame !== 1152);
  }
  assert.deepEqual(f.packets.map(packet => packet.first), packetMs === 10 ? [0, 480, 1440, 1920, 2400, 2880, 3360] : [0, 1920, 2880]);
  assert.equal(f.packets.at(-1)!.discontinuities, 1);
  assert.equal(f.packets.at(-1)!.missingSamples, 128);
  assert.equal(f.packets.at(-1)!.discardedSamples, packetMs === 10 ? 352 : 832);
  assert.equal(f.packets.at(-1)!.emptyInputBlocks, gap === "empty input" ? 1 : 0);
  assertSamples(f.packets, packetMs);
});

for (const packetMs of [10, 20] as const) test(`${packetMs} ms capture begins its grid at the first real input frame`, () => {
  const f = capture(packetMs);
  for (let frame = 0; frame < 4096; frame += 128) f.block(frame, frame >= 256);
  assert.deepEqual(f.packets.map(packet => packet.first), packetMs === 10 ? [256, 736, 1216, 1696, 2176, 2656, 3136, 3616] : [256, 1216, 2176, 3136]);
  assert.equal(f.packets.at(-1)!.discontinuities, 0);
  assert.equal(f.packets.at(-1)!.emptyInputBlocks, 2);
  assertSamples(f.packets, packetMs);
});

for (const packetMs of [10, 20] as const) test(`${packetMs} ms capture drops bounded handoff overflow without replay or retiming`, () => {
  const f = capture(packetMs);
  for (let frame = 0; frame < 3840; frame += 128) f.block(frame, true, false);
  assert.equal(f.packets.length, 2);
  f.ack(); f.ack();
  for (let frame = 3840; frame < 5760; frame += 128) f.block(frame, true, false);
  assert.deepEqual(f.packets.map(packet => packet.first), packetMs === 10 ? [0, 480, 3840, 4320] : [0, 960, 3840, 4800]);
  assert.equal(f.packets.at(-1)!.dropped, packetMs === 10 ? 6 : 2);
  assert.equal(f.packets.at(-1)!.discontinuities, 0);
  assertSamples(f.packets, packetMs);
});

async function publisherFixture(t: TestContext) {
  let nowUs = 0, context: any, node: any;
  let interval: (() => void) | undefined;
  const sent: (string | ArrayBuffer)[] = [];
  const track = { stop() {}, addEventListener() {}, getSettings: () => ({ sampleRate: 44100 }) };
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = Socket.OPEN;
    bufferedAmount = 0;
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
    send(data: string | ArrayBuffer) {
      sent.push(data);
      if (typeof data !== "string") return;
      const message = JSON.parse(data);
      const reply = message.type === "auth" ? { type: "ready", packetMs: 10, generation: 7 }
        : message.type === "sync" ? { type: "sync", receivedUs: message.sentUs + 1_000_000, sentServerUs: message.sentUs + 1_000_000 } : null;
      if (reply) queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(reply) })));
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  const scope = {
    window: {} as any, WebSocket: Socket, URL, Blob, setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { interval = callback; return 1; },
    clearInterval: () => { interval = undefined; },
    performance: { now: () => nowUs / 1000 },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    AudioContext: class {
      currentTime = 0; sampleRate = 48_000; destination = {}; audioWorklet = { addModule: async () => {} };
      constructor() { context = this; }
      async resume() {} async close() {} createMediaStreamSource() { return { connect() {} }; }
    },
    AudioWorkletNode: class {
      port = { onmessage: (_event: any) => {}, postMessage() {} };
      constructor() { node = this; }
      connect() {} disconnect() {}
    },
  };
  runInNewContext(stripTypeScriptTypes(browserSource.replace(/^import .*;\n/m, "")), scope);
  const publisher = await scope.window.__ingressLab.publish({ origin: "http://lab", token: "fixture", packetMs: 10 });
  t.after(() => publisher.stop());
  const f = capture(10);
  for (let frame = 0; frame < 512; frame += 128) f.block(frame);
  nowUs = 120_000; context.currentTime = 0.020;
  node.port.onmessage({ data: f.packets[0] });
  return {
    publisher,
    controls: () => sent.filter((message): message is string => typeof message === "string").map(message => JSON.parse(message)),
    audio: () => sent.filter((message): message is ArrayBuffer => typeof message !== "string"),
    tick(elapsedMs: number, phaseUs = 100_000) {
      nowUs = 120_000 + elapsedMs * 1000; context.currentTime = (nowUs - phaseUs) / 1e6; interval?.();
    },
    packet(first: number) { node.port.onmessage({ data: { ...f.packets[0], first, buffer: new ArrayBuffer(1936) } }); },
  };
}

test("publisher measures a fixed acquisition window before sending any PCM, then freezes the observed mapping", async t => {
  const f = await publisherFixture(t);
  assert.equal(f.audio().length, 0, "Do not publish from a single unqualified clock bracket");
  for (let elapsed = 10; elapsed <= 1000; elapsed += 10) f.tick(elapsed, elapsed % 20 ? 99_500 : 100_500);
  assert.equal(f.audio().length, 0, "Acquisition packets must never be replayed");
  assert.equal(f.publisher.snapshot().clockAcquisition.status, "qualified");
  f.packet(48_000);
  const start = f.controls().find(message => message.type === "start");
  assert.equal(start.originUs, 2_100_000);
  assert.equal(start.firstSample, 48_000);
  assert(Math.abs(start.uncertaintyUs - (500 + 128 / 48_000 * 1e6)) < 1e-6);
  for (let index = 1; index < 18; index++) { f.tick(1000 + index * 10); f.packet(48_000 + index * 480); }
  const snapshot = f.publisher.snapshot();
  assert.equal(snapshot.sourceOriginUs, 2_100_000);
  assert.equal(f.controls().filter(message => message.type === "start").length, 1);
  assert.equal(snapshot.publishedSampleStarts.length, 16);
  assert.equal(snapshot.sampleStarts.length, 16);
  assert.equal(f.audio().length, 18);
  assert.deepEqual(f.audio().map(buffer => new DataView(buffer).getFloat64(8, true)), Array.from({ length: 18 }, (_, index) => 48_000 + index * 480));
  assert.equal(snapshot.inputPipelineUncertaintyUs, null);
});

test("render clock bursts exceeding the 10 ms budget fail acquisition without starting the source", async t => {
  const f = await publisherFixture(t);
  for (let elapsed = 10; elapsed <= 1000; elapsed += 10) f.tick(elapsed, elapsed % 20 ? 100_000 : 124_000);
  f.packet(48_000);
  const snapshot = f.publisher.snapshot();
  assert.equal(snapshot.clockAcquisition.status, "unsupported");
  assert(Math.abs(snapshot.clockAcquisition.observedRangeUs - 24_000) < 1e-6);
  assert(snapshot.clockAcquisition.requiredUncertaintyUs > 10_000);
  assert.match(snapshot.error, /10 ms/);
  assert.equal(snapshot.stopped, true);
  assert.equal(f.audio().length, 0);
  assert(!f.controls().some(message => message.type === "start"));
});

test("a clock phase outside the acquired bound stops publication without retiming or widening uncertainty", async t => {
  const f = await publisherFixture(t);
  for (let elapsed = 10; elapsed <= 1000; elapsed += 10) f.tick(elapsed);
  f.packet(48_000);
  const before = f.publisher.snapshot();
  f.tick(1010, 116_000); f.packet(48_480);
  const after = f.publisher.snapshot();
  assert.equal(f.audio().length, 1);
  assert.equal(after.sourceOriginUs, before.sourceOriginUs);
  assert.equal(after.mappingUncertaintyUs, before.mappingUncertaintyUs);
  assert.equal(after.stopped, true);
  assert.match(after.error, /clock.*bound/);
});

test("sparse clock acquisition cannot claim a measured bound", async t => {
  const f = await publisherFixture(t);
  f.tick(1000);
  assert.equal(f.publisher.snapshot().clockAcquisition.status, "unsupported");
  assert.match(f.publisher.snapshot().error, /samples/);
  assert.equal(f.audio().length, 0);
});
