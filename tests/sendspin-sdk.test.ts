import { outputBufferOptions, outputLatencyHint } from "../src/shared/audio-settings";
import { test, expect } from "bun:test";
import { SendspinDecoder, SendspinPlayer, type SendspinPlayerConfig } from "@sendspin/sendspin-js";
// Maintenance regression for the pinned SDK patch, which intentionally tests this exported module's clock.
import { ClockSource } from "../node_modules/@sendspin/sendspin-js/dist/audio/clock-source.js";
import { AudioScheduler } from "../node_modules/@sendspin/sendspin-js/dist/audio/scheduler.js";
import { StateManager } from "../node_modules/@sendspin/sendspin-js/dist/core/state-manager.js";
import { SendspinTimeFilter } from "../node_modules/@sendspin/sendspin-js/dist/core/time-filter.js";

// Only the Web Audio and time boundaries are fake. Decoded arrivals exercise the
// real SDK queue, clocks, preparation, deadlines and lifecycle without audio I/O.
function schedulerFixture(outputMode: "direct" | "media-element" = "direct", correctionMode: "quality" | "sync" = "quality", sampleCorrectionMode?: "rate") {
  const originals = new Map(["AudioContext", "navigator", "performance", "setTimeout", "clearTimeout", "queueMicrotask"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let nowMs = 1000, nextTimer = 0, timestampReads = 0;
  const timers = new Map<number, { at: number; run: () => void }>(), microtasks: (() => void)[] = [];
  const starts: { calledAtMs: number; when: number; duration: number; stopped: boolean; rate: number; samples: Float32Array[] }[] = [];
  const contextOptions: AudioContextOptions[] = [];
  let baseLatencySec = .002, outputLatencySec = .004;
  const install = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install("navigator", { userAgent: "fixture" });
  install("performance", { now: () => nowMs });
  install("setTimeout", (run: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: nowMs + delay, run }); return id; });
  install("clearTimeout", (id: number) => timers.delete(id));
  install("queueMicrotask", (run: () => void) => microtasks.push(run));
  install("AudioContext", class {
    constructor(options: AudioContextOptions) { contextOptions.push(options); }
    state = "running"; sampleRate = 48_000; destination = {};
    get baseLatency() { return baseLatencySec; }
    get outputLatency() { return outputLatencySec; }
    get currentTime() { return nowMs / 1000; }
    getOutputTimestamp() { timestampReads++; return { contextTime: nowMs / 1000 - baseLatencySec - outputLatencySec, performanceTime: nowMs }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1, setTargetAtTime() {} } }; }
    createMediaStreamDestination() { return { stream: {} }; }
    createBuffer(channels: number, frames: number, rate: number) {
      const samples = Array.from({ length: channels }, () => new Float32Array(frames));
      return { duration: frames / rate, length: frames, numberOfChannels: channels, sampleRate: rate, getChannelData: (channel: number) => samples[channel] };
    }
    createBufferSource() {
      let started: (typeof starts)[number] | undefined;
      return { buffer: null as AudioBuffer | null, playbackRate: { value: 1 }, onended: null, connect() {},
        start(when: number) { starts.push(started = { when, duration: this.buffer!.duration, calledAtMs: nowMs, stopped: false, rate: this.playbackRate.value, samples: Array.from({ length: this.buffer!.numberOfChannels }, (_, channel) => this.buffer!.getChannelData(channel).slice()) }); },
        stop() { if (started) started.stopped = true; },
      };
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  });
  const state = new StateManager(), timeFilter = new SendspinTimeFilter();
  timeFilter.update(0, 1, nowMs * 1000);
  state.currentStreamFormat = { codec: "opus", sample_rate: 48_000, channels: 2, bit_depth: 16 };
  state.isPlaying = true;
  const scheduler = new AudioScheduler({ stateManager: state, timeFilter, outputMode, correctionMode, sampleCorrectionMode, audioElement: { style: {}, play: async () => {}, pause() {}, removeAttribute() {}, load() {}, volume: 1 } as unknown as HTMLAudioElement });
  scheduler.initAudioContext();
  const settle = async () => {
    for (let turn = 0; turn < 4; turn++) {
      let count = 0;
      while (microtasks.length) { if (++count > 1000) throw new Error("Scheduler microtask loop"); microtasks.shift()!(); }
      await Promise.resolve();
    }
  };
  const advance = async (milliseconds: number) => {
    const target = nowMs + milliseconds;
    await settle();
    let count = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++count > 1000) throw new Error("Scheduler timer loop");
      nowMs = next[1].at; timers.delete(next[0]); next[1].run(); await settle();
    }
    nowMs = target; await settle();
  };
  return {
    scheduler, state, starts, settle, advance, contextOptions,
    setOutputLatency(baseSec: number, outputSec: number) { baseLatencySec = baseSec; outputLatencySec = outputSec; },
    get nowMs() { return nowMs; },
    get timestampReads() { return timestampReads; },
    get timerDelays() { return [...timers.values()].map(timer => timer.at - nowMs); },
    async prepare() { const pending = scheduler.prepareOutput(); await advance(800); await pending; },
    chunk(serverTimeUs = nowMs * 1000 + 50_000, frames = 240) {
      scheduler.handleDecodedChunk({ samples: [new Float32Array(frames), new Float32Array(frames)], sampleRate: 48_000, serverTimeUs, generation: state.streamGeneration });
    },
    restore() { try { scheduler.close(); } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } },
  };
}

for (const shiftUs of [-2000, 2000]) {
  test(`rate drift correction preserves stereo PCM and contiguous playout for ${shiftUs} us clock adjustment`, async () => {
    const fixture = schedulerFixture("direct", "sync", "rate");
    try {
      await fixture.prepare();
      const first = fixture.nowMs * 1000 + 50_000;
      const samples = [Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * .37)), Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * .23))];
      for (let i = 0; i < 64; i++) {
        fixture.scheduler.handleDecodedChunk({ samples, sampleRate: 48_000, serverTimeUs: first + i * 128 / 48_000 * 1e6 + (i ? shiftUs : 0), generation: fixture.state.streamGeneration });
        await fixture.settle();
      }
      expect(fixture.starts).toHaveLength(64);
      for (const start of fixture.starts) {
        expect(start.samples).toEqual(samples);
        expect(start.rate).toBeGreaterThanOrEqual(.9999);
        expect(start.rate).toBeLessThanOrEqual(1.0001);
      }
      expect(fixture.starts.some(start => (start.rate - 1) * -shiftUs > 0)).toBe(true);
      for (let i = 1; i < fixture.starts.length; i++) {
        const previous = fixture.starts[i - 1]!;
        expect(fixture.starts[i]!.when).toBeCloseTo(previous.when + previous.duration / previous.rate, 9);
      }
    } finally { fixture.restore(); }
  });
}

test("omitted drift option retains the existing sample-correction behavior", async () => {
  const fixture = schedulerFixture("direct", "sync");
  try {
    await fixture.prepare();
    const first = fixture.nowMs * 1000 + 50_000;
    for (let i = 0; i < 64; i++) {
      fixture.chunk(first + i * 128 / 48_000 * 1e6 - (i ? 2000 : 0), 128); await fixture.settle();
    }
    expect(fixture.starts).toHaveLength(64);
    expect(fixture.starts.some(start => start.samples[0]!.length === 127)).toBe(true);
    expect(fixture.starts.every(start => start.rate === 1)).toBe(true);
  } finally { fixture.restore(); }
});

test("player forwards and validates its public drift-correction option", () => {
  const fixture = schedulerFixture();
  try {
    expect(() => new SendspinPlayer({ storage: null, sampleCorrectionMode: "invalid" as never })).toThrow("sampleCorrectionMode must be samples or rate");
  } finally { fixture.restore(); }
});

for (const config of [{}, { outputLatencyHint: undefined }, { outputLatencyHint: 0 }, { outputLatencyHint: .002 }, ...outputBufferOptions.map(value => ({ outputLatencyHint: outputLatencyHint(value) }))] satisfies Partial<SendspinPlayerConfig>[]) {
  test(`public output hint ${"outputLatencyHint" in config ? String(config.outputLatencyHint) : "omitted"} reaches AudioContext without changing omitted defaults`, async () => {
    const fixture = schedulerFixture();
    let player: SendspinPlayer | undefined;
    try {
      player = new SendspinPlayer({ storage: null, ...config });
      await player.unlock();
      expect(fixture.contextOptions).toHaveLength(2);
      expect(fixture.contextOptions[0]).toEqual({ sampleRate: 48_000 });
      expect(fixture.contextOptions[1]).toEqual(config.outputLatencyHint === undefined
        ? { sampleRate: 48_000 } : { sampleRate: 48_000, latencyHint: config.outputLatencyHint });
      expect(Object.hasOwn(fixture.contextOptions[1]!, "latencyHint")).toBe(config.outputLatencyHint !== undefined);
    } finally { try { player?.disconnect(); } finally { fixture.restore(); } }
  });
}

for (const outputLatencyHint of [-.001, NaN, Infinity, -Infinity]) test(`public output hint ${outputLatencyHint} rejects before creating AudioContext`, () => {
  const fixture = schedulerFixture();
  let player: SendspinPlayer | undefined;
  try {
    expect(() => { player = new SendspinPlayer({ storage: null, outputLatencyHint }); }).toThrow(RangeError);
    expect(fixture.contextOptions).toHaveLength(1);
  } finally { try { player?.disconnect(); } finally { fixture.restore(); } }
});

test("a requested output hint never replaces the actual public latency estimate", async () => {
  const fixture = schedulerFixture();
  let player: SendspinPlayer | undefined;
  try {
    fixture.setOutputLatency(.010, .016);
    player = new SendspinPlayer({ storage: null, outputLatencyHint: .002 });
    await player.unlock();
    expect(fixture.contextOptions[1]).toEqual({ sampleRate: 48_000, latencyHint: .002 });
    expect(player.syncInfo.outputLatencyMs).toBeCloseTo(26, 10);
    fixture.setOutputLatency(0, .008);
    expect(player.syncInfo.outputLatencyMs).toBe(8);
  } finally { try { player?.disconnect(); } finally { fixture.restore(); } }
});

for (const mode of ["quality", "sync"] as const) test(`prepared direct ${mode} output schedules decoded arrivals promptly without moving their deadlines`, async () => {
  const fixture = schedulerFixture("direct", mode);
  try {
    await fixture.prepare();
    const arrivedAt = fixture.nowMs;
    fixture.chunk();
    expect(fixture.starts).toHaveLength(0);
    await fixture.settle();
    expect(fixture.starts).toHaveLength(1);
    expect(fixture.starts[0]!.calledAtMs).toBe(arrivedAt);
    expect(fixture.starts[0]!.when).toBeCloseTo((arrivedAt + 44) / 1000, 6);
  } finally { fixture.restore(); }
});

test("prepared direct output coalesces same-turn arrivals in timestamp order", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    const first = fixture.nowMs * 1000 + 50_000, observations = fixture.timestampReads;
    fixture.chunk(first + 10_000); fixture.chunk(first); fixture.chunk(first + 5000);
    await fixture.settle();
    expect(fixture.starts).toHaveLength(3);
    expect(fixture.timestampReads - observations).toBe(1);
    for (let i = 0; i < 3; i++) expect(fixture.starts[i]!.when).toBeCloseTo((first - 6000 + i * 5000) / 1e6, 6);
    expect(fixture.timerDelays).toEqual([]);
  } finally { fixture.restore(); }
});

test("clearing a prepared output cancels old queued work while retaining prompt scheduling for its replacement", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    fixture.chunk();
    fixture.scheduler.clearBuffers(true);
    const observations = fixture.timestampReads;
    fixture.chunk(fixture.nowMs * 1000 + 70_000);
    await fixture.settle();
    expect(fixture.starts).toHaveLength(1);
    expect(fixture.timestampReads - observations).toBe(1);
    expect(fixture.starts[0]!.when).toBeCloseTo((fixture.nowMs + 64) / 1000, 6);
  } finally { fixture.restore(); }
});

test("closing a prepared output discards a pending decoded arrival", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    fixture.chunk(); fixture.scheduler.close();
    const observations = fixture.timestampReads;
    await fixture.settle(); await fixture.advance(100);
    expect(fixture.starts).toHaveLength(0);
    expect(fixture.timestampReads).toBe(observations);
    expect(fixture.timerDelays).toEqual([]);
  } finally { fixture.restore(); }
});

test("invalidating output cancels pending work and restores batching until preparation completes again", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    fixture.chunk(); fixture.scheduler.invalidateOutput(); fixture.chunk();
    await fixture.settle();
    expect(fixture.starts).toHaveLength(0);
    await fixture.advance(15);
    expect(fixture.starts).toHaveLength(1);
    await fixture.prepare();
    fixture.chunk(); await fixture.settle();
    expect(fixture.starts).toHaveLength(2);
    expect(fixture.starts[1]!.calledAtMs).toBe(fixture.nowMs);
  } finally { fixture.restore(); }
});

test("invalidating during preparation prevents retired work from enabling prompt scheduling", async () => {
  const fixture = schedulerFixture();
  try {
    const pending = fixture.scheduler.prepareOutput().catch(error => error);
    await fixture.advance(80);
    fixture.scheduler.invalidateOutput();
    await fixture.advance(800);
    expect(await pending).toBeInstanceOf(Error);
    fixture.chunk(); await fixture.settle();
    expect(fixture.starts).toHaveLength(0);
    await fixture.advance(15);
    expect(fixture.starts).toHaveLength(1);
  } finally { fixture.restore(); }
});

for (const mode of ["direct", "media-element"] as const) test(`unprepared ${mode} output retains its 15 ms decode batching`, async () => {
  const fixture = schedulerFixture(mode);
  try {
    expect(fixture.contextOptions).toEqual([{ sampleRate: 48_000 }]);
    const arrivedAt = fixture.nowMs;
    fixture.chunk(); await fixture.settle();
    expect(fixture.starts).toHaveLength(0);
    await fixture.advance(14);
    expect(fixture.starts).toHaveLength(0);
    await fixture.advance(1);
    expect(fixture.starts).toHaveLength(1);
    expect(fixture.starts[0]!.calledAtMs).toBe(arrivedAt + 15);
    expect(fixture.starts[0]!.when).toBeCloseTo((arrivedAt + 44) / 1000, 6);
  } finally { fixture.restore(); }
});

test("prepared direct output keeps future refills timed rather than spinning microtasks", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    const arrivedAt = fixture.nowMs, first = arrivedAt * 1000 + 50_000;
    for (let i = 0; i < 30; i++) fixture.chunk(first + i * 1e6, 48_000);
    await fixture.settle();
    expect(fixture.starts).toHaveLength(20);
    expect(fixture.timerDelays).toHaveLength(1);
    expect(fixture.timerDelays[0]).toBeCloseTo(15_044, 6);
    await fixture.advance(15_043);
    expect(fixture.starts).toHaveLength(20);
    await fixture.advance(2);
    expect(fixture.starts).toHaveLength(30);
    expect(fixture.starts[20]!.calledAtMs).toBeCloseTo(arrivedAt + 15_044, 6);
    expect(fixture.starts[29]!.when).toBeCloseTo((arrivedAt + 44) / 1000 + 29, 6);
    expect(fixture.timerDelays).toEqual([]);
  } finally { fixture.restore(); }
});

test("closing a prepared output cancels its pending future refill", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    const first = fixture.nowMs * 1000 + 50_000;
    for (let i = 0; i < 30; i++) fixture.chunk(first + i * 1e6, 48_000);
    await fixture.settle();
    expect(fixture.starts).toHaveLength(20);
    expect(fixture.timerDelays).toHaveLength(1);
    fixture.scheduler.close();
    await fixture.advance(20_000);
    expect(fixture.starts).toHaveLength(20);
    expect(fixture.starts.every(source => source.stopped)).toBe(true);
    expect(fixture.timerDelays).toEqual([]);
  } finally { fixture.restore(); }
});

test("prepared direct output discards expired decoded arrivals instead of moving their deadlines", async () => {
  const fixture = schedulerFixture();
  try {
    await fixture.prepare();
    fixture.chunk(fixture.nowMs * 1000 - 5000);
    await fixture.settle(); await fixture.advance(20);
    expect(fixture.starts).toHaveLength(0);
    expect(fixture.timerDelays).toEqual([]);
  } finally { fixture.restore(); }
});

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
