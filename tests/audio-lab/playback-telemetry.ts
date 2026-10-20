/** Chromium's counters describe renderer glitches, not all scheduler/output loss.
 * Durations are seconds: Chromium 152 audio_playback_stats.cc uses InSecondsF(). */
type PlaybackCounters = {
  underrunEvents: number; underrunDuration: number; totalDuration: number;
  averageLatency: number; minimumLatency: number; maximumLatency: number;
};
export type PlaybackObservation = {
  status: "available" | "unavailable" | "invalid";
  reason: string | null;
  contextTimeSeconds: number | null;
  state: string | null;
  counters: PlaybackCounters | null;
};

export function observePlayback(context: AudioContext | null): PlaybackObservation {
  const observation = { contextTimeSeconds: context?.currentTime ?? null, state: context?.state ?? null };
  try {
    const stats = (context as (AudioContext & { playbackStats?: PlaybackCounters }) | null)?.playbackStats;
    if (!stats) return { ...observation, status: "unavailable", reason: "AudioContext.playbackStats is unavailable", counters: null };
    const counters: PlaybackCounters = {
      underrunEvents: stats.underrunEvents, underrunDuration: stats.underrunDuration,
      totalDuration: stats.totalDuration, averageLatency: stats.averageLatency,
      minimumLatency: stats.minimumLatency, maximumLatency: stats.maximumLatency,
    };
    if (Object.values(counters).some(value => !Number.isFinite(value) || value < 0)
      || !Number.isSafeInteger(counters.underrunEvents) || counters.underrunDuration > counters.totalDuration)
      return { ...observation, status: "invalid", reason: "Invalid renderer counters", counters: null };
    return { ...observation, status: "available", reason: null, counters };
  } catch (error) {
    return { ...observation, status: "unavailable", reason: String(error), counters: null };
  }
}

/** Require coverage rather than treating an exposed but frozen API as zero loss.
 * Caller must retain the original interval start during any bounded final drain. */
export function assessPlaybackCoverage(before: PlaybackObservation, after: PlaybackObservation, requiredDurationMs: number) {
  if (!Number.isFinite(requiredDurationMs) || requiredDurationMs <= 0) throw new Error("Positive measurement duration required");
  const a = before.counters, b = after.counters;
  const result = { status: "inconclusive" as "measured" | "inconclusive", reasons: [] as string[],
    requiredDurationMs, observedDurationMs: null as number | null, underrunEvents: null as number | null, underrunDurationMs: null as number | null };
  if (before.status !== "available" || after.status !== "available" || !a || !b) {
    result.reasons.push("Renderer counters unavailable at an interval boundary"); return result;
  }
  const duration = (b.totalDuration - a.totalDuration) * 1000;
  if (duration < 0 || b.underrunEvents < a.underrunEvents || b.underrunDuration < a.underrunDuration) {
    result.reasons.push("Renderer counters reset during the measurement"); return result;
  }
  result.observedDurationMs = duration;
  // totalDuration and currentTime both start with the context, but the counter
  // transfer may lag by a task or more. Merely increasing by the right amount
  // would also accept two equally stale snapshots that miss the interval tail.
  const start = before.contextTimeSeconds;
  if (start === null || !Number.isFinite(start) || start < 0 || a.totalDuration > start
    || duration < requiredDurationMs || b.totalDuration * 1000 < start * 1000 + requiredDurationMs) {
    result.reasons.push("Renderer counters do not cover the complete measurement interval"); return result;
  }
  result.status = "measured";
  result.underrunEvents = b.underrunEvents - a.underrunEvents;
  result.underrunDurationMs = (b.underrunDuration - a.underrunDuration) * 1000;
  return result;
}
