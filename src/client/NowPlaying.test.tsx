import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Action, SessionState } from "../shared/protocol";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
const actions: Action[] = [], browsed: string[] = [];
const state: SessionState = {
  queue: ["past", "current", "next", "last"].map(id => ({ id, title: id, source: `library:${id}` })), currentEntryId: "current", queueCursorEntryId: "current", installationName: "Living room",
  activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 30, seekable: true, error: null },
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent?.trim() === label)!;
async function render(value = state, connected = true, active = true) {
  const { NowPlaying } = await import("./NowPlaying");
  await act(async () => root.render(<NowPlaying state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} active={active} onBack={() => browsed.push("Back")} onBrowse={section => browsed.push(section)} run={async action => { actions.push(action); return true; }} />));
}
beforeEach(async () => {
  actions.length = 0; browsed.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
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

test("expanded playback opens on Back, exposes current controls and returns without a playback command", async () => {
  await render();
  expect(document.activeElement === button("Back to browsing")).toBe(true);
  expect(document.querySelector(".session-current")?.textContent).toContain("Now playing · Living room");
  expect(document.querySelector('[role="slider"][aria-label="Volume"]')).not.toBeNull();
  expect(document.querySelector('[role="slider"][aria-label="Playback position"]')).not.toBeNull();
  await act(async () => button("Pause").click());
  await act(async () => button("Back to browsing").click());
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: true }]);
  expect(browsed).toEqual(["Back"]);
});

test("upcoming queue uses the installation cursor and sends direct play and remove commands", async () => {
  await render();
  expect([...document.querySelectorAll(".session-next-copy strong")].map(node => node.textContent)).toEqual(["next", "last"]);
  await act(async () => button("Play next").click());
  await act(async () => button("Remove last from Up next").click());
  await act(async () => button("Manage queue").click());
  expect(actions).toEqual([{ type: "play", entryId: "next" }, { type: "remove", entryId: "last" }]);
  expect(browsed).toEqual(["Queue"]);
  expect(state.queue.map(entry => entry.id)).toEqual(["past", "current", "next", "last"]);
});

test("queue removal and playback replacement preserve usable focus", async () => {
  await render();
  button("Remove next from Up next").focus();
  await render({ ...state, queue: state.queue.filter(entry => entry.id !== "next") });
  expect(document.activeElement === button("Play last")).toBe(true);
  button("Play last").focus();
  await render({ ...state, currentEntryId: "last", queueCursorEntryId: "last" });
  expect(document.activeElement === button("Pause")).toBe(true);
  expect(document.querySelector(".now-playing-queue-empty")?.textContent).toContain("Nothing queued");
  await render({ ...state, currentEntryId: null, player: { ...state.player, status: "idle", playbackId: null } });
  expect(document.activeElement === button("Back to browsing")).toBe(true);
  expect(document.querySelector("h1")?.textContent).toBe("Nothing playing");
  expect(document.querySelector(".transport-buttons")).toBeNull();
  expect([...document.querySelectorAll(".session-next-copy strong")].map(node => node.textContent)).toEqual(["next", "last"]);
});

test("disconnected playback preserves its queue while disabling mutation", async () => {
  await render(state, false);
  for (const label of ["Pause", "Stop playback", "Play next", "Remove next from Up next"]) {
    expect(button(label).disabled).toBe(true);
    await act(async () => button(label).click());
  }
  expect(actions).toEqual([]);
  expect(button("Back to browsing").disabled).toBe(false);
  expect(document.querySelector(".session-current")?.textContent).toContain("Reconnecting");
});

test("programme details stay tied to the current playback and live controls omit pause and timeline", async () => {
  const radio: SessionState = { ...state, queue: [{ ...state.queue[1]!, source: "radio:one", kind: "radio", live: true }, state.queue[2]!], player: { ...state.player, seekable: false }, radioProgramme: { playbackId: "playback", stationId: "one", provider: "radio.avoid.quest", title: "Evening programme", description: "A programme from the station.", programmeUrl: "https://radio.avoid.quest/", sampledAt: 1000, expiresAt: 901000 } };
  await render(radio);
  expect(document.querySelector(".radio-programme")?.textContent).toContain("A programme from the station.");
  expect(document.querySelector(".radio-programme a")?.getAttribute("href")).toBe("https://radio.avoid.quest/");
  expect(button("Pause")).toBeUndefined();
  expect(button("Stop playback").disabled).toBe(false);
  expect(button("Next in queue").disabled).toBe(false);
  expect(document.querySelector('[aria-label="Playback position"]')).toBeNull();
  await render({ ...radio, radioProgramme: { ...radio.radioProgramme!, playbackId: "previous" } });
  expect(document.querySelector(".radio-programme")).toBeNull();
});

test("hidden Now playing does not take focus when its queue changes", async () => {
  await render();
  button("Remove next from Up next").focus();
  const search = document.createElement("input"); document.body.append(search); search.focus();
  await render({ ...state, queue: state.queue.filter(entry => entry.id !== "next") }, true, false);
  expect(document.activeElement === search).toBe(true);
});
