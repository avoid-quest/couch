// Where a Live listener's output stands: the context's clock against performance.now() at the same
// heard instant, which places each chunk, and how far the render clock runs ahead of what's heard,
// which it declares. Both come from one reading so they can't disagree.
export type Reading = { offset: number; lead: number; measured: boolean };

// The part of AudioContext these readings use. playbackStats is Chrome's (146 and later).
export type OutputContext = Pick<
  AudioContext,
  "currentTime" | "baseLatency" | "outputLatency" | "getOutputTimestamp"
> & { playbackStats?: { underrunDuration: number } };

// Chromium's getOutputTimestamp() gives the frame being heard and when. On Android, Chrome runs a
// worklet through a FIFO whose underruns it plays as silence yet still counts as the context's
// frames, so what's heard trails the stamp by their total (docs/live-audio.md).
export function heard(
  context: OutputContext,
  now: number,
  countsUnderruns: boolean,
): Reading | undefined {
  // Hidden while relaxed sound plays on Android (sendspin.ts); zero until the output runs.
  const stamp = context.getOutputTimestamp?.();
  if (!stamp?.contextTime || !stamp.performanceTime) return undefined;
  const underrun = countsUnderruns ? (context.playbackStats?.underrunDuration ?? 0) : 0;
  const offset = stamp.contextTime - underrun - stamp.performanceTime / 1000;
  return { offset, lead: context.currentTime - (offset + now / 1000), measured: true };
}

// iOS, Firefox and Safari stamp the frame being rendered, so the reported latency stands in. Just
// after resume() a context may report only its base latency; Safari before 18.4 never reports one.
export function reported(context: OutputContext, now: number): Reading {
  const output = context.outputLatency || 0,
    lead = context.baseLatency + output;
  return { offset: context.currentTime - lead - now / 1000, lead, measured: output > 0 };
}
