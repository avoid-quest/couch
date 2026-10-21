import { expect, test } from "bun:test";
import { assessInboundCounters, totalObservedCounter, type InboundPeer } from "./audio-lab/rtc-counters";

function peer(timestamp: number, extra: Record<string, unknown> = {}): InboundPeer {
  return { index: 1, stats: [{ type: "inbound-rtp", kind: "audio", id: "audio-1", ssrc: 12, timestamp,
    packetsLost: 0, packetsReceived: timestamp, totalSamplesReceived: timestamp * 480,
    concealedSamples: 0, silentConcealedSamples: 0, concealmentEvents: 0, jitterBufferDelay: timestamp / 10,
    jitterBufferEmittedCount: timestamp, insertedSamplesForDeceleration: 0, removedSamplesForAcceleration: 0, ...extra }] };
}

test("unknown, malformed or reset RTC counters cannot become observed zero", () => {
  const before = peer(10);
  expect(assessInboundCounters(before, peer(20)).delta.totalSamplesReceived).toBe(4800);
  for (const value of [null, undefined, NaN, Infinity, "0", -1]) {
    const result = assessInboundCounters(before, peer(20, { concealedSamples: value }));
    expect(result.status).toBe("inconclusive");
    expect(result.delta.concealedSamples).toBeNull();
  }
  expect(assessInboundCounters(peer(10, { concealedSamples: 10 }), peer(20, { concealedSamples: 2 })).delta.concealedSamples).toBeNull();
  expect(totalObservedCounter([0, null])).toBeNull();
  expect(totalObservedCounter([])).toBeNull();
  expect(totalObservedCounter([2, 0, 4])).toBe(6);
});

test("deltas require the same unambiguous inbound stream and advancing stats timestamp", () => {
  const before = peer(10);
  for (const after of [undefined, { ...peer(20), index: 2 }, peer(20, { id: "replacement" }), peer(20, { ssrc: 13 }),
    peer(20, { id: undefined }), peer(10), peer(9), peer(NaN), { ...peer(20), stats: [...peer(20).stats, ...peer(20).stats] }]) {
    const result = assessInboundCounters(before, after);
    expect(result.status).toBe("inconclusive");
    expect(Object.values(result.delta).every(value => value === null)).toBe(true);
  }
  // W3C/RFC 3550 allow negative packetsLost, including a negative delta.
  const late = assessInboundCounters(peer(10, { packetsLost: 2 }), peer(20, { packetsLost: -3 }));
  expect(late.status).toBe("observed"); expect(late.delta.packetsLost).toBe(-5);
});
