// The Live player's timeline, as its AudioWorklet runs it (live-worklet.ts). Each decoded chunk comes
// with the context frame its first sample must be rendered at, so that it's heard at its stamp
// (live-feed.ts maps stamps to frames). Samples play one after another from a short queue:
// - The first chunk, and the first after the queue ran dry, starts exactly at its frame. What
//   already passed is skipped, so lateness never shifts the timeline.
// - While it plays, the timeline follows the frames it was given by playing slightly faster or
//   slower, never by a jump: the clocks drift apart slowly, and a late step (Core stamping later)
//   moves the frames by tens of ms.
// - A chunk is lost when it arrives after its first sample was due: its start passed, or the sound
//   it follows on from ran out before it came (Core sent nothing in between).
export type LiveChunk = { frame: number; stampUs: number; channels: Float32Array[] };
export type LiveMessage = { type: "chunk"; chunk: LiveChunk } | { type: "reset"; epoch: number };
// Where the context's clock stands, as the page reads it: context seconds less the page's performance
// seconds at the same instant.
export type LiveClock = { offset: number; sampleRate: number };
// The context frame heard at `pageMs` on the page's performance clock.
export const contextFrame = (clock: LiveClock, pageMs: number) =>
  (clock.offset + pageMs / 1000) * clock.sampleRate;
// A Worker's performance clock against its page's. Each realm reads the wall clock once, when it
// starts, for its timeOrigin: after a sleep or a clock change, a Worker started later names a
// different instant by the same timeOrigin + now. So the Worker measures it: the page sends its own
// performance.now() with each message, and the least difference to the Worker's (a message only
// arrives later, never earlier) is how far ahead the Worker's clock reads.
export function pageClock() {
  let aheadMs = Infinity;
  return {
    saw(pageMs: number, ownMs = performance.now()) {
      aheadMs = Math.min(aheadMs, ownMs - pageMs);
    },
    // The page's time for an instant on this realm's clock.
    pageMs: (ownMs = performance.now()) => ownMs - aheadMs,
  };
}
export type LiveStats = {
  chunks: number;
  lost: number;
  // The least time a chunk had before its first sample was due, in frames. Negative: how late the
  // latest lost chunk came, what a late step must add for it to come in time.
  slack: number;
  // Frames the timeline rendered silent while it expected sound, and samples it skipped as late.
  filled: number;
  skipped: number;
  // The sync error's range (frames, early positive) and how many corrections started.
  errorMin: number;
  errorMax: number;
  corrections: number;
};

// The SDK's own sync deadband (scheduler.js deadbandBelowMs: 1) and its soft correction rate,
// within the Sendspin spec's ±0.5 % and inaudible (RATE_CORRECTION_SOFT, 0.3 %).
const deadbandSec = 0.001;
const slewRate = 0.003;
// Beyond the SDK's resync threshold (resyncAboveMs: 200) the clock itself moved: slewing would take
// over a minute, so the timeline is placed again at once.
const replaceSec = 0.2;
// Stamps are whole µs: within this, a chunk follows on from the one before it. Well under a chunk
// (5 ms), so a chunk Core never sent never joins.
const joinUs = 1000;

export const noStats = (): LiveStats => ({
  chunks: 0,
  lost: 0,
  slack: Infinity,
  filled: 0,
  skipped: 0,
  errorMin: Infinity,
  errorMax: -Infinity,
  corrections: 0,
});

export function addStats(totals: LiveStats, stats: LiveStats) {
  totals.chunks += stats.chunks;
  totals.lost += stats.lost;
  totals.slack = Math.min(totals.slack, stats.slack);
  totals.filled += stats.filled;
  totals.skipped += stats.skipped;
  totals.errorMin = Math.min(totals.errorMin, stats.errorMin);
  totals.errorMax = Math.max(totals.errorMax, stats.errorMax);
  totals.corrections += stats.corrections;
}

export class LiveTimeline {
  private queue: LiveChunk[] = [];
  // Where the timeline reads in queue[0], in samples; fractional only while it corrects.
  private position = 0;
  private playing = false;
  // The queue ran dry while playing: the next chunk is due where the last one ended.
  private dry = false;
  private endStampUs: number | undefined;
  // -1 slows down (early), 1 speeds up (late), 0 plays as given.
  private correcting = 0;
  private settling = false;
  private rate = 1;
  stats = noStats();
  constructor(private readonly sampleRate: number) {}

  reset() {
    this.queue = [];
    this.playing = this.dry = this.settling = false;
    this.correcting = 0;
    this.rate = 1;
    this.endStampUs = undefined;
    this.stats = noStats();
  }

  takeStats() {
    const stats = this.stats;
    this.stats = noStats();
    return stats;
  }

  // `next`: the first frame the timeline hasn't rendered yet.
  push(chunk: LiveChunk, next: number) {
    const length = chunk.channels[0]?.length ?? 0;
    if (!length) return;
    const slack = this.playing ? this.queued() : chunk.frame - next;
    const follows =
      this.endStampUs !== undefined && Math.abs(chunk.stampUs - this.endStampUs) <= joinUs;
    this.stats.chunks++;
    this.stats.slack = Math.min(this.stats.slack, slack);
    if (slack < 0 || (this.dry && follows)) this.stats.lost++;
    this.dry = false;
    this.queue.push(chunk);
  }

  // Renders `output[0..]` (one array per channel) from context frame `frame` on.
  render(frame: number, output: Float32Array[]) {
    const frames = output[0]?.length ?? 0;
    if (this.playing) this.steer(frame);
    for (let i = 0; i < frames; i++) {
      if (!this.playing && !this.place(frame + i)) {
        for (const channel of output) channel[i] = 0;
        if (this.dry) this.stats.filled++;
        continue;
      }
      this.read(output, i);
    }
  }

  // Frames queued before the next chunk pushed would be read.
  private queued() {
    let frames = -this.position;
    for (const chunk of this.queue) frames += chunk.channels[0]!.length;
    return frames / this.rate;
  }

  // Starts on the first queued sample due at `frame`, skipping those already past.
  private place(frame: number) {
    while (this.queue.length) {
      const chunk = this.queue[0]!,
        offset = Math.round(frame - chunk.frame),
        length = chunk.channels[0]!.length;
      if (offset < 0) return false;
      if (offset < length) {
        this.stats.skipped += offset;
        this.position = offset;
        this.playing = true;
        return true;
      }
      this.stats.skipped += length;
      this.queue.shift();
    }
    return false;
  }

  private steer(frame: number) {
    const chunk = this.queue[0]!,
      error = chunk.frame + this.position - frame;
    this.stats.errorMin = Math.min(this.stats.errorMin, error);
    this.stats.errorMax = Math.max(this.stats.errorMax, error);
    if (Math.abs(error) > replaceSec * this.sampleRate) {
      this.playing = this.settling = false;
      this.correcting = 0;
      this.rate = 1;
      return;
    }
    const sign = Math.sign(error);
    if (!this.correcting && Math.abs(error) > deadbandSec * this.sampleRate) {
      this.correcting = sign;
      this.settling = false;
      this.rate = 1 - sign * slewRate;
      this.stats.corrections++;
    } else if (this.correcting && sign !== this.correcting) this.settling = true;
  }

  private read(output: Float32Array[], i: number) {
    const chunk = this.queue[0]!,
      index = Math.floor(this.position),
      fraction = this.position - index,
      next = this.queue[1];
    for (let c = 0; c < output.length; c++) {
      const samples = chunk.channels[c] ?? chunk.channels[0]!;
      const sample = samples[index]!;
      if (!fraction) {
        output[c]![i] = sample;
        continue;
      }
      const following =
        index + 1 < samples.length
          ? samples[index + 1]!
          : ((next?.channels[c] ?? next?.channels[0])?.[0] ?? sample);
      output[c]![i] = sample + (following - sample) * fraction;
    }
    this.position += this.rate;
    // Back to the samples as they are once the fraction is within a step of a whole sample: the
    // jump is under 0.3 % of a sample.
    if (this.settling) {
      const whole = Math.round(this.position);
      if (Math.abs(this.position - whole) < slewRate) {
        this.position = whole;
        this.rate = 1;
        this.correcting = 0;
        this.settling = false;
      }
    }
    const length = chunk.channels[0]!.length;
    if (this.position < length) return;
    this.position -= length;
    this.endStampUs = chunk.stampUs + (length / this.sampleRate) * 1e6;
    this.queue.shift();
    if (this.queue.length) return;
    this.playing = false;
    this.dry = true;
    this.correcting = 0;
    this.settling = false;
    this.rate = 1;
  }
}
