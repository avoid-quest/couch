import { expect, test } from "bun:test";
import { playbackCapabilities } from "../src/client/components/PlaybackTransport";
import type { ClientSessionState } from "../src/client/session/session";
import { playbackControls } from "../src/shared/playback-policy";

const state = (status: ClientSessionState["player"]["status"], extra: object = {}) =>
  ({
    installationName: "Living room",
    currentEntryId: "one",
    queue: [
      { id: "one", source: "web:https://example.com/one" },
      { id: "two", source: "web:https://example.com/two" },
    ],
    player: { status, playbackId: "playback", error: null },
    ...extra,
  }) as ClientSessionState;

test("Next can recover from loading or failure, but never acts while offline or unavailable", () => {
  for (const status of ["loading", "error", "ended"] as const) {
    expect(playbackCapabilities(state(status), true).nextReady).toBe(true);
    expect(playbackCapabilities(state(status), false).nextReady).toBe(false);
  }
  expect(playbackCapabilities(state("unavailable"), true).nextReady).toBe(false);
});

test("Next continues into what Autoplay picked, only while Autoplay is on", () => {
  const last = (autoplay: object) => state("playing", { currentEntryId: "two", autoplay });
  expect(
    playbackCapabilities(last({ enabled: true, contextTitle: null, upcoming: [] }), true).hasNext,
  ).toBe(false);
  expect(
    playbackCapabilities(
      last({ enabled: true, contextTitle: "Series", upcoming: [{ id: "three" }] }),
      true,
    ).hasNext,
  ).toBe(true);
  expect(
    playbackCapabilities(
      last({ enabled: false, contextTitle: "Series", upcoming: [{ id: "three" }] }),
      true,
    ).hasNext,
  ).toBe(false);
});

test("relaxed captures can pause without seeking, while Live listeners retain their own controls", () => {
  for (const intent of ["relaxed", "live"] as const) {
    const capture = state("playing", {
      queue: [{ id: "one", source: "", live: true, liveSourceId: "input" }],
      controls: playbackControls({
        intent,
        authorized: true,
        receiving: true,
        capture: true,
        seekable: false,
        scheduled: true,
      }),
    });
    expect(playbackCapabilities(capture, true).pausable).toBe(intent === "relaxed");
    expect(playbackCapabilities(capture, true).seekable).toBe(false);
  }
});

test("an unseekable external live stream still cannot pause, but can resume when paused", () => {
  const queue = [{ id: "one", source: "web:https://example.com/live", live: true }];
  expect(playbackCapabilities(state("playing", { queue }), true).pausable).toBe(false);
  expect(playbackCapabilities(state("paused", { queue }), true).pausable).toBe(true);
});
