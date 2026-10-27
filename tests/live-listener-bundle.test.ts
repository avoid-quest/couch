import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { calibration } from "./fixtures/live-listener";

// Run after bun run build. Execute the actual Vite output, not a second test-only build.
const assets = new URL("../dist/assets/", import.meta.url);
const bundle = (prefix: string) => {
  const name = readdirSync(assets).find(name => name.startsWith(prefix + "-") && name.endsWith(".js"));
  if (!name) throw new Error(`Run bun run build first: missing ${prefix}`);
  return readFileSync(new URL(name, assets), "utf8");
};

test("Vite emits an executable worklet and separate calibration worker without unresolved imports", () => {
  let Processor: new (options: unknown) => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
  runInNewContext(bundle("listener-worklet"), {
    sampleRate: 48000, currentFrame: 0,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage() {} }; },
    registerProcessor: (name: string, processor: typeof Processor) => { expect(name).toBe("couch-live"); Processor = processor; },
  });
  const node = new Processor!({ processorOptions: { calibration: calibration() } });
  expect(node.process([], [[new Float32Array(128), new Float32Array(128)]])).toBe(true);
  // Date.now advances synthetically: this checks that the shipped worker can run its calibration,
  // without spending wall-clock CPU on a timing benchmark during an unrelated hardware run.
  let time = 0, measured: unknown;
  const scope = { onmessage: null as null | ((event: { data: object }) => void),
    postMessage: (data: unknown) => { measured = data; }, Date: { now: () => time += 13 } };
  runInNewContext(bundle("calibration-worker"), scope);
  scope.onmessage!({ data: { sampleRate: 48000, quantum: 128 } });
  expect(measured).toMatchObject({ quantum: 128, interp: { costMs: { sinc: expect.any(Number), hermite: expect.any(Number) } }, stretch: { costMs: expect.any(Number) } });
});

test("the emitted network worker opens bundled Opus WASM and transfers decoded audio", async () => {
  const messages: unknown[] = [], audio: { frames: number; data: Float32Array }[] = [];
  let finish!: () => void;
  const decoded = new Promise<void>(resolve => { finish = resolve; });
  let socket: { onmessage: (event: { data: string | ArrayBuffer }) => void };
  const scope = { onmessage: null as null | ((event: { data: object }) => void), postMessage: (data: unknown) => messages.push(data),
    performance, TextDecoder, TextEncoder, Uint8Array, Float32Array, ArrayBuffer, DataView,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    WebSocket: class {
      readyState = 1;
      constructor() { socket = this as unknown as typeof socket; }
      send() {} close() {}
    },
  };
  runInNewContext(bundle("listener-worker"), scope);
  scope.onmessage!({ data: { type: "start", url: "wss://fixture/api/live/listen", port: {
    postMessage: (m: { type: string; frames: number; data: Float32Array }) => { if (m.type === "audio") { audio.push(structuredClone(m)); finish(); } },
  } } });
  socket!.onmessage({ data: JSON.stringify({ type: "hello", codec: 2, session: "one", leadMs: 40 }) });
  const packet = new ArrayBuffer(27), view = new DataView(packet);
  view.setUint8(0, 2); view.setUint8(1, 2); view.setUint16(2, 960, true);
  new Uint8Array(packet, 24).set([0xf8, 0xff, 0xfe]);
  socket!.onmessage({ data: packet });
  // Await the actual decoder event, bounded by the test timeout. No network is opened.
  await decoded;
  expect(messages).not.toContainEqual(expect.objectContaining({ value: expect.objectContaining({ state: "failed" }) }));
  expect(audio).toHaveLength(1); expect(audio[0]!.frames).toBe(960);
  expect(bundle("PlaybackDevice")).toContain("listener-worklet-");
  expect(bundle("PlaybackDevice")).toContain("calibration-worker-");
  expect(bundle("PlaybackDevice")).toContain("listener-worker-");
});
