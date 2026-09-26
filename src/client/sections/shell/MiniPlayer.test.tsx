import { setupUiTests, render as renderUI, screen, fireEvent, act, within } from "@/testing/react";
import { expect, test, mock } from "bun:test";
import type { Action, SessionState } from "../../../shared/protocol";
import { ShellProviders } from "./test-providers";
import { MiniPlayer } from "./MiniPlayer";

setupUiTests();

const state: SessionState = {
  queue: [{ id: "one", title: "Evening movie", source: "library:movie" }], currentEntryId: "one",
  installationName: "Living room", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null },
};
const render = (value: SessionState, connected: boolean, run: (action: Action) => Promise<boolean> = async () => true, onOpen = () => {}) => renderUI(<ShellProviders value={{ state: value }}><MiniPlayer state={value} connected={connected} run={run} onOpen={onOpen} /></ShellProviders>);

test("the mini player names the host while reconnecting", () => {
  render(state, false);
  expect(screen.getByText("Reconnecting to Living room…")).toBeInTheDocument();
});

test("the mini player reports a playback error even without a playback id", () => {
  const errored: SessionState = { ...state, player: { ...state.player, status: "error", playbackId: null } };
  render(errored, true);
  expect(screen.getByText("Can't play Evening movie")).toBeInTheDocument();
});


test("live radio has a direct stop action without pause or seeking", () => {
  const run = mock(async (_action: Action) => true);
  render({ ...state, queue: [{ id: "one", title: "Evening radio", source: "radio:one", kind: "radio", live: true }], player: { ...state.player, seekable: false } }, true, run);
  expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  expect(screen.queryByRole("slider", { name: "Playback position" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(run).toHaveBeenCalledWith({ type: "stop" });
});

test("seekable media can seek from the bottom player using ten-second keyboard steps", async () => {
  const run = mock(async (_action: Action) => true);
  render(state, true, run);
  await act(async () => fireEvent.keyDown(screen.getByRole("slider", { name: "Playback position" }), { key: "ArrowRight" }));
  expect(run).toHaveBeenCalledWith({ type: "seek", playbackId: "playback", position: 22 });
});

test("reconnecting disables playback and seek commands", async () => {
  const run = mock(async (_action: Action) => true);
  render(state, false, run);
  expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
  await act(async () => fireEvent.keyDown(screen.getByRole("slider", { name: "Playback position" }), { key: "ArrowRight" }));
  expect(run).not.toHaveBeenCalled();
});

test("the current radio programme opens the player while retaining station context", () => {
  const onOpen = mock(() => {});
  render({ ...state, radioProgramme: { playbackId: "playback", stationId: "one", provider: "radio.avoid.quest", title: "Night music", sampledAt: 0, expiresAt: 100 } }, true, undefined, onOpen);
  expect(screen.getByText("Evening movie")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open player: Night music" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("loading live media reports loading instead of claiming it is live", () => {
  render({ ...state, queue: [{ ...state.queue[0]!, live: true }], player: { ...state.player, status: "loading" } }, true);
  expect(screen.getByRole("status")).toHaveTextContent("Loading…");
});


test("compact volume controls open the shared slider and accept keyboard adjustment", async () => {
  const run = mock(async (_action: Action) => true);
  render(state, true, run);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Volume controls" })));
  const volume = within(screen.getByRole("dialog", { name: "Volume controls" })).getByRole("slider", { name: "Volume" });
  await act(async () => fireEvent.keyDown(volume, { key: "End" }));
  expect(run).toHaveBeenCalledWith({ type: "volume", volume: 100 });
});
