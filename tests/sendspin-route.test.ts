import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { LossSecond } from "../src/client/session/live-buffer";

const players: FixturePlayer[] = [];
// The synced clock (server time, µs) every fixture player reads.
let serverNowUs = 0;
class FixturePlayer {
  buffers: number[] = [];
  disconnected = false;
  isConnected = true;
  isPlaying = true;
  timeSyncInfo = { synced: true };
  syncInfo = { outputLatencyMs: 27, syncErrorMs: 0 };
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
// Couch's Live player, as far as the route reads it: its output reading and each second's loss,
// which its worklet counts (live-timeline.test.ts).
class FixtureLivePlayer extends FixturePlayer {
  output: number | undefined = 27;
  measuresOutput = true;
  // The second each sample reads, as the player counted it.
  next: () => LossSecond | undefined = () => clean;
  outputMs() {
    return this.output;
  }
  sampleLoss(counted: boolean) {
    const second = this.next();
    return counted ? second : undefined;
  }
}
// 200 chunks a second, sent 95 ms ahead of their stamps, none lost.
const clean: LossSecond = { chunks: 200, lost: 0, sendAheadMs: 95 };
// The SDK's scheduler, as far as Couch reaches it: it makes each decoded chunk a buffer and, at its
// next batch, starts it (as a copy when it corrects it by a sample) or drops it if its start passed.
class FixtureScheduler {
  queue: { buffer: AudioBuffer; stampUs: number }[] = [];
  // A guarded cutover: the player starts nothing whose start falls before this (server time, µs).
  guardUs = 0;
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
      if (stampUs - outputUs < Math.max(serverNowUs, this.guardUs)) continue;
      let played = buffer;
      if (index % 2) {
        played = this.context.createBuffer(2, 961, 48_000);
        played.getChannelData(0).set(buffer.getChannelData(0));
      }
      Object.assign(new AudioBufferSourceNode(this.context), { buffer: played }).start(
        (stampUs - outputUs) / 1e6,
      );
    }
  }
  performGuardedCutover() {
    this.guardUs = serverNowUs + 300_000;
  }
}
// Web Audio, as far as the player and Couch use it. Couch wraps its prototypes once, so every test
// shares these.
class FixtureBuffer {
  constructor(readonly length: number) {}
  get duration() {
    return this.length / 48_000;
  }
  getChannelData() {
    return new Float32Array(1);
  }
}
class Context extends EventTarget {
  state = "running";
  sampleRate = 48_000;
  currentTime = 0;
  createBuffer(_channels: number, length: number) {
    return new FixtureBuffer(length);
  }
  // The context stops running and runs again, as on a phone call or a hidden page.
  suspendFor(run: () => void) {
    this.state = "suspended";
    this.dispatchEvent(new Event("statechange"));
    run();
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  }
}
class FixtureSource {
  buffer?: FixtureBuffer;
  playbackRate = { value: 1 };
  constructor(readonly context: Context) {}
  start(_when?: number) {}
}
const useWebAudio = () =>
  Object.assign(globalThis, {
    BaseAudioContext: Context,
    AudioBuffer: FixtureBuffer,
    AudioBufferSourceNode: FixtureSource,
  });
// The SDK's protocol layer, as far as Couch reaches it: each decrypted binary message.
class FixtureCore {
  timeSyncInfo = { synced: false };
  handleBinaryMessage(_data: ArrayBuffer) {}
}
// The SDK's own platform detection, which picks the player.
const { detectIsAndroid, detectIsIOS } = await import("@sendspin/sendspin-js");
mock.module("@sendspin/sendspin-js", () => ({
  detectIsAndroid,
  detectIsIOS,
  SendspinPlayer: FixturePlayer,
  AudioScheduler: FixtureScheduler,
  SendspinCore: FixtureCore,
}));
mock.module("../src/client/session/live-player", () => ({ LivePlayer: FixtureLivePlayer }));
mock.module("../src/client/api/client", () => ({ apiFetch: async () => {} }));
mock.module("../src/client/toasts", () => ({ failed: () => {} }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: () => {} }));
// Whether this device last told Core its speaker is behind.
let soundBehind = false;
mock.module("../src/client/session/behind", () => ({
  reportBehind: ({ sound }: { sound?: boolean }) => {
    if (sound !== undefined) soundBehind = sound;
  },
}));
// This browser's storage, as Couch and the SDK share it.
const stored = new Map<string, string>();
mock.module("../src/client/session/device-id", () => ({
  storage: { getItem: (key: string) => stored.get(key) ?? null, setItem: stored.set.bind(stored) },
  deviceId: () => "opaque-device",
}));
const { listen } = await import("../src/client/session/sendspin");
const credentials = { origin: "http://localhost", token: "fixture-token" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const live = () => players.at(-1) as FixtureLivePlayer;
// This browser's user agent; a test on Android or iOS sets it.
const userAgent = navigator.userAgent;
let agent = userAgent;
Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => agent });
const onAndroid = () => {
  agent = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/158.0 Mobile";
};
afterEach(async () => {
  listen(false, false, credentials, "Fixture");
  await settle();
  stored.clear();
  agent = userAgent;
});

test("Live listeners play with Couch's player and relaxed sound with the SDK's", async () => {
  listen(true, false, credentials, "Fixture");
  await settle();
  expect(players.at(-1)).not.toBeInstanceOf(FixtureLivePlayer);
  listen(true, false, credentials, "Fixture", { codec: "pcm" });
  await settle();
  expect(players.at(-1)).toBeInstanceOf(FixtureLivePlayer);
  // On Android a context with a worklet adds delay its output timestamps miss: Live uses the SDK's.
  listen(false, false, credentials, "Fixture");
  await settle();
  onAndroid();
  listen(true, false, credentials, "Fixture", { codec: "pcm" });
  await settle();
  expect(players.at(-1)).not.toBeInstanceOf(FixtureLivePlayer);
  expect(players.at(-1)!.options.minBufferMs).toBe(0);
  // On iOS sound plays through a media element whose delay only the SDK's player allows for.
  listen(false, false, credentials, "Fixture");
  await settle();
  agent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  listen(true, false, credentials, "Fixture", { codec: "pcm" });
  await settle();
  expect(players.at(-1)).not.toBeInstanceOf(FixtureLivePlayer);
  expect(players.at(-1)!.options.minBufferMs).toBe(0);
});

test("clock-only watch reuses the player and declares nothing before it has measured", async () => {
  listen(true, true, credentials, "Fixture", { codec: "pcm" });
  await settle();
  const player = players.at(-1)!;
  expect(player.options.codecs).toEqual(["pcm"]);
  listen(false, true, credentials, "Fixture", { codec: "pcm" });
  await settle();
  expect(players.at(-1)).toBe(player);
  expect(player.options.minBufferMs).toBe(0);
  expect(player.buffers).toEqual([]);
  listen(true, true, credentials, "Fixture", { codec: "opus" });
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
  const settings = { codec: "pcm", sourceId: "first" } as const;
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", settings);
    await settle();
  });
  const first = live();
  first.output = 201;
  tick(5);
  // The output reading alone: the player has no scheduling batch.
  expect(first.buffers).toEqual([201]);
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
    listen(true, false, credentials, "Fixture", { codec: "pcm" });
    await settle();
  });
  const player = live();
  // A browser that reports no output position: base latency only, then the output's too.
  player.measuresOutput = false;
  player.output = 5;
  tick(1);
  player.output = 40;
  tick(1);
  expect(player.buffers).toEqual([]);
  tick(1);
  expect(player.buffers).toEqual([40]);
});

test("a codec change keeps the Media Session that Couch set when a player's destroy clears it", async () => {
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
    listen(true, false, credentials, "Fixture", { codec: "pcm" });
    await settle();
    const first = players.at(-1)!;
    const metadata = { title: "Concert" };
    Object.assign(mediaSession, { metadata, playbackState: "playing" });
    listen(true, false, credentials, "Fixture", { codec: "opus" });
    await settle();
    expect(first.disconnected).toBe(true);
    expect(players.at(-1)).not.toBe(first);
    expect(mediaSession).toEqual({ metadata, playbackState: "playing" });
  } finally {
    FixturePlayer.prototype.destroy = original;
    delete (navigator as { mediaSession?: unknown }).mediaSession;
  }
});

const join = (origin = credentials.origin) =>
  sampling(async () => {
    listen(true, false, { ...credentials, origin }, "Fixture", { codec: "pcm" });
    await settle();
  });
const leave = async () => {
  listen(false, false, credentials, "Fixture");
  await settle();
};

test("a listener steps as late as the loss its player counted, never for a second it couldn't count", async () => {
  const tick = await join();
  const player = live();
  tick(10);
  expect(player.buffers).toEqual([27]);
  // Seconds the context didn't run throughout, however much they lost.
  player.next = () => undefined;
  tick(10);
  expect(player.buffers).toEqual([27]);
  // Chunks reach the worklet 17 ms after they were due, in two spells two clean seconds apart: a
  // 20 ms step.
  const late = { ...clean, lost: 200, lateMs: 17 };
  player.next = () => late;
  tick(1);
  player.next = () => clean;
  tick(2);
  expect(player.buffers).toEqual([27]);
  player.next = () => late;
  tick(1);
  expect(player.buffers).toEqual([27, 47]);
  // Core sends its chunks a step further ahead: it applied the step. The same loss still runs in
  // every second after it: once three seconds show that, another 20 ms step.
  player.next = () => ({ ...late, sendAheadMs: 115 });
  tick(3);
  expect(player.buffers).toEqual([27, 47]);
  tick(1);
  expect(player.buffers).toEqual([27, 47, 67]);
  // Its next listen learns its own steps: it starts at its need, whatever an older Couch stored.
  await leave();
  stored.set("couch.live-steps:http://localhost", JSON.stringify({ steps: 2, spare: 0 }));
  (await join())(2);
  expect(live().buffers).toEqual([27]);
});

test("a Live listener is behind while it loses chunks in most of the last 5 seconds", async () => {
  const tick = await join();
  const player = live();
  tick(10);
  player.next = () => ({ ...clean, lost: 3, lateMs: 17 });
  tick(2);
  expect(soundBehind).toBe(false);
  tick(1);
  expect(soundBehind).toBe(true);
  player.next = () => clean;
  tick(2);
  expect(soundBehind).toBe(true);
  tick(1);
  expect(soundBehind).toBe(false);
});

test("loss with no lateness, the sound running out early, steps 10 ms", async () => {
  const tick = await join();
  const player = live();
  tick(10);
  player.next = () => ({ ...clean, lost: 1 });
  tick(1);
  player.next = () => clean;
  tick(1);
  expect(player.buffers).toEqual([27]);
  player.next = () => ({ ...clean, lost: 1 });
  tick(1);
  expect(player.buffers).toEqual([27, 37]);
});

// On Android, Live plays with the SDK's player, whose lost chunks Couch counts itself (live-loss.ts).
test("a listener steps for chunks it received and couldn't play, not for chunks Core never sent", async () => {
  useWebAudio();
  onAndroid();
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", { codec: "pcm" });
    await settle();
  });
  const player = players.at(-1)!,
    context = new Context(),
    scheduler = new FixtureScheduler(context as unknown as BaseAudioContext),
    outputUs = player.syncInfo.outputLatencyMs * 1000;
  scheduler.initAudioContext();
  const core = new FixtureCore();
  // A second of 50 chunks, each arriving `aheadMs` before its stamp and sent `sendAheadMs` before
  // it; the player's batch runs after each (busy: only after the second's sample).
  const second = async (chunks: number, aheadMs: number, busy = false, sendAheadMs = 95) => {
    for (let chunk = 0; chunk < chunks; chunk++) {
      serverNowUs += 20_000;
      const header = new DataView(new ArrayBuffer(13));
      header.setUint8(0, 4);
      header.setBigInt64(1, BigInt(serverNowUs + aheadMs * 1000));
      header.setUint32(9, sendAheadMs * 1000);
      core.handleBinaryMessage(header.buffer);
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
  // Chunks whose starts fell while the context was suspended between two samples: not lost.
  for (let i = 0; i < 10; i++) {
    context.suspendFor(() => {
      for (let chunk = 0; chunk < 50; chunk++)
        scheduler.handleDecodedChunk({ serverTimeUs: (serverNowUs += 20_000) + 10_000 });
    });
    await second(0, 0);
  }
  expect(player.buffers).toEqual([42]);
  // Chunks arrive after their starts in two spells (the first counted over two samples), two clean
  // seconds apart. Each arrives 10 ms before its stamp, 17 ms after its start (output 27): a 20 ms
  // step, asked of Core 10 ms at a time.
  await second(50, 10);
  for (let i = 0; i < 3; i++) await second(50, 100);
  expect(player.buffers).toEqual([42]);
  await second(50, 10);
  expect(player.buffers).toEqual([42, 52]);
  // Core applies the first part, and the player slews to it: no second part until it's within 8 ms.
  player.syncInfo.syncErrorMs = -10;
  for (let i = 0; i < 2; i++) await second(50, 10, false, 105);
  expect(player.buffers).toEqual([42, 52]);
  player.syncInfo.syncErrorMs = -5;
  await second(50, 10, false, 105);
  expect(player.buffers).toEqual([42, 52, 62]);
  // Core sends its chunks the whole step further ahead and the player slewed to it. The same loss
  // still runs in every second after it: once three seconds show that, the next step's first part.
  for (let i = 0; i < 4; i++) await second(50, 10, false, 115);
  expect(player.buffers).toEqual([42, 52, 62]);
  await second(50, 10, false, 115);
  expect(player.buffers).toEqual([42, 52, 62, 72]);
  // Its next listen learns its own steps: it starts at its need, whatever an older Couch stored.
  await leave();
  stored.set("couch.live-steps:http://localhost", JSON.stringify({ steps: 2, spare: 0 }));
  (await join())(2);
  expect(players.at(-1)!.buffers).toEqual([42]);
});

test("a listener steps when its player runs dry holding chunks, not for a gap Core left or a late arrival", async () => {
  useWebAudio();
  onAndroid();
  const tick = await sampling(async () => {
    listen(true, false, credentials, "Fixture", { codec: "pcm" });
    await settle();
  });
  const player = players.at(-1)!,
    context = new Context(),
    scheduler = new FixtureScheduler(context as unknown as BaseAudioContext);
  scheduler.initAudioContext();
  // The context's clock is the synced clock here. Each 20 ms chunk is received 100 ms before its
  // stamp, and the player starts it where the one before it ended.
  let stampUs = serverNowUs + 100_000,
    end = 0;
  const play = (startAt?: number) => {
    const { buffer } = scheduler.queue.shift()!;
    const source = Object.assign(new FixtureSource(context), { buffer });
    const when = startAt ?? (end || context.currentTime + 0.05);
    source.start(when);
    end = when + buffer.duration;
  };
  // One second, with at most one fault in it:
  // - dry: the batch runs 5 ms after the last chunk ended, though it held the next one;
  // - gap: Core sent nothing for one chunk, and the next starts after a silence;
  // - late: the next chunk is received only after the last one ended.
  const second = (fault?: "dry" | "gap" | "late") => {
    for (let chunk = 0; chunk < 50; chunk++) {
      const faulty = chunk === 25 ? fault : undefined;
      if (faulty === "gap") stampUs += 20_000;
      serverNowUs = stampUs - 100_000;
      context.currentTime = faulty === "late" ? end + 0.005 : serverNowUs / 1e6;
      scheduler.handleDecodedChunk({ serverTimeUs: stampUs });
      stampUs += 20_000;
      if (faulty === undefined) play();
      else {
        context.currentTime = end + 0.005;
        play(context.currentTime + 0.01);
      }
    }
    tick(1);
  };
  for (let i = 0; i < 10; i++) second();
  expect(player.buffers).toEqual([42]);
  for (const fault of ["gap", undefined, "late", undefined, "gap", undefined, "late"] as const)
    second(fault);
  for (let i = 0; i < 10; i++) second();
  expect(player.buffers).toEqual([42]);
  // Two dry-outs in ten seconds: loss that recurs.
  second("dry");
  second();
  expect(player.buffers).toEqual([42]);
  second("dry");
  expect(player.buffers).toEqual([42, 52]);
});

test("chunks a guarded cutover discards never count, even when a sample comes before the next start", async () => {
  useWebAudio();
  onAndroid();
  const tick = await join();
  const player = players.at(-1)!,
    context = new Context(),
    scheduler = new FixtureScheduler(context as unknown as BaseAudioContext),
    outputUs = player.syncInfo.outputLatencyMs * 1000;
  scheduler.initAudioContext();
  // Chunks received 100 ms before their stamps, so each starts 73 ms after it arrives. A cutover
  // ten chunks before the sample discards them all, the first one's start over 100 ms before the
  // sample; the player starts its next chunk only in the next second.
  const second = (cutoverAt?: number) => {
    for (let chunk = 0; chunk < 50; chunk++) {
      serverNowUs += 20_000;
      context.currentTime = serverNowUs / 1e6;
      scheduler.handleDecodedChunk({ serverTimeUs: serverNowUs + 100_000 });
      if (chunk === cutoverAt) scheduler.performGuardedCutover();
      scheduler.processAudioQueue(outputUs);
    }
    tick(1);
  };
  for (let i = 0; i < 10; i++) second();
  expect(player.buffers).toEqual([42]);
  // Two cutovers in ten seconds: two spells, were their discards lost.
  second(40);
  for (let i = 0; i < 4; i++) second();
  second(40);
  for (let i = 0; i < 60; i++) second();
  expect(player.buffers).toEqual([42]);
});
