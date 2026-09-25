import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";

let root: Root, window: Window, QueuePanel: typeof import("./QueuePanel").QueuePanel;
const originals = new Map<string, PropertyDescriptor | undefined>();
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
const render = (value: SessionState) => act(async () => root.render(<QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} />));
const play = (id: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Play ${id}"]`)!;

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  ({ QueuePanel } = await import("./QueuePanel"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render(state);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("focus follows an upcoming item when it becomes played", async () => {
  await act(async () => play("two").focus());
  await render({ ...state, currentEntryId: "two", queueCursorEntryId: "two" });
  expect(document.activeElement).toBe(play("three"));
  await render({ ...state, currentEntryId: "three", queueCursorEntryId: "three" });
  expect(document.activeElement).toBe(play("two"));
});
