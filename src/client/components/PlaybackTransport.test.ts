import { setupUiTests, render, screen } from "../testing/react";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { PlaybackClockContext } from "@/session/playback-clock";
import { PlaybackTimeline, playbackCapabilities } from "./PlaybackTransport";
import type { SessionState } from "../../shared/protocol";

setupUiTests();

test("a fixed-volume Mac output still permits playback recovery", () => {
  const state = { queue: [], currentEntryId: null, player: { playbackId: "playback", status: "paused", seekable: true }, systemAudio: {
    selectedOutput: "headphones", observedOutput: "headphones", volume: null, volumeWritable: false, muted: false, error: null, platform: "mac",
  } } as unknown as SessionState;
  expect(playbackCapabilities(state, true)).toMatchObject({ audioReady: true, transportReady: true });
  expect(playbackCapabilities({ ...state, systemAudio: { ...state.systemAudio!, error: "Headphones disconnected" } }, true).audioReady).toBe(false);
});

test("nonlive playback retains elapsed and remaining time when seeking is unavailable", () => {
  const state = { queue: [{ id: "video", title: "Video", source: "https://media.example/video", duration: 300 }], currentEntryId: "video", player: {
    playbackId: "playback", status: "playing", position: 60, duration: 300, speed: 1, seekable: false,
  } } as unknown as SessionState;
  render(createElement(PlaybackClockContext.Provider, { value: state.player }, createElement(PlaybackTimeline, { state, connected: true, run: async () => true })));
  expect(screen.getByText("1:00")).toBeInTheDocument();
  expect(screen.getByText(/−4:00 ends /)).toBeInTheDocument();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
