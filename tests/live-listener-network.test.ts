import { expect, test } from "bun:test";
import { OpusDecoder } from "opus-decoder";
import { ListenerNetwork } from "../src/client/session/live-listener/network";
import type { ProcessorMessage, WorkerEvent } from "../src/client/session/live-listener/types";
import { networkRuntime, pcm } from "./fixtures/live-network";

function fixture() {
  const runtime = networkRuntime(), messages: ProcessorMessage[] = [], events: WorkerEvent[] = [];
  const network = new ListenerNetwork({ url: "wss://fixture/api/live/listen", auth: { type: "auth", token: "fixture" } }, {
    postMessage: (m, transfer) => messages.push(structuredClone(m, transfer ? { transfer } : undefined)),
  }, event => events.push(event), runtime.runtime);
  return { ...runtime, messages, events, network };
}

test("authentication precedes ping; reconnect backs off and a session or epoch change resets", () => {
  const f = fixture(); f.network.start();
  let ws = f.sockets[0]!;
  ws.onopen?.(new Event("open"));
  expect(ws.sent[0]).toEqual({ type: "auth", token: "fixture" });
  expect(ws.sent[1]!.type).toBe("ping");
  ws.text({ type: "hello", session: "one", epoch: 1, codec: 1, leadMs: 40 });
  expect(f.messages.filter(m => m.type === "reset")).toHaveLength(1);
  ws.disconnect(1006);
  expect(f.events.at(-1)).toEqual({ type: "state", value: { state: "reconnecting" } });
  expect(f.timeouts[0]!.ms).toBe(250);
  f.timeouts.shift()!.fn(); ws = f.sockets.at(-1)!; ws.disconnect(1006);
  expect(f.timeouts[0]!.ms).toBe(500);
  f.timeouts.shift()!.fn(); ws = f.sockets.at(-1)!;
  ws.text({ type: "hello", session: "one", epoch: 1, codec: 1, leadMs: 40 });
  expect(f.messages.filter(m => m.type === "reset")).toHaveLength(1);
  ws.text({ type: "hello", session: "one", epoch: 2, codec: 1, leadMs: 40 });
  expect(f.messages.filter(m => m.type === "reset")).toHaveLength(2);
  ws.text({ type: "hello", session: "two", epoch: 2, codec: 1, leadMs: 40 });
  expect(f.messages.filter(m => m.type === "reset")).toHaveLength(3);
  ws.disconnect(1006); expect(f.timeouts[0]!.ms).toBe(250);
  f.network.stop(); expect(f.timeouts).toHaveLength(0); expect(f.intervals).toHaveLength(0);
});

test("removal and revocation are terminal, malformed audio fails without retries", () => {
  for (const code of [4001, 4003, 1008]) {
    const f = fixture(); f.network.start(); f.sockets[0]!.disconnect(code, "Host decision");
    expect(f.events.at(-1)).toEqual({ type: "state", value: { state: code === 4001 ? "removed" : "failed", reason: "Host decision" } });
    expect(f.timeouts).toHaveLength(0); expect(f.intervals).toHaveLength(0);
  }
  const f = fixture(); f.network.start();
  f.sockets[0]!.audio(new ArrayBuffer(2));
  expect(f.events.at(-1)).toMatchObject({ type: "state", value: { state: "failed" } });
  expect(f.timeouts).toHaveLength(0);
});

test("first audio flushes immediately and the third pong flushes waiting readiness", () => {
  const f = fixture(); f.network.start(); const ws = f.sockets[0]!;
  ws.text({ type: "hello", session: "one", codec: 1, leadMs: 40 });
  ws.audio(pcm(0, 0));
  const first = f.messages.at(-1)!;
  expect(first.type).toBe("audio");
  if (first.type === "audio") { expect(first.frames).toBe(128); expect(first.capture?.slope).toBe(0.048); expect(first.ready).toBe(false); }
  ws.audio(pcm(128, 128 / 0.048));
  for (let i = 0; i < 3; i++) { f.time(i * 50); ws.text({ type: "pong", t: i * 50, s: i * 50_000 }); }
  const ready = f.messages.at(-1)!;
  expect(ready.type).toBe("audio");
  if (ready.type === "audio") { expect(ready.ready).toBe(true); expect(ready.server?.slope).toBe(1); }
  expect(f.messages.some(m => m.type === "clock")).toBe(false);
  const lead = { type: "lead", leadMs: 60, atServerUs: 1e6 };
  ws.text(lead); expect(f.messages.at(-1)).toEqual(lead);
  f.network.stop();
});

test("npm OpusDecoder decodes synchronously once its WASM is ready", async () => {
  const decoder = new OpusDecoder({ sampleRate: 48000, channels: 2 });
  await decoder.ready;
  try {
    // RFC 6716 comfort-silence packet, one 20 ms stereo-capable frame.
    const result = decoder.decodeFrame(new Uint8Array([0xf8, 0xff, 0xfe]));
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.errors).toHaveLength(0);
    expect(result.samplesDecoded).toBe(960);
    expect(result.channelData).toHaveLength(2);
    expect(result.channelData.every(c => c.every(Number.isFinite))).toBe(true);
  } finally { decoder.free(); }
});

test("a decoder that opens after an epoch change is freed and never publishes old audio", async () => {
  const f = fixture();
  let release!: () => void, freed = 0, decoded = 0;
  f.runtime.decoder = () => ({ ready: new Promise<void>(resolve => { release = resolve; }), free: () => { freed++; }, decodeFrame: () => {
    decoded++; throw new Error("Old decoder was used");
  } });
  f.network.start(); const ws = f.sockets[0]!;
  ws.text({ type: "hello", session: "one", codec: 2, leadMs: 40 });
  const packet = new ArrayBuffer(27), view = new DataView(packet);
  view.setUint8(0, 2); view.setUint8(1, 2); view.setUint16(2, 960, true);
  new Uint8Array(packet, 24).set([0xf8, 0xff, 0xfe]); ws.audio(packet);
  ws.text({ type: "hello", session: "two", codec: 1, leadMs: 40 });
  release(); await Promise.resolve();
  expect(freed).toBe(1); expect(decoded).toBe(0);
  expect(f.messages.filter(m => m.type === "audio")).toHaveLength(0);
  f.network.stop();
});
