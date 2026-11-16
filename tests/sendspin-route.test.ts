import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { LossSecond } from "../src/client/session/live-buffer";

const players: FixturePlayer[] = [];
class FixturePlayer {
  buffers: number[] = [];
  disconnected = false;
  isConnected = true;
  isPlaying = true;
  timeSyncInfo = { synced: true };
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
mock.module("@sendspin/sendspin-js", () => ({ SendspinPlayer: FixturePlayer }));
mock.module("../src/client/session/live-player", () => ({ LivePlayer: FixtureLivePlayer }));
mock.module("../src/client/api/client", () => ({ apiFetch: async () => {} }));
mock.module("../src/client/toasts", () => ({ failed: () => {} }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: () => {} }));
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
afterEach(async () => {
  listen(false, false, credentials, "Fixture");
  await settle();
  stored.clear();
});

test("Live listeners play with Couch's player and relaxed sound with the SDK's", async () => {
  listen(true, false, credentials, "Fixture");
  await settle();
  expect(players.at(-1)).not.toBeInstanceOf(FixtureLivePlayer);
  listen(true, false, credentials, "Fixture", { codec: "pcm" });
  await settle();
  expect(players.at(-1)).toBeInstanceOf(FixtureLivePlayer);
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
  // Every chunk reaches the worklet 17 ms after it was due, three seconds running: a 20 ms step.
  player.next = () => ({ ...clean, lost: 200, lateMs: 17 });
  tick(2);
  expect(player.buffers).toEqual([27]);
  tick(1);
  expect(player.buffers).toEqual([27, 47]);
  // Core sends its chunks a step further ahead: it applied the step, which is judged only once ten
  // seconds after it show whether loss still recurs.
  player.next = () => ({ ...clean, lost: 200, lateMs: 17, sendAheadMs: 115 });
  tick(9);
  expect(player.buffers).toEqual([27, 47]);
  // Its next listen learns its own steps: it starts at its need, whatever an older Couch stored.
  await leave();
  stored.set("couch.live-steps:http://localhost", JSON.stringify({ steps: 2, spare: 0 }));
  (await join())(2);
  expect(live().buffers).toEqual([27]);
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
