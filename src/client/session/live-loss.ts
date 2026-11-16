import type * as Sendspin from "@sendspin/sendspin-js";

// Which Live chunks this listener lost to its own lateness, chunk by chunk. The SDK's player
// (scheduler.js) makes each decoded chunk a buffer (handleDecodedChunk → createBuffer) and starts it
// at its next batch, or drops it silently because its start has already passed. A chunk is lost
// when its start, its stamp less the output latency and Sync delay, passed and the player never
// started it. Chunks Core never sent can't count, nor ones a stream clear discarded, nor a step's
// changeover: Core stamps the chunks after it later, which the player can always start.
// Couch wraps the SDK's exported AudioScheduler and Web Audio's prototypes; the SDK is unchanged.
type Player = Sendspin.SendspinPlayer;

// A received buffer the player hasn't started, by its chunk's stamp (server time, µs).
const pending = new Map<AudioBuffer, number>();
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
// How long each chunk received this second had until its stamp, as it reached the player.
let margins: number[] = [];
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
  };
  const decoded = scheduling.handleDecodedChunk;
  scheduling.handleDecodedChunk = function (chunk) {
    heard(this);
    const listener = counting ? player() : null;
    if (!listener?.timeSyncInfo.synced) return decoded.call(this, chunk);
    margins.push((chunk.serverTimeUs - listener.getCurrentServerTimeUs()) / 1000);
    decoding = chunk.serverTimeUs;
    try {
      decoded.call(this, chunk);
    } finally {
      decoding = undefined;
    }
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
    if (buffer && !pending.delete(buffer) && read) pending.delete(read);
    read = undefined;
    return start.apply(this, args);
  };
}

// Count only while a Live listen samples it, so nothing piles up otherwise.
export function countingLiveLoss(on: boolean) {
  counting = on;
  if (!on) pending.clear();
}

// Once a second: the chunks received since the last sample, those lost, and the median time a
// chunk had until its stamp on arrival (it rises when Core moves this listener a step later).
// counted: the listener was playing on a running context, so what it lost was lost to lateness.
export function sampleLiveLoss(listener: Player, counted: boolean) {
  const context = scheduler?.getAudioContext();
  const sounding = counted && listener.timeSyncInfo.synced && context?.state === "running";
  const leadUs = (listener.syncInfo.outputLatencyMs + (scheduler?.getSyncDelayMs() ?? 0)) * 1000;
  // Infinity: what the player holds now can't be judged, so none of it counts.
  const passedUs = sounding ? listener.getCurrentServerTimeUs() - graceUs : Infinity;
  let lost = 0;
  for (const [buffer, stampUs] of pending)
    if (stampUs - leadUs <= passedUs) {
      pending.delete(buffer);
      lost++;
    }
  const sorted = margins.sort((a, b) => a - b);
  const second = {
    chunks: received,
    lost: sounding ? lost : 0,
    marginMs: sorted.length ? sorted[sorted.length >> 1] : undefined,
  };
  received = 0;
  margins = [];
  return second;
}

// Just after resume(), a context may report only its base latency; Chrome reports its output
// latency once its output runs. Safari before 18.4 never reports one (the SDK estimates it).
export const reportsOutputLatency = () => (scheduler?.getAudioContext()?.outputLatency ?? 0) > 0;
