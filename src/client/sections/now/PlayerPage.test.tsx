import { afterEach, beforeEach, expect, test } from "bun:test";
import { ShellProviders } from "../shell/test-providers";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import type { ShellValue } from "../shell/AppShell";

let root: Root;
let window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
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
  window = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "MutationObserver", "ResizeObserver", "Event", "KeyboardEvent", "PointerEvent", "MouseEvent", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("player keys leave focused buttons outside the player available", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const outside = document.createElement("button"); outside.textContent = "Undo"; document.body.append(outside);
  await act(async () => root.render(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  outside.focus();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  outside.dispatchEvent(enter);
  const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  outside.dispatchEvent(space);
  expect(enter.defaultPrevented).toBe(false);
  expect(space.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(outside);
  expect(actions).toEqual([]);
  expect(document.querySelector('[role="slider"][aria-label="Volume"]')).toBeNull();
  expect(document.querySelector('[role="group"][aria-label="Couch volume"]')?.textContent).toContain("40%");
});

test("Escape leaves an open overlay to close itself before leaving the player", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => root.render(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("data-state", "open"); document.body.append(dialog);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(leaves).toBe(0);
  dialog.remove();
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(leaves).toBe(1);
});

test("Escape closes the player sheet before leaving the player", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => root.render(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-panel="settings"]')!.click());
  expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeNull();
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
  expect(leaves).toBe(0);
});

test("keyboard commands use the latest session callbacks", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => root.render(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  const latest: unknown[] = [];
  const changed = { ...shell, credentials: { origin: "http://another-host", token: "new" }, run: async (action: unknown) => { latest.push(action); return true; } } as unknown as ShellValue;
  await act(async () => root.render(<ShellProviders value={changed}><PlayerPage /></ShellProviders>));
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  expect(actions).toEqual([]);
  expect(latest).toEqual([{ type: "pause", playbackId: "playback", paused: true }]);
});

test("chapters mark the timeline and name the current chapter", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const chapters = [{ title: "Opening", position: 0 }, { title: "The meeting", position: 10 }, { title: "Finale", position: 80 }];
  const withChapters = { ...shell, state: { ...state, player: { ...state.player, position: 12, chapters } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={withChapters}><PlayerPage /></ShellProviders>));
  expect(document.querySelectorAll("[data-chapter-tick]")).toHaveLength(2);
  expect(document.querySelector("[data-time-labels]")?.textContent).toContain("The meeting");
});

test("an error offers Skip even at the end of Up next", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const errored = { ...shell, state: { ...state, player: { ...state.player, status: "error" as const, error: "The video could not be loaded." } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={errored}><PlayerPage /></ShellProviders>));
  const skip = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Skip")!;
  expect(skip.disabled).toBe(false);
  await act(async () => skip.click());
  expect(actions).toEqual([{ type: "next", playbackId: "playback" }]);
  expect(document.querySelector("[data-player-status] h2")).not.toBeNull();
});

test("loading and buffering are spinner status lines", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const loading = { ...shell, state: { ...state, player: { ...state.player, status: "loading" as const } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={loading}><PlayerPage /></ShellProviders>));
  expect(document.querySelector("[data-player-status]")?.textContent).toContain("Loading Evening movie");
  const buffering = { ...loading, state: { ...(loading as unknown as { state: SessionState }).state, player: { ...(loading as unknown as { state: SessionState }).state.player, buffering: true } } } as unknown as ShellValue;
  await act(async () => root.render(<ShellProviders value={buffering}><PlayerPage /></ShellProviders>));
  expect(document.querySelector("[data-player-status]")).toBeNull();
  expect([...document.querySelectorAll('[role="status"]')].some(node => node.textContent === "Buffering…")).toBe(true);
});

test("an idle player renders nothing; the shell returns to Home, which shows Up next", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const idle = { ...shell, active: false, current: undefined, state: { ...state, queue: [state.queue[0]!, { id: "next", title: "Next movie", source: "library:movie", duration: 120 }], currentEntryId: null, queueCursorEntryId: "current", player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={idle}><PlayerPage /></ShellProviders>));
  expect(document.querySelector('[data-page="Now"]')).toBeNull();
});

test("a sheet does not reopen when playback ends and a new item starts", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  await act(async () => root.render(<ShellProviders value={shell}><PlayerPage /></ShellProviders>));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-panel="queue"]')!.click());
  expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeNull();
  const idle = { ...shell, active: false, current: undefined, state: { ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" as const } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={idle}><PlayerPage /></ShellProviders>));
  const next = { ...shell, current: { ...state.queue[0]!, id: "next", title: "Next movie" }, state: { ...state, currentEntryId: "next", queue: [{ ...state.queue[0]!, id: "next", title: "Next movie" }], player: { ...state.player, playbackId: "next-playback" } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={next}><PlayerPage /></ShellProviders>));
  expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
});

test("the player heading uses available artist, source, and starter metadata", async () => {
  const { PlayerPage } = await import("./PlayerPage");
  const attributed = { ...shell, state: { ...state, playedBy: { deviceId: "phone", name: "Kitchen phone" }, player: { ...state.player, nowPlaying: { title: "Evening movie", artist: "Known artist" } } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={attributed}><PlayerPage /></ShellProviders>));
  expect(document.querySelector("[data-player-heading] > span")?.textContent).toMatch(/^Known artist · .+ · played from Kitchen phone$/);
  const unattributed = { ...shell, state: { ...state, playedBy: undefined, player: { ...state.player, nowPlaying: null } } } as ShellValue;
  await act(async () => root.render(<ShellProviders value={unattributed}><PlayerPage /></ShellProviders>));
  expect(document.querySelector("[data-player-heading] > span")?.textContent).not.toContain("·");
});
