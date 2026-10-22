import { expect, test } from "bun:test";
import { levelOf, playbackStatus, sounding } from "../src/client/playback-status";
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
  // The plain states are the transport's to say; status lines stay quiet for them.
  expect(playbackStatus(state("playing"), true).quiet).toBe(true);
  expect(playbackStatus(state("ended"), true).quiet).toBeUndefined();
});

test("Next can recover from loading or failure, but never acts while offline or unavailable", () => {
  for (const status of ["loading", "error", "ended"] as const) {
    expect(playbackCapabilities(state(status), true).nextReady).toBe(true);
    expect(playbackCapabilities(state(status), false).nextReady).toBe(false);
  }
  expect(playbackCapabilities(state("unavailable"), true).nextReady).toBe(false);
});

test("Next continues into what Autoplay picked, only while Autoplay is on", () => {
  const last = (autoplay: object) => state("playing", {currentEntryId: "two", autoplay});
  expect(playbackCapabilities(last({enabled: true, contextTitle: null, upcoming: []}), true).hasNext).toBe(false);
  expect(playbackCapabilities(last({enabled: true, contextTitle: "Series", upcoming: [{id: "three"}]}), true).hasNext).toBe(true);
  expect(playbackCapabilities(last({enabled: false, contextTitle: "Series", upcoming: [{id: "three"}]}), true).hasNext).toBe(false);
});

test("the level moves only while sound comes out: flat while paused, buffering, loading, failed or offline", () => {
  expect(sounding(state("playing"), true)).toBe(true);
  for (const status of ["paused", "loading", "error", "ended", "idle", "unavailable"] as const) expect(sounding(state(status), true)).toBe(false);
  expect(sounding(state("playing", {player: {status: "playing", buffering: true}}), true)).toBe(false);
  expect(sounding(state("playing"), false)).toBe(false);
  expect(sounding(null, true)).toBe(false);
});

test("an item shows the level only while it is what plays, matched by its address with or without web:", () => {
  expect(levelOf(state("playing"), true, ["https://example.com/one"])).toBe("moving");
  expect(levelOf(state("paused"), true, ["web:https://example.com/one"])).toBe("flat");
  expect(levelOf(state("playing"), true, ["https://example.com/two"])).toBeNull();
  expect(levelOf(state("playing"), true, [undefined])).toBeNull();
  // A station is matched by its Couch source or the stream it plays.
  const station = state("playing", {queue: [{id: "one", source: "radio:nts-2", kind: "radio"}]});
  expect(levelOf(station, true, ["radio:nts-2", "https://stream.example/nts2"])).toBe("moving");
  expect(levelOf(station, true, ["radio:nts-1", "https://stream.example/nts1"])).toBeNull();
  expect(levelOf(state("playing", {currentEntryId: null}), true, ["https://example.com/one"])).toBeNull();
});
