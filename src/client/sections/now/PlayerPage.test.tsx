import { setupUiTests, render as renderUI, act, screen, userEvent, testWindow, within } from "@/testing/react";
import { beforeEach, expect, jest, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { ShellProviders } from "../shell/test-providers";
import type { SessionState } from "../../../shared/protocol";
import type { ShellValue } from "../shell/AppShell";

setupUiTests();

let view: ReturnType<typeof renderUI>;
const actions: unknown[] = [];
let leaves = 0;
const state: SessionState = {
  queue: [{ id: "current", title: "Evening movie", source: "library:movie", duration: 100 }],
  currentEntryId: "current",
  activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null },
};
const shell = {
  state, credentials: { origin: "http://localhost", token: "paired" }, connected: true,
  run: async (action: unknown) => { actions.push(action); return true; },
  available: true, nativeHost: false, localHost: true, active: true,
  current: state.queue[0], programme: null, videoQualityPreference: { quality: "auto" },
  leavePlayer: () => { leaves++; },
} as unknown as ShellValue;

beforeEach(async () => {
  actions.length = 0; leaves = 0;
  testWindow.happyDOM.setURL("http://localhost/");
  view = renderUI(<></>);
});

test("player keys leave focused buttons outside the player available", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<><button>Undo</button><ShellProviders value={shell}><PlayerPage /></ShellProviders></>));
  const outside = screen.getByRole("button", { name: "Undo" });
  outside.focus();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  outside.dispatchEvent(enter);
  const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  outside.dispatchEvent(space);
  expect(enter.defaultPrevented).toBe(false);
  expect(space.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(outside);
  expect(actions).toEqual([]);
  expect(screen.getByRole("slider", { name: "Volume" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "40");
});

test("Escape leaves an open overlay to close itself before leaving the player", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("data-state", "open"); document.body.append(dialog);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(leaves).toBe(0);
  dialog.remove();
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(leaves).toBe(1);
});

test("Escape closes the player sheet before leaving the player", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  await userEvent.click(screen.getByRole("button", { name: "Playback" }));
  expect(screen.queryByRole("dialog")).not.toBeNull();
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(leaves).toBe(0);
});

test("keyboard commands use the latest session callbacks", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const latest: unknown[] = [];
  const changed = { ...shell, credentials: { origin: "http://another-host", token: "new" }, run: async (action: unknown) => { latest.push(action); return true; } } as unknown as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={changed}><PlayerPage /></ShellProviders>));
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  expect(actions).toEqual([]);
  expect(latest).toEqual([{ type: "pause", playbackId: "playback", paused: true }]);
});

test("the timeline names the current chapter", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const chapters = [{ title: "Opening", position: 0 }, { title: "The meeting", position: 10 }, { title: "Finale", position: 80 }];
  const withChapters = { ...shell, state: { ...state, player: { ...state.player, position: 12, chapters } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={withChapters}><PlayerPage /></ShellProviders>));
  expect(screen.getByText("The meeting")).toBeInTheDocument();
});

test("an error offers Skip even at the end of Up next", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const errored = { ...shell, state: { ...state, player: { ...state.player, status: "error" as const, error: "The video could not be loaded." } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={errored}><PlayerPage /></ShellProviders>));
  const skip = screen.getByRole("button", { name: "Skip" });
  expect(skip).toBeEnabled();
  await act(async () => skip.click());
  expect(actions).toEqual([{ type: "next", playbackId: "playback" }]);
});

test("loading and buffering report playback progress", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const loading = { ...shell, state: { ...state, player: { ...state.player, status: "loading" as const } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={loading}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("heading", { name: "Loading Evening movie" })).toBeInTheDocument();
  const buffering = { ...loading, state: { ...(loading as unknown as { state: SessionState }).state, player: { ...(loading as unknown as { state: SessionState }).state.player, buffering: true } } } as unknown as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={buffering}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("heading", { name: "Loading Evening movie" })).not.toBeInTheDocument();
  expect(within(document.querySelector<HTMLElement>("[data-player-header]")!).getByRole("status")).toHaveTextContent("Buffering…");
});

test("an idle player renders nothing; the shell returns to Home, which shows Up next", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const idle = { ...shell, active: false, current: undefined, state: { ...state, queue: [state.queue[0]!, { id: "next", title: "Next movie", source: "library:movie", duration: 120 }], currentEntryId: null, queueCursorEntryId: "current", player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={idle}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
});

test("a sheet does not reopen when playback ends and a new item starts", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  await userEvent.click(screen.getByRole("button", { name: "Playback" }));
  expect(screen.queryByRole("dialog")).not.toBeNull();
  const idle = { ...shell, active: false, current: undefined, state: { ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={idle}><PlayerPage /></ShellProviders>));
  const next = { ...shell, current: { ...state.queue[0]!, id: "next", title: "Next movie" }, state: { ...state, currentEntryId: "next", queue: [{ ...state.queue[0]!, id: "next", title: "Next movie" }], player: { ...state.player, playbackId: "next-playback" } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={next}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the compact player keeps the current title without repeating playback attribution", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const attributed = { ...shell, state: { ...state, playedBy: { deviceId: "phone", name: "Kitchen phone" }, player: { ...state.player, nowPlaying: { title: "Evening movie", artist: "Known artist" } } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={attributed}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("heading", { name: "Evening movie" })).toBeInTheDocument();
  expect(screen.queryByText(/played from Kitchen phone/)).not.toBeInTheDocument();
});


test.each([true, false])("radio shows provider details and keeps observed track text separate (local: %s)", async localHost => {
  const { PlayerPage } = await import("./PlayerPage");
  const current = { id: "radio", title: "NTS Radio", source: "radio:nts", kind: "radio" as const };
  const programme = { playbackId: "playback", stationId: "nts", provider: "radio.avoid.quest" as const, title: "Alexander Nut", genre: "Detroit House", artist: "Allysha Joy", album: "Live session", bitrate: 320, description: "Broken beat and soul.", programmeUrl: "https://www.nts.live/shows/alexander-nut", artworkUrl: "https://images.example/show.jpg", sampledAt: Date.now(), expiresAt: Date.now() + 60_000 };
  const radio = { ...shell, localHost, current, programme, state: { ...state, currentEntryId: current.id, queue: [current], player: { ...state.player, nowPlaying: { artist: "Track artist", title: "Observed song" } } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={radio}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("heading", { name: "Alexander Nut" })).toBeInTheDocument();
  expect(screen.queryByText("Broken beat and soul.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "About this show" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Alexander Nut");
  expect(screen.getByText("Broken beat and soul.")).toBeVisible();
  expect(screen.getByText("Detroit House · Allysha Joy · Live session · 320 kbps")).toBeVisible();
  expect(screen.getAllByText("Track artist — Observed song").length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Open show page" })).toHaveAttribute("href", programme.programmeUrl);
  expect(document.querySelector(`img[src="${programme.artworkUrl}"]`)).not.toBeNull();
  await act(async () => view.rerender(<ShellProviders value={{ ...radio, nativeHost: true }}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("link", { name: "Open show page" })).toBeNull();
  expect(screen.getByText("Broken beat and soul.")).toBeVisible();
});


test("idle player hides its cursor and pointer movement restores controls", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  jest.useFakeTimers();
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const player = screen.getByRole("region", { name: "Player" });
  await act(async () => jest.advanceTimersByTime(4000));
  expect(player).toHaveClass("cursor-none");
  expect(player.querySelector("[data-player-band]")).toHaveAttribute("inert");
  await act(async () => player.dispatchEvent(new Event("pointermove", { bubbles: true })));
  expect(player).not.toHaveClass("cursor-none");
  expect(player.querySelector("[data-player-band]")).not.toHaveAttribute("inert");
  await act(async () => player.dispatchEvent(new Event("pointerout", { bubbles: true })));
  await act(async () => jest.advanceTimersByTime(4000));
  expect(player).not.toHaveClass("cursor-none");
});

test("keyboard-focused player controls stay visible until focus leaves", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  jest.useFakeTimers();
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const player = screen.getByRole("region", { name: "Player" });
  const control = screen.getByRole("button", { name: "Playback" });
  await act(async () => control.focus());
  await act(async () => jest.advanceTimersByTime(4000));
  expect(player.querySelector("[data-player-band]")).not.toHaveAttribute("inert");
  expect(document.activeElement).toBe(control);
  await act(async () => control.blur());
  await act(async () => jest.advanceTimersByTime(4000));
  expect(player).toHaveClass("cursor-none");
});

test("native cursor follows player controls and is restored when leaving", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
  Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } } } });
  jest.useFakeTimers();
  await act(async () => view.rerender(<ShellProviders value={{ ...shell, nativeHost: true }}><PlayerPage /></ShellProviders>));
  await act(async () => jest.advanceTimersByTime(4000));
  expect(invoke).toHaveBeenLastCalledWith("set_native_cursor_visible", { visible: false });
  await act(async () => screen.getByRole("region", { name: "Player" }).dispatchEvent(new Event("pointermove", { bubbles: true })));
  expect(invoke).toHaveBeenLastCalledWith("set_native_cursor_visible", { visible: true });
  await act(async () => jest.advanceTimersByTime(4000));
  expect(invoke).toHaveBeenLastCalledWith("set_native_cursor_visible", { visible: false });
  await act(async () => view.unmount());
  expect(invoke).toHaveBeenLastCalledWith("set_native_cursor_visible", { visible: true });
});

test("fullscreen control labels follow the browser and Escape exits before leaving the player", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  const change = (element: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: element });
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  document.documentElement.requestFullscreen = async () => change(document.documentElement);
  document.exitFullscreen = async () => change(null);
  try {
    await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
    await userEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
    expect(leaves).toBe(0);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(leaves).toBe(1);
  } finally {
    for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) Reflect.deleteProperty(document, key);
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  }
});

test("live radio keeps its controls visible and gives Stop the primary action", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  jest.useFakeTimers();
  const current = { id: "radio", title: "NTS Radio", source: "radio:nts", kind: "radio" as const };
  const radio = { ...shell, current, state: { ...state, currentEntryId: current.id, queue: [current], player: { ...state.player, seekable: false } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={radio}><PlayerPage /></ShellProviders>));
  await act(async () => jest.advanceTimersByTime(8000));
  const player = screen.getByRole("region", { name: "Player" });
  expect(player).not.toHaveClass("cursor-none");
  expect(player.querySelector("[data-player-band]")).not.toHaveAttribute("inert");
  expect(player.querySelector("[data-player-header]")).not.toHaveAttribute("inert");
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  const stop = screen.getByRole("button", { name: "Stop" });
  expect(stop).toHaveAttribute("data-play-button");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
  expect(actions).toEqual([]);
  await act(async () => stop.click());
  expect(actions).toEqual([{ type: "stop" }]);
});

test("Playback groups secondary controls and returns focus after browsing audio settings", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  const trigger = screen.getByRole("button", { name: "Playback" });
  await userEvent.click(trigger);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Audio & subtitles" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Audio & subtitles");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Playback" }).at(-1)!);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Playback");
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Stop playback" }));
  expect(actions).toEqual([{ type: "stop" }]);
});


test.each([false, true])("transport Tab order follows its visual sequence (live: %s)", async live => {
  const { PlayerPage } = await import("./PlayerPage");
  const current = { ...state.queue[0]!, live };
  const withNext = { ...shell, current, state: { ...state, queue: [current, { id: "next", title: "Next", source: "library:next" }], player: { ...state.player, seekable: !live } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={withNext}><PlayerPage /></ShellProviders>));
  const labels = live ? ["Stop", "Next"] : ["Back 10 seconds", "Pause", "Forward 10 seconds", "Next"];
  const controls = within(screen.getByRole("group", { name: "Playback controls" }));
  expect(controls.getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(labels);
  await act(async () => controls.getByRole("button", { name: labels[0] }).focus());
  for (const label of labels.slice(1)) {
    await userEvent.tab();
    expect(document.activeElement).toBe(controls.getByRole("button", { name: label }));
  }
});

test.each([
  { seekable: true, live: false, focus: "Playback position" },
  { seekable: false, live: false, focus: "Pause" },
  { seekable: false, live: true, focus: "Stop" },
])("waking video controls focuses $focus instead of Volume", async ({ seekable, live, focus }) => {
  const { PlayerPage } = await import("./PlayerPage");
  jest.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  const current = { ...state.queue[0]!, live };
  const video = { ...shell, current, state: { ...state, queue: [current], player: { ...state.player, seekable } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={video}><PlayerPage /></ShellProviders>));
  await act(async () => jest.advanceTimersByTime(4000));
  expect(document.querySelector("[data-player-band]")).toHaveAttribute("inert");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await act(async () => { for (const callback of frames.splice(0)) callback(performance.now()); });
  expect(document.activeElement).toBe(screen.getByRole(focus === "Playback position" ? "slider" : "button", { name: focus }));
  expect(actions).toEqual([]);
});

test.each([100, undefined])("seekable live playback retains seeking with duration %s", async duration => {
  const { PlayerPage } = await import("./PlayerPage");
  const current = { ...state.queue[0]!, live: true, duration };
  const live = { ...shell, current, state: { ...state, queue: [current], player: { ...state.player, duration, seekable: true } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={live}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("button", { name: "Back 10 seconds" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Forward 10 seconds" })).toBeEnabled();
  if (duration) expect(screen.getByRole("slider", { name: "Playback position" })).toBeInTheDocument();
  else expect(screen.queryByRole("slider", { name: "Playback position" })).toBeNull();
});


test("video opens Audio & subtitles directly and restores the initiating control", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const trigger = screen.getByRole("button", { name: "Audio & subtitles" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Audio & subtitles");
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(trigger);
});

test.each([true, false])("Up next stays open when playback changes (Play action: %s)", async playNow => {
  const { PlayerPage } = await import("./PlayerPage");
  const next = { id: "next", title: "Next movie", source: "library:next", duration: 120 };
  const after = { id: "after", title: "After that", source: "library:after", duration: 120 };
  const queued = { ...shell, state: { ...state, queue: [...state.queue, next, after] } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={queued}><PlayerPage /></ShellProviders>));
  await userEvent.click(screen.getByRole("button", { name: "Up next" }));
  const queue = document.querySelector<HTMLElement>("[data-queue-panel]")!;
  if (playNow) {
    await userEvent.click(within(queue).getByRole("button", { name: "Play Next movie" }));
    expect(actions).toContainEqual({ type: "play", entryId: "next" });
  }
  const advanced = { ...queued, current: next, state: { ...state, queue: [...state.queue, next, after], currentEntryId: next.id, player: { ...state.player, playbackId: "next-playback" } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={advanced}><PlayerPage /></ShellProviders>));
  expect(queue.isConnected).toBe(true);
  expect(within(queue).getByRole("button", { name: "Play After that" })).toBeInTheDocument();
});


test("a direct queue request keeps transport available and Escape closes the queue first", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const changes: boolean[] = [];
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage queueOpen onQueueOpenChange={open => changes.push(open)} /></ShellProviders>));
  expect(screen.getByRole("complementary", { name: "Up next" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(changes).toEqual([false]);
  expect(leaves).toBe(0);
});

test("returning from the persistent queue focuses transport when its trigger is hidden", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const changes: boolean[] = [];
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage queueOpen onQueueOpenChange={open => changes.push(open)} /></ShellProviders>));
  spyOn(screen.getByRole("button", { name: "Up next" }), "getClientRects").mockReturnValue([] as unknown as DOMRectList);
  await userEvent.click(screen.getByRole("button", { name: "Back to player" }));
  expect(changes).toEqual([false]);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Pause");
});

test("playback changes close track settings while keeping the queue open", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => view.rerender(<ShellProviders value={shell}><PlayerPage queueOpen /></ShellProviders>));
  await userEvent.click(screen.getByRole("button", { name: "Audio & subtitles" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Audio & subtitles");
  const changed = { ...shell, state: { ...state, player: { ...state.player, playbackId: "another-playback" } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={changed}><PlayerPage queueOpen /></ShellProviders>));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("complementary", { name: "Up next" })).toBeInTheDocument();
});

test("stopping preserves the open queue and its management context", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const next = { id: "next", title: "Next movie", source: "library:next", duration: 120 };
  const queued = { ...shell, state: { ...state, queue: [...state.queue, next] } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={queued}><PlayerPage queueOpen /></ShellProviders>));
  const queue = document.querySelector<HTMLElement>("[data-queue-panel]")!;
  const idle = { ...queued, current: undefined, active: false, state: { ...state, queue: [...state.queue, next], currentEntryId: null, queueCursorEntryId: "current", player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={idle}><PlayerPage queueOpen /></ShellProviders>));
  expect(queue.isConnected).toBe(true);
  expect(within(queue).getByRole("button", { name: "Play Next movie" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(document.querySelector("[data-back]")).toBeInTheDocument();
  await act(async () => view.rerender(<ShellProviders value={queued}><PlayerPage queueOpen /></ShellProviders>));
  expect(queue.isConnected).toBe(true);
  expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
});

test("finished audio keeps artwork and title and offers Replay without enabling seek", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const current = { ...state.queue[0]!, title: "Final track", thumbnail: "https://images.example/album.jpg" };
  const finished = { ...shell, active: false, current, state: { ...state, queue: [current], player: { ...state.player, status: "ended", position: 100, tracks: [{ id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }] } } };
  await act(async () => view.rerender(<ShellProviders value={finished}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("heading", { name: "Final track", level: 1 })).toBeInTheDocument();
  expect(document.querySelector('[data-player-art] img[src="https://images.example/album.jpg"]')).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Finished" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Playback position" })).toHaveAttribute("data-disabled");
  expect(screen.getByRole("button", { name: "Back 10 seconds" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Replay" }));
  expect(actions).toEqual([{ type: "play", entryId: current.id, fromStart: true }]);
});

test.each([false, true])("ended video explains completion or a pending next item (pending: %s)", async pending => {
  const { PlayerPage } = await import("./PlayerPage");
  const finished = { ...shell, active: false, state: { ...state, player: { ...state.player, status: "ended" }, autoplay: { enabled: true, contextTitle: "Series", next: null, pending } } };
  await act(async () => view.rerender(<ShellProviders value={finished}><PlayerPage queueOpen /></ShellProviders>));
  expect(screen.getByRole("heading", { name: pending ? "Finding the next item…" : "Finished Evening movie", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  expect(screen.queryByRole("region", { name: "Playing" })).toBeNull();
});

test("ended video can advance to its known Autoplay item without enabling seeking", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const finished = { ...shell, active: false, state: { ...state, player: { ...state.player, status: "ended" }, autoplay: { enabled: true, contextTitle: "Series", next: { id: "next", title: "Episode 8", source: "library:next" } } } };
  await act(async () => view.rerender(<ShellProviders value={finished as unknown as ShellValue}><PlayerPage /></ShellProviders>));
  expect(screen.getByRole("slider", { name: "Playback position" })).toHaveAttribute("data-disabled");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(actions).toEqual([{ type: "next", playbackId: "playback" }]);
});

test("video details show the episode synopsis and open all seasons through app navigation", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const opened: unknown[] = [];
  const collection = { title: "MasterChef Italia - Season 11", url: "https://streamingcommunityz.photos/it/titles/1955-masterchef-italia/season-11" };
  const current = { ...state.queue[0]!, subtitle: "MasterChef Italia", description: "The cooks prepare their first mystery box.", collection };
  const detailed = { ...shell, current, openProvider: (item: unknown) => opened.push(item), state: { ...state, queue: [current] } };
  await act(async () => view.rerender(<ShellProviders value={detailed as unknown as ShellValue}><PlayerPage /></ShellProviders>));
  expect(screen.getByText("MasterChef Italia")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Details" }));
  const details = screen.getByRole("dialog", { name: "Details" });
  expect(details).toHaveTextContent(current.description);
  expect(details).toHaveTextContent(current.subtitle);
  await userEvent.click(within(details).getByRole("button", { name: `Browse ${collection.title}` }));
  const showUrl = "https://streamingcommunityz.photos/it/titles/1955-masterchef-italia";
  expect(opened).toEqual([{ id: showUrl, url: showUrl, title: collection.title, provider: "streamingcommunity", kind: "collection" }]);
  expect(actions).toEqual([]);
});
