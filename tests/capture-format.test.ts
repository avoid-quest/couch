import { expect, test } from "bun:test";
import { prepareCaptureAudio } from "../src/client/session/capture-audio";
import { isNativeChannelMap, isNativeInputChannelPreference, liveCaptureConstraints, nativeInputChannelMap, nativeInputChannelOptions, nativeInputChannelPreference } from "../src/shared/audio-settings";

test("native inputs offer adjacent stereo pairs and individual mono channels", () => {
  expect(nativeInputChannelOptions(4)).toEqual(["1/2", "3/4", "1", "2", "3", "4"]);
  expect(nativeInputChannelOptions(3)).toEqual(["1/2", "1", "2", "3"]);
  expect(nativeInputChannelMap("3/4")).toEqual([2, 3]);
  expect(nativeInputChannelMap("2")).toEqual([1]);
  for (const value of ["0", "01", "1/02", "2/3", "1/1", "1/3", "1/2/3", "-1", "NaN", "1.5", ""]) expect(isNativeInputChannelPreference(value)).toBe(false);
  expect(isNativeChannelMap([2, 3], 3)).toBe(false);
  expect(isNativeChannelMap([1], 2)).toBe(false);
  expect(nativeInputChannelPreference("3/4", 4)).toBe("3/4");
  expect(nativeInputChannelPreference("3/4", 2)).toBe("1/2");
  expect(nativeInputChannelPreference("4", 3)).toBe("1/2");
});

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
