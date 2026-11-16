import { afterEach, expect, mock, test } from "bun:test";
import { noStats, type LiveMessage, type LiveStats } from "../src/client/session/live-timeline";

// The SDK's protocol layer, as far as the Live player reaches it.
class FixtureCore {
  onStreamClear = () => {};
  timeSyncInfo = { synced: true };
  volume = 100;
  muted = false;
  currentFormat = { sample_rate: 48_000 };
  disconnect() {}
}
let cores: FixtureCore[] = [];
mock.module("@sendspin/sendspin-js", () => ({
  SendspinCore: class extends FixtureCore {
    constructor() {
      super();
      cores.push(this);
    }
  },
}));
mock.module("../src/client/session/live-worklet.ts?worker&url", () => ({ default: "worklet.js" }));

// The worklet's side of the port: it reports with the epoch of the last reset it was sent.
class FixtureNode {
  epoch = 0;
  port = {
    onmessage: (_event: { data: { epoch: number; stats: LiveStats } }) => {},
    postMessage: (message: LiveMessage) => {
      if (message.type === "reset") this.epoch = message.epoch;
    },
  };
  constructor() {
    nodes.push(this);
  }
  connect() {}
  disconnect() {}
  report(stats: LiveStats) {
    this.port.onmessage({ data: { epoch: this.epoch, stats } });
  }
}
let nodes: FixtureNode[] = [];
let loaded = () => {};
class FixtureContext {
  state = "running";
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  audioWorklet = { addModule: () => new Promise<void>((resolve) => (loaded = resolve)) };
  createGain() {
    return { connect() {}, gain: { setTargetAtTime() {} } };
  }
  addEventListener() {}
  resume() {}
  close() {
    return Promise.resolve();
  }
}
Object.assign(globalThis, { AudioContext: FixtureContext, AudioWorkletNode: FixtureNode });
const { LivePlayer } = await import("../src/client/session/live-player");

afterEach(() => {
  cores = [];
  nodes = [];
});

test("a stream cleared while the worklet loads still counts the loss the worklet reports", async () => {
  const player = new LivePlayer({ playerId: "fixture", baseUrl: "http://localhost" });
  const unlocked = player.unlock();
  cores[0]!.onStreamClear();
  loaded();
  await unlocked;
  nodes[0]!.report({ ...noStats(), chunks: 200, lost: 3, slack: -960 });
  expect(player.sampleLoss(true)).toMatchObject({ chunks: 200, lost: 3, lateMs: 20 });
  player.destroy();
});
