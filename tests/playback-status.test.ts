import { expect, test } from "bun:test";
import { playbackCapabilities } from "../src/client/components/PlaybackTransport";
import type { ClientSessionState } from "../src/client/session/session";

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
