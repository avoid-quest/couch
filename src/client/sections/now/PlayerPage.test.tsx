import { setupUiTests, render as renderUI, act, screen, userEvent, testWindow } from "@/testing/react";
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
  expect(screen.getByRole("group", { name: "Couch volume" }).textContent).toContain("40%");
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
  expect(screen.getByRole("status")).toHaveTextContent("Buffering…");
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
  await userEvent.click(screen.getByRole("button", { name: /^Up next/ }));
  expect(screen.queryByRole("dialog")).not.toBeNull();
  const idle = { ...shell, active: false, current: undefined, state: { ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={idle}><PlayerPage /></ShellProviders>));
  const next = { ...shell, current: { ...state.queue[0]!, id: "next", title: "Next movie" }, state: { ...state, currentEntryId: "next", queue: [{ ...state.queue[0]!, id: "next", title: "Next movie" }], player: { ...state.player, playbackId: "next-playback" } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={next}><PlayerPage /></ShellProviders>));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the player heading uses available artist, source, and starter metadata", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const attributed = { ...shell, state: { ...state, playedBy: { deviceId: "phone", name: "Kitchen phone" }, player: { ...state.player, nowPlaying: { title: "Evening movie", artist: "Known artist" } } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={attributed}><PlayerPage /></ShellProviders>));
  expect(screen.getByText(/^Known artist · .+ · played from Kitchen phone$/)).toBeInTheDocument();
  const unattributed = { ...shell, state: { ...state, playedBy: undefined, player: { ...state.player, nowPlaying: null } } } as ShellValue;
  await act(async () => view.rerender(<ShellProviders value={unattributed}><PlayerPage /></ShellProviders>));
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
  expect(screen.getByText("Detroit House")).toBeVisible();
  expect(screen.getByText("Broken beat and soul.")).toBeVisible();
  expect(screen.getByText("Allysha Joy · Live session · 320 kbps")).toBeVisible();
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
  expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: false });
  await act(async () => view.unmount());
  expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: true });
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
