import { afterEach, expect, mock, spyOn, test } from "bun:test";

const players: FixturePlayer[] = [];
// The synced clock (server time, µs) every fixture player reads.
let serverNowUs = 0;
class FixturePlayer {
  buffers: number[] = [];
  disconnected = false;
  isConnected = true;
  isPlaying = true;
  timeSyncInfo = { synced: true };
  syncInfo = { outputLatencyMs: 27 };
  constructor(readonly options: Record<string, unknown>) {
    players.push(this);
  }
  async connect() {}
  async unlock() {}
  destroy() {
    this.disconnected = true;
  }
  setMinBufferMs(value: number) {
    this.buffers.push(value);
  }
  getCurrentServerTimeUs() {
    return serverNowUs;
  }
}
// The SDK's scheduler, as far as Couch reaches it: it makes each decoded chunk a buffer and, at its
// next batch, starts it (as a copy when it corrects it by a sample) or drops it if its start passed.
class FixtureScheduler {
  queue: { buffer: AudioBuffer; stampUs: number }[] = [];
  constructor(readonly context: BaseAudioContext) {}
  initAudioContext() {}
  getAudioContext() {
    return this.context;
  }
  getSyncDelayMs() {
    return 0;
  }
  clearBuffers() {
    this.queue = [];
  }
  handleDecodedChunk(chunk: { serverTimeUs: number }) {
    const buffer = this.context.createBuffer(2, 960, 48_000);
    buffer.getChannelData(0);
    this.queue.push({ buffer, stampUs: chunk.serverTimeUs });
  }
  processAudioQueue(outputUs: number) {
    for (const [index, { buffer, stampUs }] of this.queue.splice(0).entries()) {
      if (stampUs - outputUs < serverNowUs) continue;
      let played = buffer;
      if (index % 2) {
        played = this.context.createBuffer(2, 961, 48_000);
        played.getChannelData(0).set(buffer.getChannelData(0));
      }
      Object.assign(new AudioBufferSourceNode(this.context), { buffer: played }).start();
    }
  }
}
mock.module("@sendspin/sendspin-js", () => ({
  SendspinPlayer: FixturePlayer,
  AudioScheduler: FixtureScheduler,
}));
mock.module("../src/client/api/client", () => ({ apiFetch: async () => {} }));
mock.module("../src/client/toasts", () => ({ failed: () => {} }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: () => {} }));
mock.module("../src/client/session/device-id", () => ({
  storage: null,
  deviceId: () => "opaque-device",
}));
const { listen } = await import("../src/client/session/sendspin");
const credentials = { origin: "http://localhost", token: "fixture-token" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(async () => {
  listen(false, false, credentials, "Fixture");
  await settle();
});

test("clock-only watch reuses the player; the room's delay is never declared", async () => {
  listen(true, true, credentials, "Fixture", { codec: "pcm", minBufferMs: 250 });
  await settle();
  const player = players.at(-1)!;
  expect(player.options.codecs).toEqual(["pcm"]);
  listen(false, true, credentials, "Fixture", { codec: "pcm", minBufferMs: 400 });
  await settle();
  expect(players.at(-1)).toBe(player);
  expect(player.options.minBufferMs).toBe(0);
  expect(player.buffers).toEqual([]);
  listen(true, true, credentials, "Fixture", { codec: "opus", minBufferMs: 400 });
  await settle();
  expect(player.disconnected).toBe(true);
  expect(players.at(-1)!.options.codecs).toEqual(["opus", "pcm"]);
});

// Each tick of the player's one-second sampling interval, without waiting for real seconds.
async function sampling(run: () => Promise<void>) {
  const interval = spyOn(globalThis, "setInterval");
  let tick: () => void;
  try {
    await run();
    tick = interval.mock.calls.at(-1)![0] as () => void;
  } finally {
    interval.mockRestore();
  }
  return (ticks: number) => {
    for (let i = 0; i < ticks; i++) tick();
  };
}

test("a new Live source or a new Join starts its own need again", async () => {
  const settings = { codec: "pcm", minBufferMs: 150, sourceId: "first" } as const;
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", settings);
    await settle();
  });
  const first = players.at(-1)!;
  first.syncInfo.outputLatencyMs = 201;
  tick(5);
  expect(first.buffers).toEqual([216]);
  listen(true, false, credentials, "Fixture", { ...settings, sourceId: "second" });
  await settle();
  expect(first.disconnected).toBe(true);
  expect(players.at(-1)!.options.minBufferMs).toBe(0);
  listen(false, false, credentials, "Fixture");
  await settle();
  listen(true, false, credentials, "Fixture", settings);
  await settle();
  expect(players.at(-1)!.options.minBufferMs).toBe(0);
});

test("the first declaration waits for a settled reading, not a context's base latency alone", async () => {
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", { codec: "pcm", minBufferMs: 0 });
    await settle();
  });
  const player = players.at(-1)!;
  // Just resumed: base latency only, then the output's too.
  player.syncInfo.outputLatencyMs = 5;
  tick(1);
  player.syncInfo.outputLatencyMs = 40;
  tick(1);
  expect(player.buffers).toEqual([]);
  tick(1);
  expect(player.buffers).toEqual([55]);
});

test("a codec change keeps the Media Session that Couch set when the SDK's destroy clears it", async () => {
  const mediaSession = { metadata: null as unknown, playbackState: "none" };
  const original = FixturePlayer.prototype.destroy;
  // The SDK's destroy() resets Media Session for its own page.
  FixturePlayer.prototype.destroy = function () {
    this.disconnected = true;
    mediaSession.metadata = null;
    mediaSession.playbackState = "none";
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
  try {
    listen(true, false, credentials, "Fixture", { codec: "pcm", minBufferMs: 250 });
    await settle();
    const first = players.at(-1)!;
    const metadata = { title: "Concert" };
    Object.assign(mediaSession, { metadata, playbackState: "playing" });
    listen(true, false, credentials, "Fixture", { codec: "opus", minBufferMs: 250 });
    await settle();
    expect(first.disconnected).toBe(true);
    expect(players.at(-1)).not.toBe(first);
    expect(mediaSession).toEqual({ metadata, playbackState: "playing" });
  } finally {
    FixturePlayer.prototype.destroy = original;
    delete (navigator as { mediaSession?: unknown }).mediaSession;
  }
});

test("a listener steps for chunks it received and couldn't play, not for chunks Core never sent", async () => {
  // Web Audio, as far as the player and Couch use it.
  class AudioBuffer {
    getChannelData() {
      return new Float32Array(1);
    }
  }
  class Context {
    state = "running";
    sampleRate = 48_000;
    createBuffer() {
      return new AudioBuffer();
    }
  }
  class AudioBufferSourceNode {
    buffer?: AudioBuffer;
    playbackRate = { value: 1 };
    constructor(readonly context: Context) {}
    start() {}
  }
  Object.assign(globalThis, { BaseAudioContext: Context, AudioBuffer, AudioBufferSourceNode });
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", { codec: "pcm", minBufferMs: 150 });
    await settle();
  });
  const player = players.at(-1)!,
    scheduler = new FixtureScheduler(new Context() as unknown as BaseAudioContext),
    outputUs = player.syncInfo.outputLatencyMs * 1000;
  // A second of 50 chunks, each arriving `aheadMs` before its stamp; the player's batch runs after
  // each (busy: only after the second's sample).
  const second = async (chunks: number, aheadMs: number, busy = false) => {
    for (let chunk = 0; chunk < chunks; chunk++) {
      serverNowUs += 20_000;
      scheduler.handleDecodedChunk({ serverTimeUs: serverNowUs + aheadMs * 1000 });
      await settle();
      if (!busy) scheduler.processAudioQueue(outputUs);
    }
    serverNowUs += chunks ? 0 : 1_000_000;
    tick(1);
    if (busy) scheduler.processAudioQueue(outputUs);
  };
  for (let i = 0; i < 10; i++) await second(50, 100);
  // Its own need: output 27 + the player's batch 15, read twice the same.
  expect(player.buffers).toEqual([42]);
  // Core sends nothing (its input stalled, or what it had was already late).
  for (let i = 0; i < 10; i++) await second(0, 0);
  // A busy page holds chunks past the sample, but starts them before their starts pass: not lost.
  for (let i = 0; i < 10; i++) await second(50, 1100, true);
  expect(player.buffers).toEqual([42]);
  // A stream clear discards what the player held: not lost either.
  for (let i = 0; i < 10; i++) {
    for (let chunk = 0; chunk < 50; chunk++)
      scheduler.handleDecodedChunk({ serverTimeUs: (serverNowUs += 20_000) + 100_000 });
    scheduler.clearBuffers();
    tick(1);
  }
  expect(player.buffers).toEqual([42]);
  // Every chunk arrives after its start: the listener plays nothing, and steps once its last ten
  // seconds lost chunks in both halves.
  for (let i = 0; i < 5; i++) await second(50, 10);
  expect(player.buffers).toEqual([42]);
  await second(50, 10);
  expect(player.buffers).toEqual([42, 67]);
});
