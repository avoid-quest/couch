import type * as Sendspin from "@sendspin/sendspin-js";
import type { LossSecond } from "./live-buffer";

// Which Live chunks this listener lost to its own lateness, chunk by chunk. The SDK's player
// (scheduler.js) makes each decoded chunk a buffer (handleDecodedChunk → createBuffer) and starts it
// at its next batch, or drops it silently because its start has already passed. A chunk is lost
// when its start, its stamp less the output latency and Sync delay, passed and the player never
// started it. Chunks Core never sent can't count, nor ones a stream clear discarded, nor a step's
// changeover: Core stamps the chunks after it later, which the player can always start. Nor chunks
// whose start fell while the context wasn't running: it plays nothing then.
// A chunk the player started too late counts too: its sound ran out while it held the chunk (a
// busy page runs its batch after the last chunk ended), so the chunk starts after a silence. It
// counts only when its stamp follows on from the chunk before it (Core sent nothing in between) and
// it was received before that chunk ended. A chunk the player dropped breaks that chain, so it
// counts once. More lead cures both: the next batch has longer before the sound runs out.
// Nor chunks the player discarded in a guarded cutover (scheduler.js performGuardedCutover, on a
// sync recorrection or a Sync delay or clock change): it starts nothing in its 0.3 s guard and
// drops what falls in it, however early it arrived. They're excused from the cutover on, so a
// sample before the player starts its next chunk can't count them.
// How late a dropped chunk was: how far its start had passed when the player's batch dropped it.
// That's what a step must add for the batch to start it. A started-late chunk has no lateness: it
// wasn't late, the page was busy.
// Couch wraps the SDK's exported AudioScheduler and Web Audio's prototypes; the SDK is unchanged.
type Player = Sendspin.SendspinPlayer;

// A received buffer the player hasn't started, by its chunk's stamp (server time, µs).
const pending = new Map<AudioBuffer, number>();
// Each received buffer's stamp, and when it was received on its context's clock (s).
const receivedBuffers = new WeakMap<AudioBuffer, { stampUs: number; at: number }>();
// How far each received buffer's start had passed at the batch that left it unstarted (ms).
const lateness = new WeakMap<AudioBuffer, number>();
// The last received chunk the player started: where its sound ends (context clock, s) and where its
// stamp ends (µs).
let chain: { end: number; stampEndUs: number } | undefined;
// Stamps are whole µs and the player starts each chunk on its nearest frame (half a sample): within
// this, two chunks join. Well under a chunk (15 or 20 ms), so a chunk Core never sent never joins.
const joinSec = 0.001;
let dried = 0;
// The stamps each recent guarded cutover may have discarded (µs).
let cuts: { fromUs: number; toUs: number }[] = [];
// RECORRECTION_CUTOVER_GUARD_SEC (recorrection-monitor.js), which the SDK doesn't export.
const cutoverGuardUs = 300_000;
let counting = false;
let installed = false;
let scheduler: Sendspin.AudioScheduler | undefined;
let player: () => Player | null = () => null;
// The stamp of the chunk the player is making a buffer of right now.
let decoding: number | undefined;
// The player corrects a chunk by a sample by copying it, reading the received buffer, and starts
// the copy in the same task: the received buffer it read last is the copy's.
let read: AudioBuffer | undefined;
let received = 0;
// How far ahead of its stamp Core sent each chunk received this second (send_ahead).
let sendAheads: number[] = [];
// The context left or resumed running since the last sample.
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  chain = undefined;
};
const leadUs = (listener: Player) =>
  (listener.syncInfo.outputLatencyMs + (scheduler?.getSyncDelayMs() ?? 0)) * 1000;
// A chunk whose start passed less than this ago may still be in the player's batch, which runs
// 15 ms after a chunk arrives; the player's smoothed output latency also differs from the reading
// by a few ms. Such a chunk is judged at the next sample instead.
const graceUs = 100_000;
const heard = (playing: Sendspin.AudioScheduler) => {
  scheduler = playing;
};
const readFrom = (buffer: AudioBuffer) => {
  read = buffer;
  queueMicrotask(() => {
    if (read === buffer) read = undefined;
  });
};

export function countLiveLoss(sendspin: typeof Sendspin, current: () => Player | null) {
  player = current;
  // A test's stand-in library may have only the player.
  if (installed || !sendspin.AudioScheduler || typeof AudioBufferSourceNode === "undefined") return;
  installed = true;
  const scheduling = sendspin.AudioScheduler.prototype;
  const init = scheduling.initAudioContext;
  scheduling.initAudioContext = function () {
    heard(this);
    init.call(this);
    this.getAudioContext()?.addEventListener("statechange", interrupt);
  };
  // Sendspin's audio chunk: type 4, its stamp (int64), then send_ahead (uint32, µs).
  const message = sendspin.SendspinCore?.prototype.handleBinaryMessage;
  if (message)
    sendspin.SendspinCore.prototype.handleBinaryMessage = function (data) {
      const view = new DataView(data);
      if (counting && view.byteLength >= 13 && view.getUint8(0) === 4)
        sendAheads.push(view.getUint32(9) / 1000);
      message.call(this, data);
    };
  const decoded = scheduling.handleDecodedChunk;
  scheduling.handleDecodedChunk = function (chunk) {
    heard(this);
    const listener = counting ? player() : null;
    if (!listener?.timeSyncInfo.synced) return decoded.call(this, chunk);
    decoding = chunk.serverTimeUs;
    try {
      decoded.call(this, chunk);
    } finally {
      decoding = undefined;
    }
  };
  // A private method: wrapped only where the SDK still has it.
  const cutting = scheduling as unknown as {
    performGuardedCutover?: (...args: unknown[]) => void;
  };
  const cutover = cutting.performGuardedCutover;
  if (cutover)
    cutting.performGuardedCutover = function (this: Sendspin.AudioScheduler, ...args) {
      const listener = counting ? player() : null;
      // From the first stamp whose start hadn't passed to the guard's end, plus the grace: the
      // player's smoothed output latency differs a little from the reading, and the chunk the
      // guard keeps playing may end up to a chunk past it.
      if (listener?.timeSyncInfo.synced) {
        const fromUs = listener.getCurrentServerTimeUs() + leadUs(listener);
        cuts.push({ fromUs, toUs: fromUs + cutoverGuardUs + graceUs });
      }
      chain = undefined;
      cutover.apply(this, args);
    };
  // The player drops a chunk in its batch, as its start has passed (scheduleTime < currentTime):
  // whatever the batch left unstarted with a passed start, it dropped.
  const batch = scheduling.processAudioQueue;
  scheduling.processAudioQueue = function (
    this: Sendspin.AudioScheduler,
    ...args: Parameters<typeof batch>
  ) {
    const listener = counting ? player() : null;
    const nowUs = listener?.timeSyncInfo.synced ? listener.getCurrentServerTimeUs() : undefined;
    batch.apply(this, args);
    if (nowUs === undefined) return;
    const lead = leadUs(listener!);
    for (const [buffer, stampUs] of pending)
      if (!lateness.has(buffer) && stampUs - lead < nowUs)
        lateness.set(buffer, (nowUs - stampUs + lead) / 1000);
  };
  const clear = scheduling.clearBuffers;
  scheduling.clearBuffers = function () {
    pending.clear();
    clear.call(this);
  };
  const createBuffer = BaseAudioContext.prototype.createBuffer;
  BaseAudioContext.prototype.createBuffer = function (this: BaseAudioContext, ...args) {
    const buffer = createBuffer.apply(this, args);
    if (decoding !== undefined) {
      pending.set(buffer, decoding);
      receivedBuffers.set(buffer, { stampUs: decoding, at: this.currentTime });
      received++;
      decoding = undefined;
    }
    return buffer;
  };
  const channel = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function (this: AudioBuffer, ...args) {
    if (pending.has(this)) readFrom(this);
    return channel.apply(this, args);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
    const buffer = this.buffer;
    const chunk = buffer && (receivedBuffers.get(buffer) ?? (read && receivedBuffers.get(read)));
    if (buffer && !pending.delete(buffer) && read) pending.delete(read);
    read = undefined;
    if (chunk) {
      const [when = 0, offset = 0] = args,
        now = this.context.currentTime;
      const follows = chain && Math.abs(chunk.stampUs - chain.stampEndUs) <= joinSec * 1e6;
      if (follows && chunk.at <= chain!.end && now > chain!.end + joinSec) dried++;
      chain = {
        end: Math.max(when, now) + (buffer.duration - offset) / this.playbackRate.value,
        stampEndUs: chunk.stampUs + buffer.duration * 1e6,
      };
    }
    return start.apply(this, args);
  };
}

// Count only while a Live listen samples it, so nothing piles up otherwise.
export function countingLiveLoss(on: boolean) {
  counting = on;
  if (on) return;
  pending.clear();
  chain = undefined;
  cuts = [];
  dried = 0;
}

// Once a second: the chunks received since the last sample, those lost (dropped or started after a
// silence), how late the latest dropped one was, how far ahead of their stamps Core sent them (the median rises when Core moves this
// listener a step later). Undefined when the second can't be
// counted: the listener wasn't playing on a context that ran throughout it.
export function sampleLiveLoss(listener: Player, counted: boolean): LossSecond | undefined {
  const context = scheduler?.getAudioContext();
  const sounding =
    counted && !interrupted && listener.timeSyncInfo.synced && context?.state === "running";
  const lead = leadUs(listener);
  // Infinity: what the player holds now can't be judged, so none of it counts.
  const passedUs = sounding ? listener.getCurrentServerTimeUs() - graceUs : Infinity;
  let lost = 0,
    lateMs: number | undefined;
  for (const [buffer, stampUs] of pending)
    if (stampUs - lead <= passedUs) {
      pending.delete(buffer);
      if (cuts.some((cut) => stampUs >= cut.fromUs && stampUs < cut.toUs)) continue;
      lost++;
      const missedBy = lateness.get(buffer);
      if (missedBy !== undefined) lateMs = Math.max(lateMs ?? 0, missedBy);
    }
  cuts = cuts.filter((cut) => cut.toUs - lead > passedUs);
  const sorted = sendAheads.sort((a, b) => a - b);
  const second = {
    chunks: received,
    lost: lost + dried,
    sendAheadMs: sorted.length ? sorted[sorted.length >> 1] : undefined,
    lateMs,
  };
  received = 0;
  dried = 0;
  sendAheads = [];
  interrupted = false;
  return sounding ? second : undefined;
}

// Just after resume(), a context may report only its base latency; Chrome reports its output
// latency once its output runs. Safari before 18.4 never reports one (the SDK estimates it).
export const reportsOutputLatency = () => (scheduler?.getAudioContext()?.outputLatency ?? 0) > 0;
