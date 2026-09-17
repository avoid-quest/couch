import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
let RangeControl: typeof import("./RangeControl")["RangeControl"];
let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
const requests: { value: number; resolve: (accepted?: boolean) => void; reject: (error: Error) => void }[] = [];
const commit = (value: number) => new Promise<boolean>((resolve, reject) => requests.push({ value, resolve: (accepted = true) => resolve(accepted), reject }));
const render = async (value = 12.38, { disabled = false, playbackId = "first", volume = false } = {}) => act(async () => root.render(<RangeControl key={playbackId} label={volume ? "Volume" : "Playback position"} value={value} max={volume ? 100 : 60} disabled={disabled} onCommit={commit} showValue={volume} />));
const slider = () => document.querySelector<HTMLElement>('[role="slider"]')!;
const key = async (key: string) => act(async () => { slider().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); slider().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })); });
beforeEach(async () => {
  requests.length = 0; window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "Element", "Node", "MutationObserver", "ResizeObserver", "Event", "KeyboardEvent", "PointerEvent", "MouseEvent", "CustomEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  const { createRoot } = await import("react-dom/client");
  ({ RangeControl } = await import("./RangeControl"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("Home followed by four arrows seeks to four while player observations lag acknowledgements", async () => {
  await render();
  await key("Home");
  await act(async () => requests[0]!.resolve());
  for (let i = 0; i < 4; i++) { await key("ArrowRight"); await act(async () => requests.at(-1)!.resolve()); }
  expect(requests.map(request => request.value)).toEqual([0, 1, 2, 3, 4]);
  expect(slider().getAttribute("aria-valuenow")).toBe("4");
});

test("an old acknowledgement does not discard a newer keyboard edit", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests[0]!.resolve());
  await key("ArrowRight");
  expect(requests.map(request => request.value)).toEqual([0, 1, 2]);
});

test("authoritative observations continue after leaving the keyboard edit", async () => {
  await render();
  await key("Home");
  await render(0.02);
  await act(async () => slider().blur());
  await render(1.25);
  expect(slider().getAttribute("aria-valuenow")).toBe("1.25");
});

const pointer = async (type: string, clientX: number) => act(async () => {
  const element = document.querySelector<HTMLElement>('[data-slot="slider"]')!;
  element.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  element.setPointerCapture = () => {};
  element.hasPointerCapture = () => true;
  element.releasePointerCapture = () => {};
  element.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
});

test("pointer volume commits on release and returns to the observed level after acknowledgement", async () => {
  await render(50, { volume: true });
  await pointer("pointerdown", 20);
  await pointer("pointermove", 30);
  expect(requests).toHaveLength(0);
  expect(slider().getAttribute("aria-valuenow")).toBe("30");
  await pointer("pointerup", 30);
  expect(requests.map(request => request.value)).toEqual([30]);
  await render(30, { volume: true });
  await act(async () => requests[0]!.resolve());
  await render(45, { volume: true });
  expect(slider().getAttribute("aria-valuenow")).toBe("45");
});

test("an older pointer acknowledgement cannot discard the next drag", async () => {
  await render(50, { volume: true });
  await pointer("pointerdown", 20);
  await pointer("pointerup", 20);
  await pointer("pointerdown", 30);
  await act(async () => requests[0]!.resolve());
  expect(slider().getAttribute("aria-valuenow")).toBe("30");
  await pointer("pointerup", 30);
  expect(requests.map(request => request.value)).toEqual([20, 30]);
});

test("cancel and disconnect discard drafts without another command", async () => {
  await render();
  await key("Home");
  await pointer("pointercancel", 0);
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("Home");
  await render(12.38, { disabled: true });
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("ArrowRight");
  expect(requests.map(request => request.value)).toEqual([0, 0]);
});

test("a new playback identity discards the old draft and acknowledgement", async () => {
  await render();
  await key("Home");
  await render(24, { playbackId: "second" });
  await key("ArrowRight");
  await act(async () => requests[0]!.resolve());
  expect(requests.map(request => request.value)).toEqual([0, 25]);
  expect(slider().getAttribute("aria-valuenow")).toBe("25");
});


test("failed commands release the draft, but old rejections preserve newer edits", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests[0]!.reject(new Error("Old command rejected")));
  expect(slider().getAttribute("aria-valuenow")).toBe("1");
  await act(async () => requests[1]!.resolve(false));
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
  await key("Home");
  await act(async () => requests[2]!.reject(new Error("Connection lost")));
  expect(slider().getAttribute("aria-valuenow")).toBe("12.38");
});

test("late playback observations do not interrupt a focused keyboard edit", async () => {
  await render();
  await key("Home");
  await key("ArrowRight");
  await act(async () => requests.forEach(request => request.resolve()));
  await render(0.02);
  await key("ArrowRight");
  await render(1.02);
  expect(requests.map(request => request.value)).toEqual([0, 1, 2]);
  expect(slider().getAttribute("aria-valuenow")).toBe("2");
  await act(async () => slider().blur());
  expect(slider().getAttribute("aria-valuenow")).toBe("1.02");
});
