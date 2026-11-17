import {
  SendspinCore,
  type DecodedAudioChunk,
  type SendspinCoreConfig,
} from "@sendspin/sendspin-js";
import workletUrl from "./live-worklet.ts?worker&url";
import { arrivalLateMs, type LossSecond } from "./live-buffer";
import { addStats, noStats, type LiveMessage, type LiveStats } from "./live-timeline";

// Couch's player for Live listeners. The SDK's SendspinCore keeps the connection, its encryption,
// the clock sync and decoding; this plays what it decodes. The SDK's own player (scheduler.js)
// handles received chunks in batches 15 ms apart and starts each as its own buffer, so a chunk had
// to arrive an output latency plus that batch before its time. Here each decoded chunk goes straight
// to an AudioWorklet (live-timeline.ts) with the context frame it's due at, and needs to reach it
// only before that frame is rendered.

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
  return { offset, lead: context.currentTime - (offset + now / 1000), measured: true };
}
// Just after resume() a context may report only its base latency; Safari before 18.4 never reports
// an output latency.
function reported(context: AudioContext, now: number): Reading {
  const output = context.outputLatency || 0,
    lead = context.baseLatency + output;
  return { offset: context.currentTime - lead - now / 1000, lead, measured: output > 0 };
}

export class LivePlayer {
  private core: LiveCore;
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
  private epoch = 0;
  private interrupted = false;
  private second = noStats();
  private window = noStats();
  private windowStart = performance.now();
  // Before its first sound (live-buffer.ts measureSeconds): "measuring" while it measures how late
  // chunks reach it and plays none, "placing" once it declared its need, until Core clears its stream
  // to place it there (or starts it again). A player created with a need plays at once.
  private measure: "measuring" | "placing" | undefined;
  // How late the latest chunk measured since the last sample arrived (ms).
  private arrival: number | undefined;

  constructor(config: SendspinCoreConfig) {
    this.core = new LiveCore(config);
    this.measure = config.minBufferMs ? undefined : "measuring";
    this.core.onAudioData = (chunk) => this.play(chunk);
    this.core.onStreamStart = (_format, update) => {
      if (!update) this.restart();
    };
    this.core.onStreamClear = () => this.restart();
    this.core.onStreamEnd = () => this.restart();
    this.core.onVolumeUpdate = () => this.updateVolume();
  }

  connect() {
    return this.core.connect();
  }
  setMinBufferMs(value: number) {
    this.core.setMinBufferMs(value);
  }
  get isConnected() {
    return this.core.isConnected;
  }
  get isPlaying() {
    return this.core.isPlaying;
  }
  get timeSyncInfo() {
    return this.core.timeSyncInfo;
  }
  get trackProgress() {
    return this.core.trackProgress;
  }
  getCurrentServerTimeUs() {
    return this.core.getCurrentServerTimeUs();
  }

  // Call from a tap, before any other await, as the SDK's unlock().
  async unlock() {
    const context = this.open();
    if (context.state !== "running") await context.resume();
    await this.ready;
  }

  destroy() {
    clearInterval(this.reader);
    this.core.disconnect("user_request");
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
    return this.measure !== undefined;
  }
  // It declared its need: its next stream clear or start is Core placing it there.
  declared() {
    if (this.measure === "measuring") this.measure = "placing";
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
      this.core.timeSyncInfo.synced &&
      this.context?.state === "running" &&
      !!this.node;
    const { chunks, lost, slack } = this.second;
    const sendAheadMs = median(this.core.sendAheads);
    this.second = noStats();
    this.core.sendAheads = [];
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

  private open() {
    if (this.context) return this.context;
    // Browsers offer AudioWorklet only to secure pages: Couch's HTTPS address, or this computer's own.
    if (typeof AudioWorkletNode === "undefined")
      throw new Error("Live sound needs Couch's https:// address on this device.");
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    const context = new AudioContext({
      sampleRate: this.core.currentFormat?.sample_rate ?? 48_000,
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
      node.port.onmessage = ({ data }: MessageEvent<{ epoch: number; stats: LiveStats }>) =>
        this.report(data.epoch, data.stats);
      node.connect(gain);
      this.node = node;
      // A stream that cleared while the worklet loaded raised the epoch the reports must carry.
      this.post({ type: "reset", epoch: this.epoch });
    });
    return context;
  }

  private updateVolume() {
    const gain = this.gain,
      context = this.context;
    if (!gain || !context) return;
    const target = gainOf(this.core.volume, this.core.muted);
    gain.gain.setTargetAtTime(target, context.currentTime, volumeRampSec);
  }

  private post(message: LiveMessage) {
    this.node?.port.postMessage(message);
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
    this.post({ type: "reset", epoch: this.epoch });
  }

  // The context stopped or ran again: its clock no longer stands where the readings put it.
  private interrupt() {
    this.interrupted = true;
    this.readings = [];
    this.offset = this.startedAt = undefined;
    this.reset();
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
    this.offset = median(this.readings.map(({ offset }) => offset));
    if (now - this.windowStart >= statusMs) this.status(now);
  }

  private play(chunk: DecodedAudioChunk) {
    const sendAheadMs = this.core.received.get(chunk.serverTimeUs);
    this.core.received.delete(chunk.serverTimeUs);
    if (this.measure) {
      if (sendAheadMs !== undefined && this.core.timeSyncInfo.synced) {
        const late = arrivalLateMs(
          sendAheadMs,
          chunk.serverTimeUs,
          this.core.getCurrentServerTimeUs(),
        );
        this.arrival = Math.max(this.arrival ?? -Infinity, late);
      }
      return;
    }
    const context = this.context;
    if (!this.node || context?.state !== "running" || !this.core.timeSyncInfo.synced) return;
    // Core's Live wire is 48 kHz, the rate the context opens at.
    if (chunk.sampleRate !== context.sampleRate) return;
    const now = performance.now();
    if (this.offset === undefined) this.read(now);
    const offset = this.offset;
    if (offset === undefined) return;
    const heardMs =
      now +
      (chunk.serverTimeUs - this.core.getCurrentServerTimeUs()) / 1000 -
      this.core.getSyncDelayMs();
    const frame = (offset + heardMs / 1000) * context.sampleRate;
    this.post({
      type: "chunk",
      chunk: { frame, stampUs: chunk.serverTimeUs, channels: chunk.samples },
    });
  }

  private report(epoch: number, stats: LiveStats) {
    if (epoch !== this.epoch) return;
    addStats(this.second, stats);
    addStats(this.window, stats);
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
