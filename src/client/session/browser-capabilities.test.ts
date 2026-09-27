import { setupUiTests } from "@/testing/react";
import { afterEach, expect, mock, test } from "bun:test";
import { browserMediaCapabilities } from "./browser-capabilities";

setupUiTests();
const original = Object.getOwnPropertyDescriptor(navigator, "mediaCapabilities");
afterEach(() => {
  if (original) Object.defineProperty(navigator, "mediaCapabilities", original);
  else Reflect.deleteProperty(navigator, "mediaCapabilities");
});

for (const supported of [true, false]) test(`reports decoding support ${supported} without creating a player`, async () => {
  const decodingInfo = mock(async (_configuration: MediaDecodingConfiguration) => ({ supported, smooth: false, powerEfficient: false }));
  Object.defineProperty(navigator, "mediaCapabilities", { configurable: true, value: { decodingInfo } });
  expect(await browserMediaCapabilities()).toEqual({ mp4H264Aac: supported, mp3: supported });
  expect(decodingInfo.mock.calls).toEqual([
    [{ type: "file", video: { contentType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, bitrate: 20_000_000, framerate: 30 }, audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"', channels: "2", samplerate: 48_000, bitrate: 192_000 } }],
    [{ type: "file", audio: { contentType: "audio/mpeg", channels: "2", samplerate: 48_000, bitrate: 320_000 } }],
  ]);
  expect(document.querySelector("video, audio")).toBeNull();
});

test("an unavailable decoding API is conservatively unsupported", async () => {
  Object.defineProperty(navigator, "mediaCapabilities", { configurable: true, value: undefined });
  expect(await browserMediaCapabilities()).toEqual({ mp4H264Aac: false, mp3: false });
});

test("a rejected format probe does not discard the other supported format", async () => {
  Object.defineProperty(navigator, "mediaCapabilities", { configurable: true, value: { decodingInfo: async (configuration: MediaDecodingConfiguration) => {
    if (configuration.video) throw new Error("Unavailable decoder");
    return { supported: true };
  } } });
  expect(await browserMediaCapabilities()).toEqual({ mp4H264Aac: false, mp3: true });
});
