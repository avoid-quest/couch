import { test, expect } from "bun:test";
import { SendspinDecoder } from "@sendspin/sendspin-js";
// Maintenance regression for the pinned SDK patch, which intentionally tests this exported module's clock.
import { ClockSource } from "../node_modules/@sendspin/sendspin-js/dist/audio/clock-source.js";

test("output-clock predictions use observation intervals when timestamp sampling jitters", () => {
  const original = globalThis.performance;
  let now = 1000;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
  try {
    const clock = new ClockSource();
    let index = 0;
    const context = { getOutputTimestamp: () => { const at = now - (index++ % 2 ? 25 : 5); return { contextTime: at / 1000 - .02, performanceTime: at }; } } as AudioContext;
    for (let i = 0; i < 25; i++) { now = 1000 + i * 40; clock.getTimestampDerivedTime(now / 1000, context, .02); }
    expect(clock.active).toBe("timestamp");
    expect(clock.lastRejectReason).toBeNull();
  } finally { Object.defineProperty(globalThis, "performance", { configurable: true, value: original }); }
});

test("public decoder preparation survives stream clear and closes at disposal", async () => {
  const original = (globalThis as any).AudioDecoder;
  let supported = 0, decoder: { state: string } | undefined;
  (globalThis as any).AudioDecoder = class {
    state = "unconfigured";
    static async isConfigSupported() { supported++; return { supported: true }; }
    constructor() { decoder = this; }
    configure() { this.state = "configured"; }
    reset() { this.state = "unconfigured"; }
    close() { this.state = "closed"; }
  };
  try {
    const pipeline = new SendspinDecoder(() => {}, () => 0);
    const format = { codec: "opus" as const, sample_rate: 48000, channels: 2, bit_depth: 16 };
    await pipeline.prepare(format); pipeline.clearState(); await pipeline.prepare(format);
    expect(supported).toBe(1); expect(decoder?.state).toBe("configured");
    pipeline.close(); expect(decoder?.state).toBe("closed");
  } finally { (globalThis as any).AudioDecoder = original; }
});


test("closing during async native decoder preparation cannot resurrect its resources", async () => {
  const original = (globalThis as any).AudioDecoder;
  let finish!: (value: { supported: boolean }) => void, created = 0;
  (globalThis as any).AudioDecoder = class {
    static isConfigSupported() { return new Promise(resolve => { finish = resolve; }); }
    constructor() { created++; }
    configure() {}
  };
  try {
    const pipeline = new SendspinDecoder(() => {}, () => 0);
    const pending = pipeline.prepare({ codec: "opus", sample_rate: 48000, channels: 2, bit_depth: 16 });
    pipeline.close(); finish({ supported: true });
    await expect(pending).rejects.toThrow("cancelled"); expect(created).toBe(0);
  } finally { (globalThis as any).AudioDecoder = original; }
});


test("cancelled fallback initialization can prepare again and decode real Opus", async () => {
  const original = (globalThis as any).AudioDecoder;
  (globalThis as any).AudioDecoder = undefined;
  const chunks: { samples: Float32Array[]; generation: number }[] = [];
  let generation = 0;
  const decoder = new SendspinDecoder(chunk => chunks.push(chunk), () => generation);
  const format = { codec: "opus" as const, sample_rate: 48000, channels: 2, bit_depth: 16 };
  try {
    const cancelled = decoder.prepare(format).catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    generation++; decoder.clearState();
    // Begin a replacement before the cancelled imports/readiness can complete.
    const replacement = decoder.prepare(format);
    expect((await cancelled).message).toContain("cancelled");
    await replacement;
    const message = new Uint8Array(12); message[0] = 4;
    message.set([0xf8, 0xff, 0xfe], 9); // Standard valid 20 ms Opus silence packet.
    await decoder.handleBinaryMessage(message.buffer, format, generation);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.samples.length).toBe(2);
    expect(chunks[0]!.samples[0]!.length).toBe(960);
    generation++; decoder.clearState(); await decoder.prepare(format);
    await decoder.handleBinaryMessage(message.buffer, format, generation);
    expect(chunks.length).toBe(2); // A fully prepared fallback also survives clear.
  } finally { decoder.close(); (globalThis as any).AudioDecoder = original; }
});
