import { afterEach, expect, mock, test } from "bun:test";
import { AudioScheduler } from "../node_modules/@sendspin/sendspin-js/dist/audio/scheduler.js";
import { StateManager } from "../node_modules/@sendspin/sendspin-js/dist/core/state-manager.js";
import { SendspinTimeFilter } from "../node_modules/@sendspin/sendspin-js/dist/core/time-filter.js";

// Real SDK queues, with only platform/audio I/O and the network player boundary
// replaced. Device events exercise the product listen() subscription/intent path.
const media = new EventTarget();
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: media, userAgent: "fixture" } });
Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://localhost" } });
(globalThis as any).AudioContext = class {
  state = "running"; currentTime = 0; destination = {};
  createGain() { return { connect() {}, disconnect() {}, gain: { value: 1, setTargetAtTime() {} } }; }
  createBuffer(channels: number, frames: number, sampleRate: number) {
    const samples = Array.from({ length: channels }, () => new Float32Array(frames));
    return { duration: frames / sampleRate, getChannelData: (channel: number) => samples[channel] };
  }
  async close() { this.state = "closed"; }
};
const players: FixturePlayer[] = [];
class FixturePlayer {
  state = new StateManager();
  scheduler = new AudioScheduler({ stateManager: this.state, timeFilter: new SendspinTimeFilter(), outputMode: "direct", useOutputLatencyCompensation: false });
  outputReady = true; outputState = "running";
  timeSyncInfo = { synced: true, error: 0 }; syncInfo = { outputLatencyMs: 10 };
  constructor(readonly options: Record<string, unknown>) { players.push(this); this.scheduler.initAudioContext(); }
  async connect() {} async unlock() {} async prepareAudio() {}
  invalidateAudio() { this.scheduler.invalidateOutput(); }
  setRequiredLeadTimeMs() {} setMinBufferMs() {}
  disconnect() { this.scheduler.close(); }
  buffer(seconds: number) { this.scheduler.handleDecodedChunk({ samples: [new Float32Array(seconds * 48000), new Float32Array(seconds * 48000)], sampleRate: 48000, serverTimeUs: 1_000_000, generation: this.state.streamGeneration }); }
}
mock.module("@sendspin/sendspin-js", () => ({ SendspinPlayer: FixturePlayer }));
mock.module("../src/client/session/renderer", () => ({ waitForTap() {} }));
mock.module("../src/client/session/device-id", () => ({ storage: null }));
const { listen } = await import("../src/client/session/sendspin");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(async () => { listen(false, false, "Fixture"); await settle(); });

for (const seconds of [8, 1, .25]) test(`relaxed devicechange preserves ${seconds}s of queued audio including a fully buffered tail`, async () => {
  listen(true, false, "Fixture", "relaxed"); await settle();
  const player = players.at(-1)!;
  player.buffer(seconds);
  expect(player.scheduler.measureBufferedPlaybackRunwaySec()).toBe(seconds);
  media.dispatchEvent(new Event("devicechange")); await settle();
  // No more packets arrive: a short track's entire tail is already queued.
  expect(player.scheduler.measureBufferedPlaybackRunwaySec()).toBe(seconds);
  expect(player.options.requiredLeadTimeMs).toBeUndefined();
});

test("live devicechange withdraws its queue, and switching to relaxed removes that subscription", async () => {
  listen(true, false, "Fixture", "live"); await settle();
  const live = players.at(-1)!; live.buffer(1);
  media.dispatchEvent(new Event("devicechange"));
  expect(live.scheduler.measureBufferedPlaybackRunwaySec()).toBe(0);
  listen(true, false, "Fixture", "relaxed"); await settle();
  const relaxed = players.at(-1)!; relaxed.buffer(.25);
  media.dispatchEvent(new Event("devicechange"));
  expect(relaxed.scheduler.measureBufferedPlaybackRunwaySec()).toBe(.25);
});
