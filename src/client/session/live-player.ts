import type { SendspinCoreConfig } from "@sendspin/sendspin-js";
import workletUrl from "./live-worklet.ts?worker&url";
import type { LossSecond } from "./live-buffer";
import type { FeedStatus, FromFeed, FeedMessage } from "./live-feed";
import { addStats, noStats, type LiveClock } from "./live-timeline";

// Couch's player for Live listeners. Its feed (live-feed.ts), in its own Worker, keeps the SDK's
// connection, clock sync and decoding, and hands each decoded chunk straight to an AudioWorklet
// (live-timeline.ts) with the context frame it's due at; it needs to reach it only before that frame
// is rendered. The SDK's own player (scheduler.js) handles received chunks in batches 15 ms apart and
// starts each as its own buffer, so a chunk had to arrive an output latency plus that batch before
// its time. This page keeps the AudioContext, its output readings, volume and what the listener
// declares, none of which waits on a chunk.

// The SDK's storage keys (its identity, volume, Sync delay, pairing and output latency stores). The feed
// reads them once; what it saves comes back here.
const sdkKeys = [
  "sendspin-identity-sk",
  "sendspin-volume",
  "sendspin-muted",
  "sendspin-psks",
  "sendspin-pairing-psk",
  "sendspin-pair-failures",
  "sendspin-static-delay-ms-v2",
  "sendspin-output-latency-us",
];

// Chromium's getOutputTimestamp() gives the frame being heard and when; Firefox and Safari give the
// frame being rendered (the SDK's reportsContextTimeAtRenderPosition, which it doesn't export).
// There the output latency the context reports stands in. Android and iOS play Live with the SDK's
// player (sendspin.ts).
const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const heardStamps = !(
  /Firefox/i.test(userAgent) ||
  (/Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|OPR/i.test(userAgent))
);
// Readings 20 ms apart land at different points of a render callback (2.7 to 21 ms at 48 kHz), so the
// highest lead of a second's readings is within a millisecond of the most the render clock runs
// ahead. The player reads from the last second of them, so the median clock offset follows a change
// of output within a second.
const readingMs = 20;
const windowMs = 1000;
// An output fills its buffers after it starts: on Linux's PulseAudio the lead read 40 to 66 ms in its
// first second, then 47 to 56. The need is read from the seconds after it.
const settleMs = 1000;
const statusMs = 10_000;
// The SDK's volume curve and ramp (scheduler.js perceptualGain, VOLUME_RAMP_TIME_CONSTANT_SEC).
const gainOf = (volume: number, muted: boolean) => (muted ? 0 : (volume / 100) ** 1.5);
const volumeRampSec = 0.015;

const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : undefined;

// Where the context's clock stands against performance.now() (context seconds minus performance
// seconds at the same heard instant), and how far the render clock runs ahead of what's heard.
type Reading = { offset: number; lead: number; measured: boolean };
function heard(context: AudioContext, now: number): Reading | undefined {
  // Hidden while relaxed sound plays on Android (sendspin.ts); zero until the output runs.
  const stamp = context.getOutputTimestamp?.();
  if (!stamp?.contextTime || !stamp.performanceTime) return undefined;
  const offset = stamp.contextTime - stamp.performanceTime / 1000;
  return {
    offset,
    lead: context.currentTime - (offset + now / 1000),
    measured: true,
  };
}
// Just after resume() a context may report only its base latency; Safari before 18.4 never reports
// an output latency.
function reported(context: AudioContext, now: number): Reading {
  const output = context.outputLatency || 0,
    lead = context.baseLatency + output;
  return {
    offset: context.currentTime - lead - now / 1000,
    lead,
    measured: output > 0,
  };
}

export class LivePlayer {
  // Told when the Worker fails, so its owner can start a new player.
  onStopped: ((reason: Error) => void) | undefined;
  private worker: Worker;
  private storage: SendspinCoreConfig["storage"];
  private onStateChange: SendspinCoreConfig["onStateChange"];
  // What the feed last reported, and the promises connect() returned.
  private feed: FeedStatus | undefined;
  private connecting: {
    resolve: () => void;
    reject: (reason: Error) => void;
  }[] = [];
  private context: AudioContext | undefined;
  private gain: GainNode | undefined;
  private node: AudioWorkletNode | undefined;
  private ready: Promise<void> | undefined;
  // The last second's readings, their median clock offset, and when the output first gave one.
  private readings: (Reading & { at: number })[] = [];
  private offset: number | undefined;
  private startedAt: number | undefined;
  private measured = false;
  private reader: ReturnType<typeof setInterval> | undefined;
  private interrupted = false;
  // What the feed reported since the last sample, and since the last status line.
  private second = noStats();
  private window = noStats();
  private windowStart = performance.now();
  private sendAheads: number[] = [];
  private arrival: number | undefined;
  // Whether it measures or waits to be placed (live-feed.ts): what the feed last said, from the start
  // a player created with no need measures.
  private measure: boolean;

  constructor(config: SendspinCoreConfig) {
    const { storage, onStateChange, ...rest } = config;
    this.storage = storage;
    this.onStateChange = onStateChange;
    this.measure = !config.minBufferMs;
    const stored = sdkKeys.flatMap((key) => {
      const value = storage?.getItem(key);
      return value == null ? [] : [[key, value] as [string, string]];
    });
    this.worker = new Worker(new URL("./live-feed-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }: MessageEvent<FromFeed>) => this.receive(data);
    // A Worker whose script didn't load has no connection to retry. Once it runs (it reports ten
    // times a second), an uncaught error doesn't stop it, so it plays on.
    this.worker.onerror = (event) => {
      if (this.feed) return console.error("Couch live feed:", event.message);
      const error = new Error("The Live player stopped.");
      for (const { reject } of this.connecting.splice(0)) reject(error);
      this.onStopped?.(error);
    };
    this.send({ type: "start", config: rest, stored });
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.connecting.push({ resolve, reject });
      this.send({ type: "connect" });
    });
  }
  setMinBufferMs(ms: number) {
    this.send({ type: "minBuffer", ms });
  }
  get isConnected() {
    return this.feed?.connected ?? false;
  }
  get isPlaying() {
    return this.feed?.playing ?? false;
  }
  get timeSyncInfo() {
    return this.feed?.timeSync ?? { synced: false, offset: 0, error: 0 };
  }
  // Where the track is now: where the feed last read it, moved on since at its speed.
  get trackProgress() {
    const progress = this.feed?.progress;
    if (!progress) return null;
    const passedMs = performance.now() - this.feed!.at,
      positionMs = progress.positionMs + passedMs * progress.playbackSpeed;
    return {
      ...progress,
      positionMs: progress.durationMs ? Math.min(positionMs, progress.durationMs) : positionMs,
    };
  }

  // Call from a tap, before any other await, as the SDK's unlock().
  async unlock() {
    const context = this.open();
    if (context.state !== "running") await context.resume();
    await this.ready;
  }

  destroy() {
    clearInterval(this.reader);
    // The feed says goodbye to Core and closes its Worker.
    this.send({ type: "destroy" });
    this.node?.disconnect();
    void this.context?.close().catch(() => {});
    this.context = this.gain = this.node = undefined;
  }

  // The most the render clock ran ahead of what's heard over the last second (ms): how long before
  // its time a sample must reach the worklet. Undefined until the output has settled.
  outputMs() {
    const settled =
      this.startedAt !== undefined && performance.now() - this.startedAt >= settleMs + windowMs;
    return settled ? Math.max(...this.readings.map(({ lead }) => lead)) * 1000 : undefined;
  }
  // The reading includes the output's own latency, not only the context's base latency.
  get measuresOutput() {
    return this.measured;
  }

  // Whether it still measures, or waits to be placed: it plays nothing.
  get measuring() {
    return this.measure;
  }
  // It declared its need: its next stream clear or start is Core placing it there.
  declared() {
    this.send({ type: "declared" });
  }
  // Once a second while it measures: how late the latest chunk since the last sample arrived.
  sampleArrival() {
    const arrival = this.arrival;
    this.arrival = undefined;
    return arrival;
  }

  // Once a second: the chunks received since the last sample, those lost, how far ahead of their
  // stamps Core sent them, and how late the latest lost chunk reached the worklet. Only a lost chunk
  // has negative slack; one lost because the sound before it ran out early has none, so no lateness.
  // Undefined when the second can't be counted: the listener wasn't playing on a context that ran
  // throughout it.
  sampleLoss(counted: boolean): LossSecond | undefined {
    const sounding =
      counted &&
      !this.interrupted &&
      this.timeSyncInfo.synced &&
      this.context?.state === "running" &&
      !!this.node;
    const { chunks, lost, slack } = this.second;
    const sendAheadMs = median(this.sendAheads);
    this.second = noStats();
    this.sendAheads = [];
    this.interrupted = false;
    if (!sounding) return undefined;
    const rate = this.context!.sampleRate;
    return {
      chunks,
      lost,
      sendAheadMs,
      lateMs: slack < 0 ? (-slack / rate) * 1000 : undefined,
    };
  }

  private send(message: FeedMessage, transfer: Transferable[] = []) {
    this.worker.postMessage({ ...message, pageMs: performance.now() }, transfer);
  }

  private receive(message: FromFeed) {
    if (message.type === "state") return this.onStateChange?.(message.state);
    if (message.type === "store") return this.storage?.setItem(message.key, message.value);
    if (message.type === "connected") {
      for (const { resolve, reject } of this.connecting.splice(0))
        if (message.error) reject(new Error(message.error));
        else resolve();
      return;
    }
    const status = message.status,
      volumeChanged = status.volume !== this.feed?.volume || status.muted !== this.feed?.muted;
    this.feed = status;
    this.measure = status.measuring;
    if (status.arrival !== undefined)
      this.arrival = Math.max(this.arrival ?? -Infinity, status.arrival);
    this.sendAheads.push(...status.sendAheads);
    addStats(this.second, status.stats);
    addStats(this.window, status.stats);
    if (volumeChanged) this.updateVolume();
  }

  private open() {
    if (this.context) return this.context;
    // Browsers offer AudioWorklet only to secure pages: Couch's HTTPS address, or this computer's own.
    if (typeof AudioWorkletNode === "undefined")
      throw new Error("Live sound needs Couch's https:// address on this device.");
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    const context = new AudioContext({
      sampleRate: this.feed?.sampleRate ?? 48_000,
    });
    const gain = context.createGain();
    this.context = context;
    this.gain = gain;
    this.updateVolume();
    gain.connect(context.destination);
    context.addEventListener("statechange", () => this.interrupt());
    this.reader = setInterval(() => this.read(), readingMs);
    this.ready = context.audioWorklet.addModule(workletUrl).then(() => {
      if (this.context !== context) return;
      const node = new AudioWorkletNode(context, "couch-live", {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      node.connect(gain);
      this.node = node;
      // Chunks and the worklet's reports pass between the feed and the worklet directly.
      const { port1, port2 } = new MessageChannel();
      node.port.postMessage({ port: port1 }, [port1]);
      this.send({ type: "port", port: port2 }, [port2]);
      this.sendClock();
    });
    return context;
  }

  private updateVolume() {
    const gain = this.gain,
      context = this.context,
      feed = this.feed;
    if (!gain || !context || !feed) return;
    gain.gain.setTargetAtTime(gainOf(feed.volume, feed.muted), context.currentTime, volumeRampSec);
  }

  // Where the context's clock stands, for the feed to map stamps with; none until it's read.
  private sendClock() {
    const context = this.context,
      offset = this.offset;
    const clock: LiveClock | undefined =
      context && offset !== undefined
        ? {
            offset,
            sampleRate: context.sampleRate,
          }
        : undefined;
    this.send({ type: "clock", clock });
  }

  // The context stopped or ran again: its clock no longer stands where the readings put it.
  private interrupt() {
    this.interrupted = true;
    this.readings = [];
    this.offset = this.startedAt = undefined;
    this.sendClock();
    this.send({ type: "reset" });
  }

  private read(now = performance.now()) {
    const context = this.context;
    if (context?.state !== "running") return;
    const reading = heardStamps ? heard(context, now) : reported(context, now);
    if (!reading) return;
    this.measured = reading.measured;
    this.startedAt ??= now;
    while (this.readings.length && now - this.readings[0]!.at >= windowMs) this.readings.shift();
    this.readings.push({ ...reading, at: now });
    const offset = median(this.readings.map(({ offset }) => offset));
    if (offset !== this.offset) {
      this.offset = offset;
      this.sendClock();
    }
    if (now - this.windowStart >= statusMs) this.status(now);
  }

  // One console line every 10 s while it plays, as the SDK's player logs its own.
  private status(now: number) {
    const ms = (frames: number) =>
      Number.isFinite(frames) ? ((frames / this.context!.sampleRate) * 1000).toFixed(1) : "-";
    const { chunks, lost, slack, filled, skipped, errorMin, errorMax, corrections } = this.window;
    console.log(
      `Couch live player: ${((now - this.windowStart) / 1000).toFixed(1)} s, ${chunks} chunks, ${lost} lost` +
        ` | slack min ${ms(slack)} ms | filled ${ms(filled)} ms, skipped ${ms(skipped)} ms` +
        ` | sync error ${ms(errorMin)} .. ${ms(errorMax)} ms, ${corrections} corrections` +
        ` | lead ${this.outputMs()?.toFixed(1) ?? "-"} ms, ctx ${this.context?.state}`,
    );
    this.window = noStats();
    this.windowStart = now;
  }
}
