import { expect, test } from "bun:test";
import { assertLiveFrame, clockFrame, clockLag, decodeClock, guideClock, type ClockCapture } from "./iptv-clock";
import { createGuideFixture } from "./iptv-fixture";

test("video clock decodes timestamps and rejects damaged, absent and stale markers", () => {
  const pixels = clockFrame("blue", 12_345);
  expect(decodeClock(pixels, 640, 360)).toBe(308);
  expect(() => decodeClock(new Uint8Array(pixels.length), 640, 360)).toThrow("complements");
  const damaged = pixels.slice();
  for (let y = 0; y < guideClock.cell; y++) damaged.fill(0, ((guideClock.y + y) * 640 + guideClock.x) * 3, ((guideClock.y + y) * 640 + guideClock.x + guideClock.cell) * 3);
  expect(() => decodeClock(damaged, 640, 360)).toThrow("complements");
  const sample = { tick: 308, epoch: 100_000, captureStart: 117_000, captureEnd: 117_400 };
  expect(assertLiveFrame(sample).maximumLagMs).toBe(5_080);
  expect(() => assertLiveFrame({ ...sample, captureStart: 137_000, captureEnd: 137_400 })).toThrow("Presented IPTV frame exceeds");
  expect(() => assertLiveFrame({ ...sample, captureEnd: sample.captureStart + 1_001 })).toThrow("uncertainty");
  expect(() => assertLiveFrame({ ...sample, tick: 10_000 })).toThrow("future");
});

const ffmpeg = process.env.COUCH_IPTV_FFMPEG ?? Bun.which("ffmpeg");
test.skipIf(!ffmpeg)("real H264 live fixture presents advancing pixel timestamps; a delayed reload fails the same freshness assertion", async () => {
  const fixture = await createGuideFixture(0, ffmpeg!);
  const captured: unknown[] = [];
  try {
    await fixture.startStreams();
    const sample = async (): Promise<ClockCapture> => {
      const manifest = await (await fetch(`${fixture.origin}/blue/live.m3u8`)).text();
      const path = manifest.split("\n").filter(line => line && !line.startsWith("#")).at(-1)!;
      const start = Date.now();
      const bytes = await (await fetch(fixture.origin + path)).bytes();
      const decode = Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1", "-vf", "scale=1600:900,pad=1600:1000:0:50", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdin: bytes, stdout: "pipe", stderr: "inherit" });
      const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
      expect(await decode.exited).toBe(0);
      const result = { tick: decodeClock(pixels, 1600, 1000, { left: 0, top: 50, width: 1600, height: 900 }), epoch: fixture.epoch, captureStart: start, captureEnd: Date.now() };
      captured.push({ manifest, path, ...result, lag: clockLag(result) });
      return result;
    };
    const first = await sample(); expect(assertLiveFrame(first).maximumLagMs).toBeLessThanOrEqual(guideClock.maxLagMs);
    await Bun.sleep(2_500);
    const second = await sample(); expect(second.tick).toBeGreaterThan(first.tick); assertLiveFrame(second);
    // Retain a complete six-segment window twenty seconds behind current output.
    while (fixture.currentSequence() < 18) await Bun.sleep(250);
    fixture.delayLive(20);
    const delayed = await sample();
    expect(() => assertLiveFrame(delayed)).toThrow("Presented IPTV frame exceeds");
    expect(clockLag(delayed).minimumLagMs).toBeGreaterThan(20_000);
    await Bun.sleep(2_500);
    const delayedNext = await sample(); expect(delayedNext.tick).toBeGreaterThan(delayed.tick);
    expect(() => assertLiveFrame(delayedNext)).toThrow("Presented IPTV frame exceeds");
    fixture.delayLive(0);
    expect(assertLiveFrame(await sample()).maximumLagMs).toBeLessThanOrEqual(guideClock.maxLagMs);
    expect(fixture.requests().filter(request => request.sequence !== undefined).every(request => /^[a-f0-9]{64}$/.test(request.sha256 ?? ""))).toBeTrue();
  } finally {
    if (process.env.COUCH_IPTV_CLOCK_EVIDENCE) await Bun.write(process.env.COUCH_IPTV_CLOCK_EVIDENCE, JSON.stringify({ qualification: "Local H264 decode and scaling only; no native presentation or HTTP UI acceptance", epoch: fixture.epoch, encoding: fixture.encoding, captured, hashes: fixture.hashes }, null, 2));
    await fixture.close();
  }
}, 50_000);
