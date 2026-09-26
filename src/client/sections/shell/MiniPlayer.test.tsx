import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../../../shared/protocol";
import { ShellProviders } from "./test-providers";
import { MiniPlayer } from "./MiniPlayer";

const state: SessionState = {
  queue: [{ id: "one", title: "Evening movie", source: "library:movie" }], currentEntryId: "one",
  installationName: "Living room", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null },
};
const render = (value: SessionState, connected: boolean) => renderToStaticMarkup(<ShellProviders value={{ state: value }}><MiniPlayer state={value} connected={connected} localHost={false} run={async () => true} onOpen={() => {}} /></ShellProviders>);

test("the mini player names the host while reconnecting", () => {
  expect(render(state, false)).toContain("Reconnecting to Living room…");
});

test("the mini player reports a playback error even without a playback id", () => {
  const errored: SessionState = { ...state, player: { ...state.player, status: "error", playbackId: null } };
  expect(render(errored, true)).toContain("Can&#x27;t play Evening movie");
});
