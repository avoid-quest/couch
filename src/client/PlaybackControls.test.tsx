import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../shared/protocol";
import { PlaybackControls } from "./PlaybackControls";

const state: SessionState = {
  queue: [{ id: "one", source: "radio:one", title: "Station", kind: "radio" }], currentEntryId: "one", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "one", status: "playing", position: 0, duration: null, volume: 80, seekable: false, error: null, nowPlaying: { title: "Observed song", artist: "Artist" } },
  radioProgramme: { playbackId: "one", stationId: "station", provider: "radio.avoid.quest", title: "Programme title", artworkUrl: "https://art.example/programme.jpg", sampledAt: 1000, expiresAt: 901000 },
};
const render = (value: SessionState, connected = true) => renderToStaticMarkup(<PlaybackControls state={value} connected={connected} credentials={{ origin: "http://localhost", token: "test" }} run={async () => true} />);

test("radio controls show programme artwork and attribution alongside native track text", () => {
  const html = render(state);
  expect(html).toContain("Programme: Programme title");
  expect(html).toContain("https://art.example/programme.jpg");
  expect(html).toContain("via radio.avoid.quest");
  expect(html).toContain("Artist · Observed song");
});

test("missing programme artwork leaves a title and disconnected controllers hide stale programmes", () => {
  expect(render({ ...state, radioProgramme: { ...state.radioProgramme!, artworkUrl: undefined } })).toContain("Programme: Programme title");
  expect(render(state, false)).not.toContain("Programme: Programme title");
});
