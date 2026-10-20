import { expect, test } from "bun:test";
import { assessPlaybackCoverage, observePlayback } from "./audio-lab/playback-telemetry";

function observation(totalDuration: number, underrunEvents = 0, underrunDuration = 0) {
  return observePlayback({ currentTime: totalDuration, state: "running", playbackStats: {
    totalDuration, underrunEvents, underrunDuration, averageLatency: .01, minimumLatency: .008, maximumLatency: .012,
  } } as unknown as AudioContext);
}

test("an exposed but frozen counter cannot certify absence of underruns", () => {
  const result = assessPlaybackCoverage(observation(10), observation(10), { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(result.status).toBe("inconclusive");
  expect(result.underrunEvents).toBeNull();
  const staleStart = { ...observation(10), contextTimeSeconds: 12 };
  expect(assessPlaybackCoverage(staleStart, observation(18), { startContextTimeSeconds: 12, endContextTimeSeconds: 20 }).status).toBe("inconclusive");
  expect(assessPlaybackCoverage(staleStart, observation(20), { startContextTimeSeconds: 12, endContextTimeSeconds: 20 }).status).toBe("measured");
});

test.each([
  { name: "complete rendering", beforeTotal: 12, afterTotal: 20, status: "measured" },
  { name: "equally stale transfers", beforeTotal: 10, afterTotal: 18, status: "inconclusive" },
])("prior underruns do not distort coverage for $name", ({ beforeTotal, afterTotal, status }) => {
  // Two seconds of old underruns must not advance either rendered boundary.
  const before = { ...observation(beforeTotal, 2, 2), contextTimeSeconds: 10 };
  const after = { ...observation(afterTotal, 2, 2), contextTimeSeconds: 18 };
  const result = assessPlaybackCoverage(before, after, { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(result.status).toBe(status);
  expect(result.observedDurationMs).toBe(8000);
  expect(result.underrunEvents).toBe(status === "measured" ? 0 : null);
});

test("a bounded drain preserves the start and requires complete duration coverage", () => {
  const start = observation(10, 2, .02);
  expect(assessPlaybackCoverage(start, observation(17.9, 2, .02), { startContextTimeSeconds: 10, endContextTimeSeconds: 18 }).status).toBe("inconclusive");
  const final = assessPlaybackCoverage(start, observation(18.1, 3, .03), { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(final.status).toBe("measured");
  expect(final.underrunEvents).toBe(1);
  expect(final.underrunDurationMs).toBeCloseTo(10);
});

test("a drain targets the original context boundaries and counts the covering superset", () => {
  const interval = { startContextTimeSeconds: 10, endContextTimeSeconds: 18 };
  const before = { ...observation(11.5, 2, 2), contextTimeSeconds: 10 };
  const stale = { ...observation(20.25, 3, 2.5), contextTimeSeconds: 19 };
  expect(assessPlaybackCoverage(before, stale, interval).status).toBe("inconclusive");
  const drained = { ...observation(20.5, 3, 2.5), contextTimeSeconds: 19.5 };
  expect(assessPlaybackCoverage(before, drained, interval)).toEqual({
    status: "measured", reasons: [], requiredDurationMs: 8000, observedDurationMs: 8500,
    underrunEvents: 1, underrunDurationMs: 500,
  });
  expect(before.counters?.totalDuration).toBe(11.5);
  expect(interval.endContextTimeSeconds).toBe(18);
});

test.each([
  { name: "start", before: { ...observation(10.000000001), contextTimeSeconds: 12 }, after: observation(20) },
  { name: "end", before: observation(8), after: { ...observation(17.999999999), contextTimeSeconds: 19 } },
])("coverage cannot omit even a small part of the original $name boundary", ({ before, after }) => {
  const result = assessPlaybackCoverage(before, after, { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(result.status).toBe("inconclusive");
  expect(result.observedDurationMs).toBeGreaterThan(8000);
  expect(result.underrunEvents).toBeNull();
  expect(result.underrunDurationMs).toBeNull();
});

test("unsupported APIs and resetting or invalid counters retain unknown loss", () => {
  const unavailable = observePlayback(null);
  expect(assessPlaybackCoverage(unavailable, observation(20), { startContextTimeSeconds: 12, endContextTimeSeconds: 20 }).underrunEvents).toBeNull();
  expect(assessPlaybackCoverage(observation(10, 2), observation(20, 1), { startContextTimeSeconds: 10, endContextTimeSeconds: 18 }).status).toBe("inconclusive");
  expect(observation(NaN).status).toBe("invalid");
  expect(observation(1, 1, 2).status).toBe("invalid");
  expect(observation(1, .5).status).toBe("invalid");
});

test("complete observed rendering may report zero underruns without claiming PCM integrity", () => {
  const result = assessPlaybackCoverage(observation(2), observation(10), { startContextTimeSeconds: 2, endContextTimeSeconds: 10 });
  expect(result.status).toBe("measured");
  expect(result.underrunEvents).toBe(0);
  expect(result.underrunDurationMs).toBe(0);
  expect(result.requiredDurationMs).toBe(8000);
  expect(result.observedDurationMs).toBe(8000);
});

test.each([
  [NaN, 18], [10, NaN], [10, Infinity], [-1, 18], [10, 10], [10, 9], [0, Number.MAX_VALUE],
])("invalid context boundaries %s to %s retain unknown coverage", (start, end) => {
  const result = assessPlaybackCoverage(observation(0), observation(20), {
    startContextTimeSeconds: start, endContextTimeSeconds: end,
  });
  expect(result.status).toBe("inconclusive");
  expect(result.requiredDurationMs).toBeNull();
  expect(result.observedDurationMs).toBeNull();
  expect(result.underrunEvents).toBeNull();
  expect(result.underrunDurationMs).toBeNull();
});

test.each([
  { totalDuration: NaN }, { underrunDuration: Infinity }, { underrunDuration: 21 },
  { underrunEvents: .5 }, { averageLatency: -1 }, { minimumLatency: NaN }, { maximumLatency: undefined },
])("malformed available counters retain unknown loss: %j", counters => {
  const before = observation(10);
  const after = observation(20);
  Object.assign(after.counters!, counters);
  const result = assessPlaybackCoverage(before, after, { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(result.status).toBe("inconclusive");
  expect(result.observedDurationMs).toBeNull();
  expect(result.underrunEvents).toBeNull();
  expect(result.underrunDurationMs).toBeNull();
});

test.each([observation(Number.MAX_VALUE), observation(1e306, 1, 1e306 - 1e303)])("nonfinite converted durations retain unknown loss", after => {
  const result = assessPlaybackCoverage(observation(0), after, {
    startContextTimeSeconds: 0, endContextTimeSeconds: 1,
  });
  expect(result.status).toBe("inconclusive");
  expect(result.observedDurationMs).toBeNull();
  expect(result.underrunEvents).toBeNull();
  expect(result.underrunDurationMs).toBeNull();
});

test.each([null, NaN, Infinity, -1])("invalid observation context time retains unknown loss: %s", contextTimeSeconds => {
  for (const boundary of ["before", "after"] as const) {
    const snapshots = { before: observation(10), after: observation(20) };
    snapshots[boundary].contextTimeSeconds = contextTimeSeconds;
    const result = assessPlaybackCoverage(snapshots.before, snapshots.after, { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
    expect(result.status).toBe("inconclusive");
    expect(result.observedDurationMs).toBeNull();
    expect(result.underrunEvents).toBeNull();
    expect(result.underrunDurationMs).toBeNull();
  }
});

test.each([
  { name: "total duration", after: observation(9, 2, 1) },
  { name: "rendered duration despite increasing totals", after: observation(11, 3, 3) },
  { name: "underrun duration", after: observation(20, 2, .5) },
  { name: "underrun events", after: observation(20, 1, 1) },
  { name: "context time", after: { ...observation(20, 2, 1), contextTimeSeconds: 8 } },
])("a reset in $name retains unknown loss", ({ after }) => {
  const result = assessPlaybackCoverage(observation(10, 2, 1), after, { startContextTimeSeconds: 10, endContextTimeSeconds: 18 });
  expect(result.status).toBe("inconclusive");
  expect(result.observedDurationMs).toBeNull();
  expect(result.underrunEvents).toBeNull();
  expect(result.underrunDurationMs).toBeNull();
});


test("new underruns remain measurable at exact rendered-context boundaries", () => {
  // The pinned render callback advances both currentFrame and observed_frames
  // by rendered frames, while glitch duration accumulates separately.
  const before = { ...observation(10, 2, 2), contextTimeSeconds: 8 };
  const after = { ...observation(18.5, 3, 2.5), contextTimeSeconds: 16 };
  expect(assessPlaybackCoverage(before, after, { startContextTimeSeconds: 8, endContextTimeSeconds: 16 })).toEqual({
    status: "measured", reasons: [], requiredDurationMs: 8000, observedDurationMs: 8000,
    underrunEvents: 1, underrunDurationMs: 500,
  });
});
