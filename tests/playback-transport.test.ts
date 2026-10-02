import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackTransport } from "../src/client/components/PlaybackTransport";
import type { ClientSessionState } from "../src/client/session/session";
import type { PlayerState, QueueEntry } from "../src/shared/protocol";

const film: QueueEntry = { id: "film", title: "Film", source: "web:https://streamingcommunity.example/watch/1", duration: 6000 };
const radio: QueueEntry = { id: "radio", title: "Station", source: "radio:station", kind: "radio" };
const channel: QueueEntry = { id: "channel", title: "Rai 1", source: "web:https://www.raiplay.it/dirette/rai1", live: true };

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
  expect(slots(channel, {}, [channel, film])).toEqual(["Pause (disabled)", "Stop", "Next"]);
  expect(slots(channel, { status: "paused" })).toEqual(["Play", "Stop", "Next (disabled)"]);
});
