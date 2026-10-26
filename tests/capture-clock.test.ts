import { describe, expect, test } from "bun:test";
import { createCaptureClock, decodeCapturePacket, validateCapturePacket, type CaptureAudioPacket } from "../src/server/capture-audio";
const packet = (position = 0, overrides: Partial<CaptureAudioPacket> = {}): CaptureAudioPacket => ({ generation: "capture-1", sequence: position / 480, samplePosition: position, capturedAtUs: 1_000_000 + Math.round(position / 48_000 * 1e6), sampleRate: 48_000, channels: 2, pcm: Float32Array.from({ length: 960 }, (_, i) => i % 2 ? -.25 : .25), ...overrides });

describe("timestamped capture clock", () => {
  test("stereo and deadlines survive packet boundaries; no callback-arrival anchoring", () => {
    const clock = createCaptureClock({ intent: "live" });
    const first = clock.push(packet(), 1_030_000), second = clock.push(packet(480), 1_080_000);
    expect(first.atUs).toBe(1_100_000);
    expect(second.atUs).toBe(1_100_000 + Math.round(first.pcm.length / 2 / 48_000 * 1e6));
    for (let i = 0; i < second.pcm.length; i += 2) { expect(second.pcm[i]).toBe(.25); expect(second.pcm[i + 1]).toBe(-.25); }
  });
  test("44.1 kHz normalization follows a slow oscillator without unbounded drift", () => {
    const clock = createCaptureClock({ intent: "relaxed" });
    let frames = 0, lastAt = 0;
    const actualRate = 44_100 * (1 - 400 / 1e6);
    for (let i = 0; i < 6000; i++) {
      const source = packet(i * 441, { sequence: i, sampleRate: 44_100, capturedAtUs: 1_000_000 + Math.round(i * 441 / actualRate * 1e6), pcm: new Float32Array(882) });
      const output = clock.push(source, source.capturedAtUs + 10_000);
      frames += output.pcm.length / 2; lastAt = output.atUs;
    }
    expect(Math.abs(clock.stats.ppm + 400)).toBeLessThan(2);
    expect(Math.abs(frames - 60 * 48_000 / .9996)).toBeLessThan(60);
    expect(lastAt).toBeGreaterThan(61_900_000);
  });
  test("live never disguises mono as stereo; relaxed deliberately upmixes", () => {
    const mono = packet(0, { channels: 1, pcm: new Float32Array(480).fill(.3) });
    expect(() => createCaptureClock({ intent: "live" }).push(mono, 1e6)).toThrow("real stereo");
    const output = createCaptureClock({ intent: "relaxed" }).push(mono, 1e6);
    expect(output.pcm[0]).toBe(output.pcm[1]);
  });
  test("bounded gaps are silence; stale, large gaps and silent format resets fail", () => {
    const clock = createCaptureClock({ intent: "live" }); clock.push(packet(), 1e6);
    const gap = clock.push(packet(960), 1_020_000);
    expect(clock.stats.gaps).toBe(480); expect(gap.pcm[20]).toBe(0);
    expect(() => clock.push(packet(960), 1e6)).toThrow("backward");
    expect(() => clock.push(packet(4800), 1e6)).toThrow("40 ms");
    expect(() => clock.push(packet(1440, { sampleRate: 44_100 }), 1e6)).toThrow("format");
    expect(() => clock.push(packet(0, { generation: "capture-2", sequence: 1 }), 1e6)).toThrow("sample zero");
    expect(clock.push(packet(0, { generation: "capture-2", capturedAtUs: 2e6 }), 2e6).reset).toBe(true);
  });
  test("late arrivals retain the source deadline", () => {
    const clock = createCaptureClock({ intent: "live" });
    expect(clock.push(packet(), 2e6).atUs).toBe(1_100_000); expect(clock.stats.late).toBe(1);
  });
  test("malformed and oversized samples fail before encoding", () => {
    expect(() => validateCapturePacket(packet(0, { pcm: new Float32Array(8194) }))).toThrow();
    expect(() => validateCapturePacket(packet(0, { pcm: new Float32Array([NaN, 0]) }))).toThrow();
    expect(() => decodeCapturePacket(Buffer.alloc(80), "generation", 0)).toThrow();
  });
});

 test("capture timestamps preceding the upload worker origin map to the server clock", () => {
  const data = Buffer.alloc(40 + 960 * 4);
  data.writeUInt32LE(0x31414343, 0); data.writeUInt8(2, 4); data.writeUInt8(1, 5);
  data.writeUInt16LE(40, 6); data.writeUInt32LE(48000, 8); data.writeBigInt64LE(-150_000n, 24); data.writeUInt32LE(480, 32);
  const decoded = decodeCapturePacket(data, "source-realm", 1_000_000);
  expect(decoded.capturedAtUs).toBe(850_000);
  expect(createCaptureClock({ intent: "live" }).push(decoded, 900_000).atUs).toBe(950_000);
});

test("each live source snapshots its scheduling lead; relaxed deadlines stay unchanged", () => {
  const policy = { intent: "live" as const, liveAudioLeadMs: 150 };
  const clock = createCaptureClock(policy);
  const first = clock.push(packet(), 1_030_000);
  expect(first.atUs).toBe(1_150_000);
  policy.liveAudioLeadMs = 250;
  expect(clock.push(packet(480), 1_040_000).atUs).toBe(first.atUs + Math.round(first.pcm.length / 2 / 48000 * 1e6));
  expect(createCaptureClock(policy).push(packet(), 1_030_000).atUs).toBe(1_250_000);
  expect(createCaptureClock({ intent: "relaxed", liveAudioLeadMs: 150 }).push(packet(), 1_030_000).atUs).toBe(2_000_000);
  expect(() => createCaptureClock({ intent: "live", liveAudioLeadMs: -1 })).toThrow();
});
