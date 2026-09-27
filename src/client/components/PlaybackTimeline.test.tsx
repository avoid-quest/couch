import { act, render, screen, setupUiTests, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import { PlaybackClockContext } from "@/session/playback-clock";
import type { Action, SessionState } from "../../shared/protocol";
import { PlaybackTimeline, playbackCapabilities } from "./PlaybackTransport";

setupUiTests();
const state: SessionState = { queue: [{ id: "live", title: "Event", source: "https://media.example/event.mpd" }], currentEntryId: "live", activeProfile: { id: "household", name: "Household" }, player: {
  playbackId: "playback", status: "playing", position: 125, duration: null, live: true, seekRange: { start: 120, end: 180 }, seekable: true, volume: 80, error: null,
} };

test("live DVR seeks within its observed window without requiring a duration", async () => {
  const actions: Action[] = [];
  render(<PlaybackClockContext.Provider value={state.player}><PlaybackTimeline state={state} connected run={async action => { actions.push(action); return true; }} /></PlaybackClockContext.Provider>);
  const slider = screen.getByRole("slider", { name: "Playback position" });
  expect(slider).toHaveAttribute("aria-valuemin", "120");
  expect(slider).toHaveAttribute("aria-valuemax", "180");
  expect(screen.getByText("Live")).toBeInTheDocument();
  expect(screen.queryByText(/ends /)).toBeNull();
  slider.focus();
  await userEvent.keyboard("{ArrowLeft}{End}{ArrowRight}{Home}");
  expect(actions.map(action => action.type === "seek" ? action.position : null)).toEqual([120, 180, 180, 120]);
});

test("an advancing DVR window clamps an existing keyboard draft", async () => {
  const actions: Action[] = [];
  const show = (next: SessionState) => <PlaybackClockContext.Provider value={next.player}><PlaybackTimeline state={next} connected run={async action => { actions.push(action); return true; }} /></PlaybackClockContext.Provider>;
  const view = render(show(state));
  screen.getByRole("slider", { name: "Playback position" }).focus();
  await userEvent.keyboard("{Home}");
  const next = { ...state, player: { ...state.player, seekRange: { start: 140, end: 200 } } };
  await act(async () => view.rerender(show(next)));
  expect(screen.getByRole("slider", { name: "Playback position" })).toHaveAttribute("aria-valuenow", "140");
  await userEvent.keyboard("{ArrowLeft}");
  expect(actions.at(-1)).toMatchObject({ type: "seek", position: 140 });
});

test("observed live playback without DVR does not advertise pause", () => {
  expect(playbackCapabilities({ ...state, player: { ...state.player, seekable: false, seekRange: undefined } }, true).pausable).toBe(false);
});
