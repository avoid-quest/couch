/** Chromium's counters describe renderer glitches, not all scheduler/output loss.
 * Durations are seconds: Chromium 152 audio_playback_stats.cc uses InSecondsF().
 * https://github.com/chromium/chromium/blob/152.0.7968.0/third_party/blink/renderer/modules/webaudio/audio_playback_stats.cc */
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

function validCounters(counters: PlaybackCounters) {
  return [counters.underrunEvents, counters.underrunDuration, counters.totalDuration,
    counters.averageLatency, counters.minimumLatency, counters.maximumLatency]
    .every(value => Number.isFinite(value) && value >= 0)
    && Number.isSafeInteger(counters.underrunEvents) && counters.underrunDuration <= counters.totalDuration;
}

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
    if (!validCounters(counters))
      return { ...observation, status: "invalid", reason: "Invalid renderer counters", counters: null };
    return { ...observation, status: "available", reason: null, counters };
  } catch (error) {
    return { ...observation, status: "unavailable", reason: String(error), counters: null };
  }
}

/** Require coverage rather than treating an exposed but frozen API as zero loss.
 * Keep before and both original context boundaries fixed during any final drain.
 * requiredDurationMs is the context interval (null for invalid boundaries);
 * observedDurationMs is the rendered counter delta, null for invalid/unavailable
 * or reset observations. Measured underruns cover the superset, including
 * stale-start/drain time, not PCM delivery or scheduler headroom. */
export function assessPlaybackCoverage(before: PlaybackObservation, after: PlaybackObservation,
  { startContextTimeSeconds: start, endContextTimeSeconds: end }: { startContextTimeSeconds: number; endContextTimeSeconds: number }) {
  const requiredDurationMs = (end - start) * 1000;
  const a = before.counters, b = after.counters;
  const result = { status: "inconclusive" as "measured" | "inconclusive", reasons: [] as string[],
    requiredDurationMs: null as number | null, observedDurationMs: null as number | null,
    underrunEvents: null as number | null, underrunDurationMs: null as number | null };
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end)
    || !Number.isFinite(requiredDurationMs) || requiredDurationMs <= 0) {
    result.reasons.push("Invalid measurement context boundaries"); return result;
  }
  result.requiredDurationMs = requiredDurationMs;
  if (before.status !== "available" || after.status !== "available" || !a || !b) {
    result.reasons.push("Renderer counters unavailable at an interval boundary"); return result;
  }
  if (!validCounters(a) || !validCounters(b)) {
    result.reasons.push("Invalid renderer counters"); return result;
  }
  const beforeTime = before.contextTimeSeconds, afterTime = after.contextTimeSeconds;
  if (beforeTime === null || afterTime === null || !Number.isFinite(beforeTime) || !Number.isFinite(afterTime)
    || beforeTime < 0 || afterTime < 0) {
    result.reasons.push("Invalid observation context time"); return result;
  }
  const renderedBefore = a.totalDuration - a.underrunDuration;
  const renderedAfter = b.totalDuration - b.underrunDuration;
  const duration = (renderedAfter - renderedBefore) * 1000;
  const underrunDurationMs = (b.underrunDuration - a.underrunDuration) * 1000;
  if (!Number.isFinite(duration) || !Number.isFinite(underrunDurationMs)) {
    result.reasons.push("Invalid renderer duration delta"); return result;
  }
  if (duration < 0 || b.underrunEvents < a.underrunEvents || b.underrunDuration < a.underrunDuration || afterTime < beforeTime) {
    result.reasons.push("Renderer counters or context time reset during the measurement"); return result;
  }
  result.observedDurationMs = duration;
  // Only rendered time shares currentTime's timeline: totalDuration includes
  // underruns. Transfers may lag; a sufficient delta can still miss the tail.
  if (renderedBefore > start || renderedAfter < end) {
    result.reasons.push("Renderer counters do not cover the complete measurement interval"); return result;
  }
  result.status = "measured";
  result.underrunEvents = b.underrunEvents - a.underrunEvents;
  result.underrunDurationMs = underrunDurationMs;
  return result;
}
