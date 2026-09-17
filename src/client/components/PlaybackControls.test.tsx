import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../../shared/protocol";
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


test("session hero uses real artwork and keeps idle free of placeholder art and controls", () => {
  const session = (value: SessionState) => renderToStaticMarkup(<PlaybackControls presentation="session" state={value} connected credentials={{ origin: "http://localhost", token: "test" }} run={async () => true} />);
  const playing = session(state);
  expect(playing).toContain("session-current-art");
  expect(playing).toContain("https://art.example/programme.jpg");
  expect(playing).not.toContain("Volume &amp; playback options");
  expect(playing).not.toContain("Playback position");
  const idle = session({ ...state, currentEntryId: null, radioProgramme: undefined, player: { ...state.player, playbackId: null, status: "idle", nowPlaying: null } });
  expect(idle).not.toContain("session-current-art");
  expect(idle).not.toContain("transport-row");
  expect(idle).not.toContain("now-heading");
  expect(idle).toContain("What would you like to play?");
});
