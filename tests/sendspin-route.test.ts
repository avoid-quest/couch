import { afterEach, expect, mock, test } from "bun:test";

const players: FixturePlayer[] = [];
const authenticated: unknown[][] = [];
const taps: unknown[] = [];
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
mock.module("../src/client/api/client", () => ({ apiFetch: async (...args: unknown[]) => { authenticated.push(args); } }));
mock.module("../src/client/session/renderer", () => ({ waitForTap: (callback: unknown) => taps.push(callback) }));
mock.module("../src/client/session/device-id", () => ({ storage: null, deviceId: () => "opaque-device" }));
const { listen } = await import("../src/client/session/sendspin");
const credentials = { origin: "http://localhost", token: "fixture-token" };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(async () => { listen(false, false, credentials, "Fixture"); await settle(); });

test("Couch supplies identity and cookie authorization while the SDK keeps playback defaults", async () => {
  listen(true, false, credentials, "Fixture"); await settle();
  const player = players.at(-1)!;
  expect(player.options).toMatchObject({ baseUrl: credentials.origin, playerId: "opaque-device" });
  expect(authenticated.at(-1)).toEqual([credentials, "/api/audio/session", { method: "POST", credentials: "include" }]);
  for (const key of ["codecs", "requiredLeadTimeMs", "minBufferMs", "correctionMode", "outputMode", "latencyHint", "suite"]) expect(player.options[key]).toBeUndefined();
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
