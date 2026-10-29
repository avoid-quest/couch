import { afterEach, expect, mock, test } from "bun:test";

const players: FixturePlayer[] = [];
const authenticated: unknown[][] = [];
const taps: unknown[] = [];
const failures: unknown[][] = [];
let authenticationFailure: Error | undefined;
class FixturePlayer {
  buffers: number[] = [];
  disconnected = false;
  constructor(readonly options: Record<string, unknown>) { players.push(this); }
  async connect() {}
  async unlock() {}
  disconnect() { this.disconnected = true; }
  setMinBufferMs(value: number) { this.buffers.push(value); }
}
mock.module("@sendspin/sendspin-js", () => ({ SendspinPlayer: FixturePlayer }));
mock.module("../src/client/api/client", () => ({ apiFetch: async (...args: unknown[]) => {
  authenticated.push(args);
  if (authenticationFailure) { const error = authenticationFailure; authenticationFailure = undefined; throw error; }
} }));
mock.module("../src/client/toasts", () => ({ failed: (...args: unknown[]) => failures.push(args) }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: (callback: unknown) => taps.push(callback) }));
mock.module("../src/client/session/device-id", () => ({ storage: null, deviceId: () => "opaque-device" }));
const { listen } = await import("../src/client/session/sendspin");
const credentials = { origin: "http://localhost", token: "fixture-token" };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(async () => { listen(false, false, credentials, "Fixture"); await settle(); });

test("Couch supplies shared identity storage and cookie authorization while the SDK keeps playback defaults", async () => {
  listen(true, false, credentials, "Fixture"); await settle();
  const player = players.at(-1)!;
  expect(player.options).toMatchObject({ baseUrl: credentials.origin, storage: null, suite: "aesgcm" });
  expect(authenticated.at(-1)).toEqual([credentials, "/api/audio/session", { method: "POST", credentials: "include" }]);
  for (const key of ["playerId", "codecs", "requiredLeadTimeMs", "minBufferMs", "correctionMode", "outputMode", "latencyHint"]) expect(player.options[key]).toBeUndefined();
});

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

test("a failed audio bootstrap is visible and its retry creates a fresh player", async () => {
  const count = players.length, error = new Error("Temporary connection failure");
  authenticationFailure = error;
  listen(true, false, credentials, "Fixture", { codec: "pcm", minBufferMs: 250 }); await settle();
  expect(players.length).toBe(count);
  expect(failures.at(-1)?.[1]).toBe(error);
  const retry = taps.at(-1);
  expect(typeof retry).toBe("function");
  (retry as () => void)(); await settle();
  expect(players.length).toBe(count + 1);
  expect(players.at(-1)!.options.codecs).toEqual(["pcm"]);
});

test("leaving cancels an offered bootstrap retry", async () => {
  authenticationFailure = new Error("Temporary connection failure");
  listen(true, false, credentials, "Fixture"); await settle();
  const retry = taps.at(-1) as () => void, count = players.length;
  listen(false, false, credentials, "Fixture");
  retry(); await settle();
  expect(players.length).toBe(count);
});

test("a rejected Tap to hear keeps its retry and reports the output failure", async () => {
  const original = FixturePlayer.prototype.unlock;
  const error = new Error("The audio output is unavailable.");
  FixturePlayer.prototype.unlock = async () => { throw error; };
  try {
    listen(true, false, credentials, "Fixture"); await settle();
    await new Promise(resolve => setTimeout(resolve, 510));
    const retry = taps.at(-1) as () => void;
    expect(typeof retry).toBe("function");
    retry();
    // renderer.hear clears the offered gesture synchronously; the rejected attempt must restore it.
    taps.push(null);
    await settle();
    expect(typeof taps.at(-1)).toBe("function");
    expect(failures.at(-1)?.[1]).toBe(error);
    expect(failures.at(-1)?.[0]).toContain(error.message);
    FixturePlayer.prototype.unlock = original;
    (taps.at(-1) as () => void)(); await settle();
    expect(taps.at(-1)).toBeNull();
  } finally { FixturePlayer.prototype.unlock = original; }
});

test("leaving while Tap to hear is pending cannot restore its prompt or report a stale failure", async () => {
  const original = FixturePlayer.prototype.unlock;
  FixturePlayer.prototype.unlock = async () => { throw new Error("Needs a gesture."); };
  try {
    listen(true, false, credentials, "Fixture"); await settle();
    await new Promise(resolve => setTimeout(resolve, 510));
    const pending = Promise.withResolvers<void>();
    FixturePlayer.prototype.unlock = () => pending.promise;
    (taps.at(-1) as () => void)();
    listen(false, false, credentials, "Fixture");
    const before = failures.length;
    pending.reject(new Error("Old output failed.")); await settle();
    expect(taps.at(-1)).toBeNull();
    expect(failures.length).toBe(before);
  } finally { FixturePlayer.prototype.unlock = original; }
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
