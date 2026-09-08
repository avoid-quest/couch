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
    if (String(input).endsWith("/output")) state = { ...state, routing: { ...state.routing!, selectedOutput: JSON.parse(String(init?.body)).output, observedOutput: null } };
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
test("lists output levels and keeps sound tests in a secondary disclosure", async () => {
  await render();
  expect(document.querySelector("details")?.open).toBe(false);
  expect(document.querySelector("summary")?.tabIndex).toBe(0);
  expect(document.body.textContent).toContain("63%");
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Test Speakers")!.disabled).toBe(true);
  expect(document.body.textContent).toContain("does not select it for playback");
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
  expect(document.querySelector('[aria-label="Use HDMI TV"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.body.textContent).not.toContain("Playing here");
  expect(document.body.textContent).toContain("TV audio delay");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === "Use HDMI TV")!.click());
  expect(calls.find(call => call.url.endsWith("/output"))!.body).toBe(JSON.stringify({ output: "hdmi" }));
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === "Use Speakers")!.disabled).toBe(true);
});


test("puts HDMI, analog profiles and connected Bluetooth in one selectable list", async () => {
  state = { ...state, routing: { selectedOutput: "hdmi", observedOutput: "hdmi", volume: 63, muted: false, error: null },
    outputs: [...state.outputs, { id: "bluez.C39S", name: "C39S", state: "IDLE", availability: "unknown", volume: 40, muted: false }],
    profiles: [
      { card: "internal", id: "output:hdmi", name: "HDMI", active: true, available: true, selectable: true },
      { card: "internal", id: "output:analog", name: "Built-in speakers", active: false, available: true, selectable: true },
      { card: "internal", id: "output:hdmi2", name: "HDMI 2", active: false, available: false, selectable: true },
      { card: "internal", id: "input:analog", name: "Microphone", active: false, available: true, selectable: false },
    ],
  };
  await render();
  const list = document.querySelector('[aria-label="Sound outputs"]')!;
  expect(list.querySelectorAll("li")).toHaveLength(5);
  expect(list.textContent).toContain("Selected · Playing here");
  expect(list.textContent).toContain("C39S");
  expect(list.textContent).toContain("Built-in speakers");
  expect(list.textContent).not.toContain("Microphone");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Use HDMI 2"]')!.disabled).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Use C39S"]')!.click());
  expect(calls.find(call => call.url.endsWith("/output"))!.body).toBe(JSON.stringify({ output: "bluez.C39S" }));
  expect(document.querySelector('[aria-label="Use C39S"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[aria-label="Use HDMI TV"]')!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Use Built-in speakers"]')!.click());
  expect(calls.find(call => call.url.endsWith("/profile"))!.body).toBe(JSON.stringify({ profile: { card: "internal", profile: "output:analog" } }));
});

test("retains a disconnected selection without silently selecting another route", async () => {
  state = { ...state, routing: { selectedOutput: "missing", observedOutput: null, volume: null, muted: false, error: "Reconnect it or choose another output, then resume playback." } };
  await render();
  expect(document.body.textContent).toContain("Selected · Disconnected");
  expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
  expect(calls.every(call => call.body === undefined)).toBe(true);
});

test("does not mistake the saved output for the currently observed playback route", async () => {
  state = { ...state, routing: { selectedOutput: "hdmi", observedOutput: "analog", volume: 63, muted: false, error: "Couch left the selected audio output." } };
  await render();
  expect(document.querySelector('[aria-label="Use HDMI TV"]')!.textContent).not.toContain("Playing here");
  expect(document.querySelector('[aria-label="Use Speakers"]')!.textContent).toContain("Playing here");
  expect(document.querySelector('[role="status"]')!.textContent).toContain("Couch left the selected audio output");
});


test("a rejected selection keeps the previous output selected and reports the failure", async () => {
  state = { ...state, routing: { selectedOutput: "analog", observedOutput: null, volume: 25, muted: true, error: null } };
  request.mockImplementation((async (_input, init) => init?.method === "POST" ? Response.json({ error: "That audio output is unavailable." }, { status: 409 }) : Response.json(state)) as typeof fetch);
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Use HDMI TV"]')!.click());
  expect(document.querySelector('[role="alert"]')!.textContent).toBe("That audio output is unavailable.");
  expect(document.querySelector('[aria-label="Use Speakers"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[aria-label="Use HDMI TV"]')!.getAttribute("aria-pressed")).toBe("false");
});
