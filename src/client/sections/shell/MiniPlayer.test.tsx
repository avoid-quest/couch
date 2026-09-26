import { setupUiTests, render as renderUI, screen } from "@/testing/react";
import { expect, test } from "bun:test";
import type { SessionState } from "../../../shared/protocol";
import { ShellProviders } from "./test-providers";
import { MiniPlayer } from "./MiniPlayer";

setupUiTests();

const state: SessionState = {
  queue: [{ id: "one", title: "Evening movie", source: "library:movie" }], currentEntryId: "one",
  installationName: "Living room", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null },
};
const render = (value: SessionState, connected: boolean) => renderUI(<ShellProviders value={{ state: value }}><MiniPlayer state={value} connected={connected} localHost={false} run={async () => true} onOpen={() => {}} /></ShellProviders>);

test("the mini player names the host while reconnecting", () => {
  render(state, false);
  expect(screen.getByText("Reconnecting to Living room…")).toBeInTheDocument();
});

test("the mini player reports a playback error even without a playback id", () => {
  const errored: SessionState = { ...state, player: { ...state.player, status: "error", playbackId: null } };
  render(errored, true);
  expect(screen.getByText("Can't play Evening movie")).toBeInTheDocument();
});
