import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SessionState } from "../../../shared/protocol";
import { applyTvNavigation, useNavigation } from "../../navigation";

let root: Root, window: Window, QueuePanel: typeof import("./QueuePanel").QueuePanel;
const originals = new Map<string, PropertyDescriptor | undefined>();
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
function Screen({ value, editing = true }: { value: SessionState; editing?: boolean }) {
  useNavigation(() => {});
  return <QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" editing={editing} run={async () => true} />;
}
const render = (value: SessionState, editing?: boolean) => act(async () => root.render(<Screen value={value} editing={editing} />));
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

const measureRows = () => {
  const summary = document.querySelector<HTMLElement>("summary")!;
  const controls = [...document.querySelectorAll<HTMLElement>("button, summary")];
  for (const [index, element] of controls.entries()) {
    const rect = { x: 0, y: index * 50, width: 100, height: 40, top: index * 50, left: 0, right: 100, bottom: index * 50 + 40, toJSON() {} };
    element.getBoundingClientRect = () => rect;
    element.getClientRects = () => (element.closest("details:not([open])") && element !== summary ? [] : [rect]) as unknown as DOMRectList;
    element.scrollIntoView = () => {};
  }
  return summary;
};

test("in edit mode directional TV controls reach the reorder handle and open Previously queued", async () => {
  await render({ ...state, currentEntryId: "two", queueCursorEntryId: "two" });
  const summary = measureRows();
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Queue options for three"]')!.focus(); applyTvNavigation("down"); });
  // The row's reorder handle sits in the TV focus order before the disclosure.
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Reorder three");
  await act(async () => { applyTvNavigation("down"); });
  expect(document.activeElement).toBe(summary);
  await act(async () => { applyTvNavigation("select"); });
  expect(document.querySelector("details")?.open).toBe(true);
});

test("outside edit mode directional TV controls skip the hidden reorder handle", async () => {
  await render({ ...state, currentEntryId: "two", queueCursorEntryId: "two" }, false);
  const summary = measureRows();
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Queue options for three"]')!.focus(); applyTvNavigation("down"); });
  expect(document.activeElement).toBe(summary);
  await act(async () => { applyTvNavigation("select"); });
  expect(document.querySelector("details")?.open).toBe(true);
});

test("focus follows a played or replayed row and returns to the disclosure when it becomes previous", async () => {
  await act(async () => play("two").focus());
  await render({ ...state, currentEntryId: "two", queueCursorEntryId: "two" });
  expect(document.activeElement).toBe(play("two"));
  await render({ ...state, currentEntryId: "three", queueCursorEntryId: "three" });
  expect(document.activeElement).toBe(document.querySelector("summary"));
  document.querySelector("details")!.open = true;
  await act(async () => play("one").focus());
  await render(state);
  expect(document.activeElement).toBe(play("one"));
});
