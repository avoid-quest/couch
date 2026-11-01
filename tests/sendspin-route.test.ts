import { afterEach, expect, mock, spyOn, test } from "bun:test";

const players: FixturePlayer[] = [];
class FixturePlayer {
  buffers: number[] = [];
  disconnected = false;
  isConnected = true;
  isPlaying = true;
  timeSyncInfo = { synced: true };
  syncInfo = { outputLatencyMs: 27 };
  constructor(readonly options: Record<string, unknown>) { players.push(this); }
  async connect() {}
  async unlock() {}
  disconnect() { this.disconnected = true; }
  setMinBufferMs(value: number) { this.buffers.push(value); }
}
mock.module("@sendspin/sendspin-js", () => ({ SendspinPlayer: FixturePlayer }));
mock.module("../src/client/api/client", () => ({ apiFetch: async () => {} }));
mock.module("../src/client/toasts", () => ({ failed: () => {} }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: () => {} }));
mock.module("../src/client/session/device-id", () => ({ storage: null, deviceId: () => "opaque-device" }));
const { listen } = await import("../src/client/session/sendspin");
const credentials = { origin: "http://localhost", token: "fixture-token" };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(async () => { listen(false, false, credentials, "Fixture"); await settle(); });

test("clock-only watch reuses the player; public buffer changes keep the connection", async () => {
  listen(true, true, credentials, "Fixture", { codec: "pcm", minBufferMs: 250 }); await settle();
  const player = players.at(-1)!;
  expect(player.options.codecs).toEqual(["pcm"]);
  listen(false, true, credentials, "Fixture", { codec: "pcm", minBufferMs: 400 }); await settle();
  expect(players.at(-1)).toBe(player);
  expect(player.buffers.at(-1)).toBe(400);
  listen(true, true, credentials, "Fixture", { codec: "opus", minBufferMs: 400 }); await settle();
  expect(player.disconnected).toBe(true);
  expect(players.at(-1)!.options.codecs).toEqual(["opus", "pcm"]);
});

// Each tick of the player's one-second sampling interval, without waiting for real seconds.
async function sampling(run: () => Promise<void>) {
  const interval = spyOn(globalThis, "setInterval");
  let tick: () => void;
  try { await run(); tick = interval.mock.calls.at(-1)![0] as () => void; } finally { interval.mockRestore(); }
  return (ticks: number) => { for (let i = 0; i < ticks; i++) tick(); };
}

test("a new Live source or a new Join starts again from the host floor", async () => {
  const settings = { codec: "pcm", minBufferMs: 150, sourceId: "first" } as const;
  const tick = await sampling(async () => { listen(true, false, credentials, "Fixture", settings); await settle(); });
  const first = players.at(-1)!;
  first.syncInfo.outputLatencyMs = 201;
  tick(5);
  expect(first.buffers).toEqual([250]);
  listen(true, false, credentials, "Fixture", { ...settings, sourceId: "second" }); await settle();
  expect(first.disconnected).toBe(true);
  expect(players.at(-1)!.options.minBufferMs).toBe(150);
  listen(false, false, credentials, "Fixture"); await settle();
  listen(true, false, credentials, "Fixture", settings); await settle();
  expect(players.at(-1)!.options.minBufferMs).toBe(150);
});

test("a codec change keeps the Media Session that Couch set when the SDK's disconnect clears it", async () => {
  const mediaSession = { metadata: null as unknown, playbackState: "none" };
  const original = FixturePlayer.prototype.disconnect;
  // The SDK's disconnect() resets Media Session for its own page.
  FixturePlayer.prototype.disconnect = function () { this.disconnected = true; mediaSession.metadata = null; mediaSession.playbackState = "none"; };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
  try {
    listen(true, false, credentials, "Fixture", { codec: "pcm", minBufferMs: 250 }); await settle();
    const first = players.at(-1)!;
    const metadata = { title: "Concert" };
    Object.assign(mediaSession, { metadata, playbackState: "playing" });
    listen(true, false, credentials, "Fixture", { codec: "opus", minBufferMs: 250 }); await settle();
    expect(first.disconnected).toBe(true);
    expect(players.at(-1)).not.toBe(first);
    expect(mediaSession).toEqual({ metadata, playbackState: "playing" });
  } finally { FixturePlayer.prototype.disconnect = original; delete (navigator as { mediaSession?: unknown }).mediaSession; }
});
