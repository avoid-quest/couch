import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Action, SessionState } from "../shared/protocol";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const actions: Action[] = [], browsed: string[] = [];
const state: SessionState = {
  queue: ["past", "current", "next"].map(id => ({ id, title: id, source: `library:${id}` })), currentEntryId: "current", queueCursorEntryId: "current",
  activeProfile: { id: "household", name: "Household" },
  preferences: { profile: { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1, replayGain: "off" }, device: { audioDelay: 0 } },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 30, seekable: true, error: null },
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent?.trim() === label)!;
async function render(value = state, connected = true, active = true, command?: (action: Action) => Promise<boolean>) {
  const { SessionBar } = await import("./SessionBar");
  await act(async () => root.render(active ? <SessionBar state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} onOpen={() => browsed.push("Home")} onRemote={() => browsed.push("Remote")} run={command ?? (async action => { actions.push(action); return true; })} /> : null));
}
beforeEach(async () => {
  actions.length = 0; browsed.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ profile: state.activeProfile, items: [] })) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("compact footer sends the current transport commands and opens the session", async () => {
  await render();
  await act(async () => button("Open current playback: current").click());
  for (const label of ["Pause", "Next in queue", "Stop playback"]) await act(async () => button(label).click());
  await act(async () => button("Remote").click());
  expect(browsed).toEqual(["Home", "Remote"]);
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: true }, { type: "next", playbackId: "playback" }, { type: "stop" }]);
});
test("loading allows Stop, offline disables commands, and the final entry omits Next", async () => {
  await render({ ...state, player: { ...state.player, status: "loading" } });
  expect(button("Resume").disabled).toBe(true);
  expect(button("Next in queue").disabled).toBe(true);
  expect(button("Stop playback").disabled).toBe(false);
  await render(state, false);
  for (const label of ["Pause", "Next in queue", "Stop playback"]) { expect(button(label).disabled).toBe(true); await act(async () => button(label).click()); }
  expect(actions).toEqual([]);
  await render({ ...state, queue: [state.queue[1]!] });
  expect(button("Next in queue")).toBeUndefined();
});
test("live playback can pause and stop without seek controls, and idle hides the footer", async () => {
  await render({ ...state, queue: [{ ...state.queue[1]!, live: true, kind: "radio" }], player: { ...state.player, status: "paused", seekable: false } });
  await act(async () => button("Resume").click());
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: false }]);
  expect(document.querySelector('[aria-label^="Seek"]')).toBeNull();
  await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(document.querySelector("footer")).toBeNull();
});

test("Next disappearing restores an available transport and loading falls back to Stop", async () => {
  await render();
  button("Next in queue").focus();
  await render({ ...state, queue: [state.queue[1]!] });
  expect(document.activeElement === button("Pause")).toBe(true);
  await render({ ...state, queue: [state.queue[1]!], player: { ...state.player, status: "loading" } });
  expect(document.activeElement === button("Stop playback")).toBe(true);
});

test("removing the focused footer returns to the active page without navigating or stealing focus", async () => {
  const nav = document.createElement("nav");
  nav.className = "primary-nav";
  nav.innerHTML = '<a href="/search?q=album" aria-current="page">Search</a><a href="/saved">Saved</a>';
  document.body.append(nav);
  const search = nav.querySelector<HTMLAnchorElement>("a")!;
  const saved = nav.querySelector<HTMLAnchorElement>('a[href="/saved"]')!;
  const frame = () => act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  for (const removeComponent of [false, true]) {
    await render();
    button("Stop playback").focus();
    await act(async () => button("Stop playback").click());
    await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } }, true, !removeComponent);
    await frame();
    expect(document.activeElement === search).toBe(true);
    expect(window.location.pathname).toBe("/");
  }
  await render();
  button("Next in queue").focus();
  saved.focus();
  await render({ ...state, queue: [state.queue[1]!] });
  expect(document.activeElement === saved).toBe(true);
  await render(state, true, false);
  await frame();
  expect(document.activeElement === saved).toBe(true);
  await render();
  button("Stop playback").focus();
  await render(state, true, false);
  saved.focus();
  await frame();
  expect(document.activeElement === saved).toBe(true);
});

test("footer volume uses the observed output and keeps keyboard edits through live updates", async () => {
  const systemAudio = { selectedOutput: "hdmi", observedOutput: "hdmi", volume: 30, muted: false, error: null };
  await render({ ...state, systemAudio });
  await act(async () => button("Mute TV").click());
  expect(actions).toEqual([{ type: "mute", muted: true }]);
  const slider = document.querySelector<HTMLElement>('[role="slider"][aria-label="Volume"]')!;
  slider.focus();
  await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(actions.at(-1)).toEqual({ type: "volume", volume: 31 });
  await render({ ...state, systemAudio, player: { ...state.player, position: 13, volume: 30 } });
  expect(document.activeElement === slider).toBe(true);
  expect(slider.getAttribute("aria-valuenow")).toBe("31");
  await act(async () => button("Pause").focus());
  expect(slider.getAttribute("aria-valuenow")).toBe("30");
  await render({ ...state, systemAudio: { ...systemAudio, muted: true } });
  await act(async () => button("Unmute TV").click());
  expect(actions.at(-1)).toEqual({ type: "mute", muted: false });
  await render({ ...state, systemAudio: { ...systemAudio, volume: null } });
  expect(button("Mute TV").disabled).toBe(true);
  expect(document.querySelector('.session-bar-volume [data-slot="slider"]')?.hasAttribute("data-disabled")).toBe(true);
  await render(state);
  expect(button("Mute TV")).toBeUndefined();
  expect(document.querySelector('.session-bar-volume [data-slot="slider"]')?.hasAttribute("data-disabled")).toBe(false);
});

test("footer seek clamps to the item and current quality is available in its gear", async () => {
  await render({ ...state, player: { ...state.player, position: 4 } });
  await act(async () => button("Seek backward 10 seconds").click());
  await render({ ...state, player: { ...state.player, position: 98 } });
  await act(async () => button("Seek forward 10 seconds").click());
  expect(actions).toEqual([{ type: "seek", playbackId: "playback", position: 0 }, { type: "seek", playbackId: "playback", position: 100 }]);
  await render({ ...state, queue: [{ ...state.queue[1]!, source: "web:https://www.youtube.com/watch?v=abc", quality: "auto" }], player: { ...state.player, tracks: [{ id: "1", index: 0, kind: "video", label: "Video", language: "", selected: true }] } });
  await act(async () => button("Playback settings").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Quality");
});

test("footer timeline shows current time and preserves a focused seek through live observations", async () => {
  await render();
  const position = document.querySelector<HTMLElement>('[role="slider"][aria-label="Playback position"]')!;
  expect(document.querySelector('.playback-timeline .time-labels')?.textContent).toBe("0:121:40");
  position.focus();
  await act(async () => position.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(actions.at(-1)).toEqual({ type: "seek", playbackId: "playback", position: 13 });
  await render({ ...state, player: { ...state.player, position: 14 } });
  expect(document.activeElement === position).toBe(true);
  expect(position.getAttribute("aria-valuenow")).toBe("13");
  await act(async () => button("Pause").focus());
  expect(position.getAttribute("aria-valuenow")).toBe("14");
  expect(document.querySelector('.playback-timeline .time-labels')?.textContent).toBe("0:141:40");
  await render({ ...state, queue: [{ ...state.queue[1]!, live: true }], player: { ...state.player, seekable: false } });
  expect(document.querySelector('.playback-timeline')).toBeNull();
  await render({ ...state, player: { ...state.player, duration: null } });
  expect(document.querySelector('.playback-timeline [role="slider"]')).toBeNull();
  expect(document.querySelector('.playback-timeline .time-labels')?.textContent).toBe("0:12");
});
