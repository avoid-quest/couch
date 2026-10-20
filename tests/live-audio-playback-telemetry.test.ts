import { expect, test } from "bun:test";
import { assessPlaybackCoverage, observePlayback } from "./audio-lab/playback-telemetry";

function observation(totalDuration: number, underrunEvents = 0, underrunDuration = 0) {
  return observePlayback({ currentTime: totalDuration, state: "running", playbackStats: {
    totalDuration, underrunEvents, underrunDuration, averageLatency: .01, minimumLatency: .008, maximumLatency: .012,
  } } as unknown as AudioContext);
}

test("an exposed but frozen counter cannot certify absence of underruns", () => {
  const result = assessPlaybackCoverage(observation(10), observation(10), 8000);
  expect(result.status).toBe("inconclusive");
  expect(result.underrunEvents).toBeNull();
  const staleStart = { ...observation(10), contextTimeSeconds: 12 };
  expect(assessPlaybackCoverage(staleStart, observation(18), 8000).status).toBe("inconclusive");
  expect(assessPlaybackCoverage(staleStart, observation(20), 8000).status).toBe("measured");
});

test("a bounded drain preserves the start and requires complete duration coverage", () => {
  const start = observation(10, 2, .02);
  expect(assessPlaybackCoverage(start, observation(17.9, 2, .02), 8000).status).toBe("inconclusive");
  const final = assessPlaybackCoverage(start, observation(18.1, 3, .03), 8000);
  expect(final.status).toBe("measured");
  expect(final.underrunEvents).toBe(1);
  expect(final.underrunDurationMs).toBeCloseTo(10);
});

test("unsupported APIs and resetting or invalid counters retain unknown loss", () => {
  const unavailable = observePlayback(null);
  expect(assessPlaybackCoverage(unavailable, observation(20), 8000).underrunEvents).toBeNull();
  expect(assessPlaybackCoverage(observation(10, 2), observation(20, 1), 8000).status).toBe("inconclusive");
  expect(observation(NaN).status).toBe("invalid");
  expect(observation(1, 1, 2).status).toBe("invalid");
  expect(observation(1, .5).status).toBe("invalid");
});

test("complete observed rendering may report zero underruns without claiming PCM integrity", () => {
  const result = assessPlaybackCoverage(observation(2), observation(10), 8000);
  expect(result.status).toBe("measured");
  expect(result.underrunEvents).toBe(0);
  expect(result.underrunDurationMs).toBe(0);
  expect(() => assessPlaybackCoverage(observation(2), observation(10), 0)).toThrow();
});
