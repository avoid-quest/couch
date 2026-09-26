import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Action, SessionState } from "../../../shared/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

let root: Root, window: Window, QueuePanel: typeof import("./QueuePanel").QueuePanel;
const originals = new Map<string, PropertyDescriptor | undefined>();
const actions: Action[] = [];
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
const flush = () => act(async () => { await Bun.sleep(15); });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const press = async (node: HTMLElement) => {
  await act(async () => node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
  await act(async () => node.click());
  await flush();
};

beforeEach(async () => {
  actions.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  ({ QueuePanel } = await import("./QueuePanel"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><QueuePanel state={state} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async action => { actions.push(action); return true; }} /></QueryClientProvider>));
  await flush();
});
afterEach(async () => { queryClient.clear();
  await act(async () => root.unmount());
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("a queue entry removes itself through the socket remove action", async () => {
  expect(actions).toEqual([]);
  await press(document.querySelector<HTMLElement>('[data-queue-entry-id="two"] [data-slot=item-actions] > button:last-child')!);
  expect(actions).toEqual([{ type: "remove", entryId: "two" }]);
});
