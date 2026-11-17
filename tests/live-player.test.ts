import { afterEach, expect, mock, test } from "bun:test";
import type { FromFeed, LiveFeed as Feed, ToFeed } from "../src/client/session/live-feed";
import { noStats, type LiveMessage, type LiveStats } from "../src/client/session/live-timeline";

// The SDK's protocol layer, as far as the Live player reaches it.
class FixtureCore {
  onStreamClear = () => {};
  onVolumeUpdate = () => {};
  onAudioData = (_chunk: unknown) => {};
  timeSyncInfo = { synced: true };
  volume = 100;
  muted = false;
  currentFormat = { sample_rate: 48_000 };
  // The synced clock (server time, µs).
  nowUs = 0;
  // Still connecting: nothing in these tests reaches Core.
  connect() {
    return new Promise<void>(() => {});
  }
  disconnect() {}
  handleBinaryMessage(_data: ArrayBuffer) {}
  getCurrentServerTimeUs() {
    return this.nowUs;
  }
  getSyncDelayMs() {
    return 0;
  }
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

// MessagePorts that deliver at once, so a test sees what reached the other end.
class FixturePort {
  other!: FixturePort;
  onmessage = (_event: { data: unknown }) => {};
  postMessage(data: unknown) {
    this.other.onmessage({ data });
  }
  close() {}
}
class FixtureChannel {
  port1 = new FixturePort();
  port2 = new FixturePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}
// The feed's Worker, run in this thread: messages go both ways at once.
let workers: FixtureWorker[] = [];
// A Worker whose script won't load runs nothing.
let unloadable = false;
class FixtureWorker {
  onmessage = (_event: { data: FromFeed }) => {};
  onerror = (_event: { message: string }) => {};
  feed: Feed | undefined;
  constructor() {
    workers.push(this);
  }
  postMessage(message: ToFeed) {
    if (unloadable) return;
    if (message.type === "start")
      this.feed = new LiveFeed(message.config, message.stored, message.pageMs, (data) =>
        this.onmessage({ data }),
      );
    else this.feed?.handle(message);
  }
}
// The worklet's side of its feed port: it reports with the epoch of the last reset it was sent.
class FixtureNode {
  epoch = 0;
  chunks = 0;
  frames: number[] = [];
  feed: FixturePort | undefined;
  port = {
    postMessage: ({ port }: { port: FixturePort }) => {
      this.feed = port;
      port.onmessage = ({ data }) => {
        const message = data as LiveMessage;
        if (message.type === "reset") this.epoch = message.epoch;
        else {
          this.chunks++;
          this.frames.push(message.chunk.frame);
        }
      };
    },
  };
  constructor() {
    nodes.push(this);
  }
  connect() {}
  disconnect() {}
  report(stats: LiveStats) {
    this.feed!.postMessage({ epoch: this.epoch, stats });
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
  getOutputTimestamp() {
    return { contextTime: 1, performanceTime: performance.now() };
  }
  resume() {}
  close() {
    return Promise.resolve();
  }
}
Object.assign(globalThis, {
  AudioContext: FixtureContext,
  AudioWorkletNode: FixtureNode,
  MessageChannel: FixtureChannel,
  Worker: FixtureWorker,
});
const { LiveFeed } = await import("../src/client/session/live-feed");
const { LivePlayer } = await import("../src/client/session/live-player");
// The feed reports at once when the volume changes, as it does ten times a second.
const flush = (core: FixtureCore) => core.onVolumeUpdate();
// The page reads its output every 20 ms; the feed maps stamps with the first reading.
const reading = () => new Promise((resolve) => setTimeout(resolve, 25));

afterEach(() => {
  cores = [];
  nodes = [];
  workers = [];
});

test("a Worker whose script doesn't load tells its owner, and connecting fails", async () => {
  unloadable = true;
  const player = new LivePlayer({ playerId: "fixture", baseUrl: "http://localhost" });
  const stopped: Error[] = [];
  player.onStopped = (reason) => stopped.push(reason);
  const connecting = player.connect();
  workers[0]!.onerror({ message: "Failed to fetch" });
  await expect(connecting).rejects.toThrow("The Live player stopped.");
  expect(stopped).toHaveLength(1);
  player.destroy();
  unloadable = false;
});

test("an error in a running Worker doesn't stop its player", () => {
  const player = new LivePlayer({ playerId: "fixture", baseUrl: "http://localhost" });
  const stopped: Error[] = [];
  player.onStopped = (reason) => stopped.push(reason);
  const logged = console.error;
  console.error = () => {};
  workers[0]!.onerror({ message: "Uncaught TypeError" });
  console.error = logged;
  expect(stopped).toEqual([]);
  player.destroy();
});

test("a stream cleared while the worklet loads still counts the loss the worklet reports", async () => {
  const player = new LivePlayer({ playerId: "fixture", baseUrl: "http://localhost" });
  const unlocked = player.unlock();
  cores[0]!.onStreamClear();
  loaded();
  await unlocked;
  nodes[0]!.report({ ...noStats(), chunks: 200, lost: 3, slack: -960 });
  flush(cores[0]!);
  expect(player.sampleLoss(true)).toMatchObject({ chunks: 200, lost: 3, lateMs: 20 });
  player.destroy();
});

test("a player with no need measures how late chunks arrive and plays none until Core places it", async () => {
  const player = new LivePlayer({
    playerId: "fixture",
    baseUrl: "http://localhost",
    minBufferMs: 0,
  });
  const unlocked = player.unlock();
  loaded();
  await unlocked;
  const core = cores[0]!,
    node = nodes[0]!;
  // A chunk Core sent `sendAheadMs` before its stamp, decoded `aheadMs` before it.
  const chunk = (sendAheadMs: number, aheadMs: number) => {
    const stampUs = (core.nowUs += 5_000) + aheadMs * 1000,
      header = new DataView(new ArrayBuffer(13));
    header.setUint8(0, 4);
    header.setBigInt64(1, BigInt(stampUs));
    header.setUint32(9, sendAheadMs * 1000);
    (core as unknown as { handleBinaryMessage(data: ArrayBuffer): void }).handleBinaryMessage(
      header.buffer,
    );
    core.onAudioData({
      serverTimeUs: stampUs,
      sampleRate: 48_000,
      samples: [new Float32Array(240), new Float32Array(240)],
    });
  };
  expect(player.measuring).toBe(true);
  chunk(1000, 998);
  chunk(1000, 940);
  chunk(1000, 990);
  // The latest arrived 60 ms after Core sent it, however late Core stamped it.
  flush(core);
  expect(player.sampleArrival()).toBe(60);
  expect(player.sampleArrival()).toBeUndefined();
  // A clear before it declared its need is another stream's: it still measures.
  core.onStreamClear();
  chunk(1000, 999);
  expect(player.measuring).toBe(true);
  player.declared();
  chunk(1000, 999);
  expect(node.chunks).toBe(0);
  flush(core);
  expect(player.sampleArrival()).toBe(1);
  // Core places it and clears its stream: what follows is stamped at its step, and plays.
  core.onStreamClear();
  flush(core);
  expect(player.measuring).toBe(false);
  await reading();
  chunk(102, 100);
  expect(node.chunks).toBe(1);
  flush(core);
  expect(player.sampleArrival()).toBeUndefined();
  player.destroy();
});

test("a player created with a need plays at once", async () => {
  const player = new LivePlayer({
    playerId: "fixture",
    baseUrl: "http://localhost",
    minBufferMs: 60,
  });
  expect(player.measuring).toBe(false);
  player.destroy();
});
