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
  await act(async () => root.render(<SessionBar state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} onOpen={() => browsed.push("Home")} run={command ?? (async action => { actions.push(action); return true; })} />));
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
  for (const label of ["Pause playback", "Next in queue", "Stop playback"]) await act(async () => button(label).click());
  expect(browsed).toEqual(["Home"]);
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: true }, { type: "next", playbackId: "playback" }, { type: "stop" }]);
});
test("loading allows Stop, offline disables commands, and the final entry omits Next", async () => {
  await render({ ...state, player: { ...state.player, status: "loading" } });
  expect(button("Resume playback").disabled).toBe(true);
  expect(button("Next in queue").disabled).toBe(true);
  expect(button("Stop playback").disabled).toBe(false);
  await render(state, false);
  for (const label of ["Pause playback", "Next in queue", "Stop playback"]) { expect(button(label).disabled).toBe(true); await act(async () => button(label).click()); }
  expect(actions).toEqual([]);
  await render({ ...state, queue: [state.queue[1]!] });
  expect(button("Next in queue")).toBeUndefined();
});
test("live playback can pause and stop without seek controls, and idle hides the footer", async () => {
  await render({ ...state, queue: [{ ...state.queue[1]!, live: true, kind: "radio" }], player: { ...state.player, status: "paused", seekable: false } });
  await act(async () => button("Resume playback").click());
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: false }]);
  expect(document.querySelector('[aria-label^="Seek"]')).toBeNull();
  await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(document.querySelector("footer")).toBeNull();
});
