import { expect, test } from "bun:test";
import { playbackCapabilities } from "./PlaybackTransport";
import type { SessionState } from "../../shared/protocol";

test("a fixed-volume Mac output still permits playback recovery", () => {
  const state = { queue: [], currentEntryId: null, player: { playbackId: "playback", status: "paused", seekable: true }, systemAudio: {
    selectedOutput: "headphones", observedOutput: "headphones", volume: null, volumeWritable: false, muted: false, error: null, platform: "mac",
  } } as unknown as SessionState;
  expect(playbackCapabilities(state, true)).toMatchObject({ audioReady: true, transportReady: true });
  expect(playbackCapabilities({ ...state, systemAudio: { ...state.systemAudio!, error: "Headphones disconnected" } }, true).audioReady).toBe(false);
});
