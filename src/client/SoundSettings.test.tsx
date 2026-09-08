import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { SoundState } from "../shared/sound";
let SoundSettings: typeof import("./SoundSettings")["SoundSettings"];
let root: Root, window: Window, request: ReturnType<typeof spyOn>, state: SoundState;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { url: string; body: unknown }[] = [];
const render = async () => act(async () => root.render(<SoundSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />));
beforeEach(async () => {
  state = { outputs: [
    { id: "hdmi", name: "HDMI TV", state: "IDLE", availability: "available", muted: false, volume: 63 },
    { id: "analog", name: "Speakers", state: "SUSPENDED", availability: "unavailable", muted: true, volume: 25 },
  ], defaultOutput: "analog", test: null, canTest: true };
  calls.length = 0; window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    calls.push({ url: String(input), body: init?.body });
    if (String(input).endsWith("/test")) state = { ...state, canTest: false, test: { id: "test-id", output: "hdmi", observedOutput: null, status: "starting", endsAt: Date.now() + 3000, message: null } };
    if (String(input).endsWith("/stop")) state = { ...state, canTest: true, test: { ...state.test!, status: "stopped", message: "Sound test stopped." } };
    return Response.json(state);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ SoundSettings } = await import("./SoundSettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("shows system-default and observed level without claiming permanent selection", async () => {
  await render();
  expect(document.body.textContent).toContain("System default");
  expect(document.body.textContent).toContain("63%");
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Test Speakers")!.disabled).toBe(true);
  expect(document.body.textContent).toContain("does not select it for Couch playback");
});
test("test uses explicit output identity and Stop remains available before route confirmation", async () => {
  await render();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Test HDMI TV")!.click());
  expect(calls.find(call => call.url.endsWith("/test"))!.body).toBe(JSON.stringify({ output: "hdmi" }));
  expect(document.body.textContent).toContain("routing has not been confirmed");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Stop sound test")!.click());
  expect(calls.find(call => call.url.endsWith("/stop"))!.body).toBe(JSON.stringify({ testId: "test-id" }));
});

test("phone selection uses the stable device name and shows saved, unconfirmed routing separately", async () => {
  state = { ...state, audioDelay: 0.25, routing: { selectedOutput: "hdmi", observedOutput: null, volume: 63, muted: false, error: null } };
  await render();
  expect(document.body.textContent).toContain("Saved for playback. No active audio stream to confirm.");
  expect(document.body.textContent).toContain("TV audio delay");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use HDMI TV")!.click());
  expect(calls.find(call => call.url.endsWith("/output"))!.body).toBe(JSON.stringify({ output: "hdmi" }));
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use Speakers")!.disabled).toBe(true);
});
