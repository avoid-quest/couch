import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackTransport } from "../src/client/components/PlaybackTransport";
import type { ClientSessionState } from "../src/client/session/session";
import type { PlayerState, QueueEntry } from "../src/shared/protocol";

const film: QueueEntry = { id: "film", title: "Film", source: "web:https://streamingcommunity.example/watch/1", duration: 6000 };
const radio: QueueEntry = { id: "radio", title: "Station", source: "radio:station", kind: "radio" };
const channel: QueueEntry = { id: "channel", title: "Rai 1", source: "web:https://www.raiplay.it/dirette/rai1", live: true };
const capture: QueueEntry = { id: "capture", title: "Studio screen", source: "live:screen", liveSourceId: "screen", live: true };

function slots(entry: QueueEntry, player: Partial<PlayerState>, queue: QueueEntry[] = [entry]) {
  const state = { queue, currentEntryId: entry.id, player: { playbackId: "p1", status: "playing", position: 60, duration: null, volume: 50, seekable: false, error: null, ...player } } as unknown as ClientSessionState;
  const markup = renderToStaticMarkup(createElement(PlaybackTransport, { state, connected: true, run: async () => true }));
  return [...markup.matchAll(/<button([^>]*)>/g)].map(([, attributes]) => `${/aria-label="([^"]+)"/.exec(attributes!)![1]}${/ disabled=""/.test(attributes!) ? " (disabled)" : ""}`);
}

test("every kind of media keeps Play or Pause, Stop and Next in three fixed slots", () => {
  expect(slots(film, { seekable: true, duration: 6000 })).toEqual(["Pause", "Stop", "Next (disabled)"]);
  expect(slots(film, { seekable: true, duration: 6000, status: "paused" }, [film, radio])).toEqual(["Play", "Stop", "Next"]);
  expect(slots(film, { status: "loading" })).toEqual(["Play (disabled)", "Stop", "Next (disabled)"]);
  expect(slots(film, { status: "ended" })).toEqual(["Replay", "Stop", "Next (disabled)"]);
  expect(slots(film, { status: "error", error: "Gone" })).toEqual(["Try again", "Stop", "Next (disabled)"]);
});

test("live media that can't pause keeps Pause, disabled, beside an enabled Stop", () => {
  expect(slots(radio, {})).toEqual(["Pause (disabled)", "Stop", "Next (disabled)"]);
  for (const entry of [channel, capture]) {
    expect(slots(entry, {}, [entry, film])).toEqual(["Pause (disabled)", "Stop", "Next"]);
    expect(slots(entry, { status: "paused" })).toEqual(["Play", "Stop", "Next (disabled)"]);
  }
});

test("a device input retries through the normal player and uses the reported playback capabilities", () => {
  expect(slots(capture, { status: "loading" })).toEqual(["Pause (disabled)", "Stop", "Next (disabled)"]);
  expect(slots(capture, { status: "error", error: "Source disconnected" })).toEqual(["Try again", "Stop", "Next (disabled)"]);
  expect(slots(capture, { seekable: true, duration: 60 })).toEqual(["Pause", "Stop", "Next (disabled)"]);
});

test("a page change's first key lands on the first enabled slot", () => {
  const first = (entry: QueueEntry, player: Partial<PlayerState>) => {
    const state = { queue: [entry], currentEntryId: entry.id, player: { playbackId: "p1", status: "playing", position: 60, duration: null, volume: 50, seekable: false, error: null, ...player } } as unknown as ClientSessionState;
    const markup = renderToStaticMarkup(createElement(PlaybackTransport, { state, connected: true, run: async () => true, pageFirst: true }));
    return [...markup.matchAll(/<button([^>]*)>/g)].filter(([, attributes]) => attributes!.includes("data-page-first")).map(([, attributes]) => /aria-label="([^"]+)"/.exec(attributes!)![1]);
  };
  expect(first(film, { seekable: true, duration: 6000 })).toEqual(["Pause"]);
  expect(first(radio, {})).toEqual(["Stop"]);
  expect(first(capture, {})).toEqual(["Stop"]);
  expect(first(capture, { status: "error" })).toEqual(["Try again"]);
});
