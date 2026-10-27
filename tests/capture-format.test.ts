import { expect, test } from "bun:test";
import { prepareCaptureAudio } from "../src/client/session/capture-audio";
import { liveCaptureConstraints } from "../src/shared/audio-settings";

async function fixture(rate: number, run: (observed: { closed: number; canceled: number }) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaStreamTrackProcessor");
  const observed = { closed: 0, canceled: 0 };
  Object.defineProperty(globalThis, "MediaStreamTrackProcessor", { configurable: true, value: class {
    readable = new ReadableStream({ start(controller) { controller.enqueue({ timestamp: performance.now() * 1000, sampleRate: rate, numberOfChannels: 2, numberOfFrames: 128, close() { observed.closed++; } }); }, cancel() { observed.canceled++; } });
  } });
  try { await run(observed); }
  finally { if (original) Object.defineProperty(globalThis, "MediaStreamTrackProcessor", original); else Reflect.deleteProperty(globalThis, "MediaStreamTrackProcessor"); }
}
test("explicit capture rate uses an exact track request; automatic retains the 48 kHz preference", () => {
  expect(liveCaptureConstraints().sampleRate).toEqual({ ideal: 48000 });
  expect(liveCaptureConstraints(44100).sampleRate).toEqual({ exact: 44100 });
  expect(liveCaptureConstraints(48000).sampleRate).toEqual({ exact: 48000 });
});
test("probe reports delivered format and releases its frame without substituting requested values", async () => {
  await fixture(44100, async observed => {
    let format;
    const stream = await prepareCaptureAudio({} as MediaStreamTrack, true, 44100, value => { format = value; });
    expect(format).toEqual({ sampleRate: 44100, channels: 2 });
    expect(observed.closed).toBe(1);
    await stream.cancel(); expect(observed.canceled).toBe(1);
  });
});
test("a browser ignoring the requested rate fails before upload and closes the probe", async () => {
  await fixture(48000, async observed => {
    await expect(prepareCaptureAudio({} as MediaStreamTrack, true, 44100)).rejects.toThrow("48000 Hz instead of 44100 Hz");
    expect(observed.closed).toBe(1); expect(observed.canceled).toBe(1);
  });
});
