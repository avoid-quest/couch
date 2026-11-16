import type * as Sendspin from "@sendspin/sendspin-js";

// Diagnostic only: drop this file and its calls in sendspin.ts. Every 10 s of Live, one console line
// ("Couch live margin: ...") on how much time each chunk had left when it reached this listener, so
// late chunks can be traced to the network, decoding, the clock or Core. No per-chunk logging.
type Listener = { player: Sendspin.SendspinPlayer | null; declaredMs?: number };

const windowMs = 10_000;
// The player handles received chunks in batches 15 ms apart (live-buffer.ts playerBatchMs).
const playerBatchMs = 15;

const fresh = (startedAt = performance.now()) => ({
  startedAt,
  received: [] as number[],
  decoded: [] as number[],
  decoding: [] as number[],
  transit: [] as number[],
  gaps: [] as number[],
  lastAt: undefined as number | undefined,
  underNeed: 0,
  underOutput: 0,
  dropped: 0,
  halfRtt: [] as number[],
  residual: [] as number[],
  longTasks: [] as number[],
});
let stats = fresh();
let syncDelayMs = 0;
let listener: () => Listener | undefined = () => undefined;
let installed = false;
// When each chunk still decoding was received, by its stamp: decoding's own share of the margin.
const receivedAt = new Map<number, number>();

const at = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.floor(fraction * (sorted.length - 1))]!.toFixed(1) : "-";
const spread = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return `min ${at(sorted, 0)} p1 ${at(sorted, 0.01)} p5 ${at(sorted, 0.05)} p50 ${at(sorted, 0.5)}`;
};
const tail = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return `p50 ${at(sorted, 0.5)} p99 ${at(sorted, 0.99)} max ${at(sorted, 1)}`;
};

const flush = (now: number) => {
  if (now - stats.startedAt < windowMs) return;
  const current = listener(),
    outputMs = current?.player?.syncInfo.outputLatencyMs ?? NaN,
    sync = current?.player?.timeSyncInfo;
  console.log(
    `Couch live margin: ${((now - stats.startedAt) / 1000).toFixed(1)} s, ${stats.received.length} chunks` +
      ` | declares ${current?.declaredMs ?? "-"} ms, output ${outputMs.toFixed(1)} + sync delay ${syncDelayMs} + batch ${playerBatchMs}` +
      ` | received ms ${spread(stats.received)} | decoded ms ${spread(stats.decoded)}` +
      ` | decoded under need ${stats.underNeed}, under output ${stats.underOutput}, dropped late ${stats.dropped}` +
      ` | decoding ms ${tail(stats.decoding)} | transit ms ${tail(stats.transit)} | arrival gaps ms ${tail(stats.gaps)}` +
      ` | main-thread long tasks ${stats.longTasks.length}, ms ${tail(stats.longTasks)}` +
      ` | clock error ${sync?.error ?? "-"} ms, rtt/2 ms ${tail(stats.halfRtt)}, residual ms ${tail(stats.residual.map(Math.abs))}`,
  );
  stats = fresh(now);
  receivedAt.clear();
};

export function noteLiveDropped(count: number) {
  stats.dropped += count;
}

export function logLiveMargins(sendspin: typeof Sendspin, current: () => Listener | undefined) {
  listener = current;
  // A test's stand-in library has only the player.
  if (installed || !sendspin.SendspinCore) return;
  installed = true;
  // As it leaves the socket and its decryption: the margin the network left.
  const receive = sendspin.SendspinCore.prototype.handleBinaryMessage;
  sendspin.SendspinCore.prototype.handleBinaryMessage = function (data) {
    const raw: ArrayBuffer | Uint8Array = data,
      view = ArrayBuffer.isView(raw)
        ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
        : new DataView(raw);
    if (listener() && view.byteLength >= 13 && view.getUint8(0) === 4 && this.timeSyncInfo.synced) {
      const now = performance.now(),
        marginMs = (Number(view.getBigInt64(1)) - this.getCurrentServerTimeUs()) / 1000;
      syncDelayMs = this.getSyncDelayMs();
      stats.received.push(marginMs);
      // Core stamps send_ahead (play time minus send time, µs, floored at 0) as it writes the chunk.
      stats.transit.push(view.getUint32(9) / 1000 - marginMs);
      if (stats.lastAt !== undefined) stats.gaps.push(now - stats.lastAt);
      stats.lastAt = now;
      flush(now);
      receivedAt.set(Number(view.getBigInt64(1)), now);
    }
    receive.call(this, data);
  };
  // Decoded, as the player queues it for its next batch: what it has left to schedule in.
  const decoded = sendspin.AudioScheduler.prototype.handleDecodedChunk;
  sendspin.AudioScheduler.prototype.handleDecodedChunk = function (chunk) {
    const player = listener()?.player;
    if (player?.timeSyncInfo.synced) {
      const marginMs = (chunk.serverTimeUs - player.getCurrentServerTimeUs()) / 1000,
        playerMs = player.syncInfo.outputLatencyMs + syncDelayMs;
      stats.decoded.push(marginMs);
      const received = receivedAt.get(chunk.serverTimeUs);
      receivedAt.delete(chunk.serverTimeUs);
      if (received !== undefined) stats.decoding.push(performance.now() - received);
      if (marginMs < playerMs) stats.underOutput++;
      if (marginMs < playerMs + playerBatchMs) stats.underNeed++;
    }
    decoded.call(this, chunk);
  };
  // Each time-sync burst's best probe: half its round trip, and how far it was from the filter's prediction.
  const update = sendspin.SendspinTimeFilter.prototype.update;
  sendspin.SendspinTimeFilter.prototype.update = function (measurement, maxError, addedAt) {
    if (listener() && this.is_synchronized) {
      stats.halfRtt.push(maxError / 1000);
      stats.residual.push((measurement - (this.computeServerTime(addedAt) - addedAt)) / 1000);
    }
    update.call(this, measurement, maxError, addedAt);
  };
  // Tasks over 50 ms delay both the socket's messages and the player's 15 ms batch.
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask"))
    new PerformanceObserver((list) => {
      if (listener()) for (const entry of list.getEntries()) stats.longTasks.push(entry.duration);
    }).observe({ type: "longtask" });
}
