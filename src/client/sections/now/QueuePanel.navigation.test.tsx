import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import { applyTvNavigation } from "../../navigation";

let root: Root, window: Window, QueuePanel: typeof import("./QueuePanel").QueuePanel;
let closeCount = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
const render = (value: SessionState) => act(async () => root.render(<div className="player-sheet" role="dialog"><button onClick={() => closeCount++}>Close</button><QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} /></div>));
const play = (id: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Play ${id}"]`)!;

beforeEach(async () => {
  closeCount = 0;
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

test("removing the focused last upcoming row restores Close for D-pad selection", async () => {
  const lastUpcoming = { ...state, queue: queue.slice(0, 2) };
  await render(lastUpcoming);
  await act(async () => document.querySelector<HTMLElement>('[data-queue-entry-id="two"] .queue-row-actions > button:last-child')!.focus());
  await render({ ...lastUpcoming, queue: queue.slice(0, 1) });
  const close = document.querySelector<HTMLButtonElement>(".player-sheet > button")!;
  expect(document.activeElement).toBe(close);
  close.getClientRects = () => [close.getBoundingClientRect()] as unknown as DOMRectList;
  document.querySelector<HTMLElement>(".player-sheet")!.getClientRects = close.getClientRects;
  await act(async () => { applyTvNavigation("select"); });
  expect(closeCount).toBe(1);
});

test("removing the focused last upcoming row restores Find on the idle page", async () => {
  const idle = { ...state, currentEntryId: null, queueCursorEntryId: null, queue: queue.slice(1, 2) };
  const renderIdle = (value: SessionState) => act(async () => root.render(<section className="player-idle" data-page="Now"><button data-page-first onClick={() => closeCount++}>Find something to play</button><QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} /></section>));
  await renderIdle(idle);
  await act(async () => document.querySelector<HTMLElement>('[data-queue-entry-id="two"] .queue-row-actions > button:last-child')!.focus());
  await renderIdle({ ...idle, queue: [] });
  const find = document.querySelector<HTMLButtonElement>("[data-page-first]")!;
  expect(document.activeElement === find).toBe(true);
  find.getClientRects = () => [find.getBoundingClientRect()] as unknown as DOMRectList;
  await act(async () => { applyTvNavigation("select"); });
  expect(closeCount).toBe(1);
});
