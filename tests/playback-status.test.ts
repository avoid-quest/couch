import { expect, test } from "bun:test";
import { playbackStatus } from "../src/client/playback-status";
import { playbackCapabilities } from "../src/client/components/PlaybackTransport";
import type { ClientSessionState } from "../src/client/session/session";

const state = (status: ClientSessionState["player"]["status"], extra: object = {}) => ({
  installationName: "Living room", currentEntryId: "one", queue: [{id: "one", source: "web:https://example.com/one"}, {id: "two", source: "web:https://example.com/two"}],
  player: {status, playbackId: "playback", error: null}, ...extra,
}) as ClientSessionState;

test("status vocabulary covers failures, stalls, retry countdowns, and the end of autoplay", () => {
  expect(playbackStatus(state("playing"), false).label).toBe("Offline");
  expect(playbackStatus(null, true).label).toBe("Connecting…");
  expect(playbackStatus(state("unavailable"), true).detail).not.toContain("Press Play");
  expect(playbackStatus(state("error"), true).label).toBe("Can't play");
  expect(playbackStatus(state("loading", {player: {status: "loading", buffering: true}}), true).label).toBe("Buffering…");
  expect(playbackStatus(state("loading", {radioRetry: {retryAt: 4500, attempt: 2, maximum: 5}}), true, 2000).detail).toBe("Trying again in 3 s (2 of 5).");
  expect(playbackStatus(state("ended", {autoplay: {enabled: true, pending: true}}), true).label).toBe("Finding the next item…");
  expect(playbackStatus(state("ended"), true).label).toBe("Finished");
  expect(playbackStatus(state("paused"), true).label).toBe("Paused");
});

test("Next can recover from loading or failure, but never acts while offline or unavailable", () => {
  for (const status of ["loading", "error", "ended"] as const) {
    expect(playbackCapabilities(state(status), true).nextReady).toBe(true);
    expect(playbackCapabilities(state(status), false).nextReady).toBe(false);
  }
  expect(playbackCapabilities(state("unavailable"), true).nextReady).toBe(false);
});
