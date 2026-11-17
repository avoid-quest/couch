import {
  SendspinCore,
  type DecodedAudioChunk,
  type SendspinCoreConfig,
} from "@sendspin/sendspin-js";
import { arrivalLateMs } from "./live-buffer";
import {
  addStats,
  contextFrame,
  noStats,
  type LiveClock,
  type LiveMessage,
  type LiveStats,
} from "./live-timeline";

// The Live player's feed, in its own Worker (live-feed-worker.ts): the SDK's SendspinCore keeps the
// connection, its encryption, the clock sync and decoding, and each decoded chunk goes from here
// straight to the AudioWorklet through a port, with the context frame it's due at. Nothing on its way
// waits for the page's main thread, where a render or a busy moment would hold every chunk behind it.
// The page (live-player.ts) keeps the AudioContext, its output readings and volume, and sends the
// clock this maps stamps with.

// Sendspin's audio chunk: type 4, its stamp (int64), then send_ahead (uint32, µs), which Core writes
// as it sends: half a step more shows Core applied a step (live-buffer.ts).
class LiveCore extends SendspinCore {
  sendAheads: number[] = [];
  // While the player measures: each received chunk's send_ahead, by its stamp, until it's decoded.
  received = new Map<number, number>();
  override handleBinaryMessage(data: ArrayBuffer) {
    const view = new DataView(data);
    if (view.byteLength >= 13 && view.getUint8(0) === 4) {
      const sendAheadMs = view.getUint32(9) / 1000;
      this.sendAheads.push(sendAheadMs);
      this.received.set(Number(view.getBigInt64(1)), sendAheadMs);
    }
    super.handleBinaryMessage(data);
  }
}

type State = Parameters<NonNullable<SendspinCoreConfig["onStateChange"]>>[0];
// What the page passes on: the SDK's config without its callbacks and storage, which stay on the page.
export type FeedConfig = Omit<SendspinCoreConfig, "storage" | "onStateChange">;
export type ToFeed =
  | { type: "start"; config: FeedConfig; stored: [string, string][] }
  | { type: "connect" }
  | { type: "minBuffer"; ms: number }
  // The worklet's end of the port this feeds it through.
  | { type: "port"; port: MessagePort }
  // Where the context's clock stands; none while it isn't running.
  | { type: "clock"; clock?: LiveClock }
  // The context stopped or ran again: what the worklet holds no longer fits its clock.
  | { type: "reset" }
  | { type: "declared" }
  | { type: "destroy" };
// What the page reads. `at` is when, on the shared clock (performance.timeOrigin + now).
export type FeedStatus = {
  at: number;
  connected: boolean;
  playing: boolean;
  timeSync: { synced: boolean; offset: number; error: number };
  progress: {
    positionMs: number;
    durationMs: number;
    playbackSpeed: number;
  } | null;
  sampleRate: number | undefined;
  volume: number;
  muted: boolean;
  measuring: boolean;
  // Since the last status: the latest arrival measured (ms), each chunk's send_ahead, and what the
  // worklet reported for the stream it plays now.
  arrival: number | undefined;
  sendAheads: number[];
  stats: LiveStats;
};
export type FromFeed =
  | { type: "status"; status: FeedStatus }
  | { type: "state"; state: State }
  | { type: "store"; key: string; value: string }
  | { type: "connected"; error?: string };

// Ten a second, as often as the worklet reports: the page samples once a second, so a second's loss
// is never counted far from it, and what it reads of the connection is never more than this old.
const statusMs = 100;

export class LiveFeed {
  private core: LiveCore;
  private port: MessagePort | undefined;
  private clock: LiveClock | undefined;
  private epoch = 0;
  // Before its first sound (live-buffer.ts measureSeconds): "measuring" while it measures how late
  // chunks reach it and plays none, "placing" once it declared its need, until Core clears its stream
  // to place it there (or starts it again). A player created with a need plays at once.
  private measure: "measuring" | "placing" | undefined;
  private arrival: number | undefined;
  private stats = noStats();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    config: FeedConfig,
    stored: [string, string][],
    private post: (message: FromFeed) => void,
  ) {
    // The SDK reads its identity and settings once; what it saves goes back to the page's storage.
    const values = new Map(stored);
    this.core = new LiveCore({
      ...config,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
          post({ type: "store", key, value });
        },
      },
      onStateChange: (state) => post({ type: "state", state }),
    });
    this.measure = config.minBufferMs ? undefined : "measuring";
    this.core.onAudioData = (chunk) => this.play(chunk);
    this.core.onStreamStart = (_format, update) => {
      if (!update) this.restart();
    };
    this.core.onStreamClear = () => this.restart();
    this.core.onStreamEnd = () => this.restart();
    this.core.onVolumeUpdate = () => this.report();
    this.timer = setInterval(() => this.report(), statusMs);
    this.report();
  }

  handle(message: ToFeed) {
    switch (message.type) {
      case "connect":
        return void this.core.connect().then(
          () => this.post({ type: "connected" }),
          (reason: unknown) => this.post({ type: "connected", error: String(reason) }),
        );
      case "minBuffer":
        return this.core.setMinBufferMs(message.ms);
      case "port":
        this.port = message.port;
        this.port.onmessage = ({ data }: MessageEvent<{ epoch: number; stats: LiveStats }>) => {
          if (data.epoch === this.epoch) addStats(this.stats, data.stats);
        };
        // A stream that cleared before the worklet loaded raised the epoch its reports must carry.
        return this.send({ type: "reset", epoch: this.epoch });
      case "clock":
        this.clock = message.clock;
        return;
      case "reset":
        return this.reset();
      case "declared":
        if (this.measure === "measuring") this.measure = "placing";
        return;
      case "destroy":
        clearInterval(this.timer);
        this.core.disconnect("user_request");
        this.port?.close();
        return;
    }
  }

  private send(message: LiveMessage) {
    this.port?.postMessage(message);
  }

  // Core cleared or started its stream: chunks from then on are stamped where it's placed.
  private restart() {
    if (this.measure === "placing") this.measure = undefined;
    this.core.received.clear();
    this.reset();
  }

  // What the worklet holds belongs to a stream that ended, or to a clock that stopped.
  private reset() {
    this.epoch++;
    this.send({ type: "reset", epoch: this.epoch });
  }

  private report() {
    const core = this.core;
    this.post({
      type: "status",
      status: {
        at: performance.timeOrigin + performance.now(),
        connected: core.isConnected,
        playing: core.isPlaying,
        timeSync: core.timeSyncInfo,
        progress: core.trackProgress,
        sampleRate: core.currentFormat?.sample_rate,
        volume: core.volume,
        muted: core.muted,
        measuring: this.measure !== undefined,
        arrival: this.arrival,
        sendAheads: core.sendAheads,
        stats: this.stats,
      },
    });
    this.arrival = undefined;
    core.sendAheads = [];
    this.stats = noStats();
  }

  private play(chunk: DecodedAudioChunk) {
    const core = this.core;
    const sendAheadMs = core.received.get(chunk.serverTimeUs);
    core.received.delete(chunk.serverTimeUs);
    if (this.measure) {
      if (sendAheadMs !== undefined && core.timeSyncInfo.synced) {
        const late = arrivalLateMs(sendAheadMs, chunk.serverTimeUs, core.getCurrentServerTimeUs());
        this.arrival = Math.max(this.arrival ?? -Infinity, late);
      }
      return;
    }
    const clock = this.clock;
    // Core's Live wire is 48 kHz, the rate the context opens at.
    if (!this.port || !clock || !core.timeSyncInfo.synced || chunk.sampleRate !== clock.sampleRate)
      return;
    const heardMs =
      performance.now() +
      (chunk.serverTimeUs - core.getCurrentServerTimeUs()) / 1000 -
      core.getSyncDelayMs();
    this.send({
      type: "chunk",
      chunk: {
        frame: contextFrame(clock, heardMs),
        stampUs: chunk.serverTimeUs,
        channels: chunk.samples,
      },
    });
  }
}
