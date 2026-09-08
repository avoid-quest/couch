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
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
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
const trigger = () => document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Sound output"]')!;
const openOutputs = async () => act(async () => trigger().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const choose = async (name: string) => {
  await openOutputs();
  const option = options().find(option => option.textContent === name)!;
  await act(async () => { option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); option.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

test("keeps sound tests in a secondary disclosure", async () => {
  await render();
  expect(document.querySelector("details")?.open).toBe(false);
  expect(document.querySelector("summary")?.tabIndex).toBe(0);
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

test("selection uses the stable device name and keeps unconfirmed routing separate", async () => {
  state = { ...state, audioDelay: 0.25, routing: { selectedOutput: "analog", observedOutput: null, volume: 63, muted: false, error: null } };
  await render();
  expect(trigger().textContent).toContain("Speakers · Unavailable");
  expect(document.body.textContent).not.toContain("Playing on");
  expect(document.body.textContent).toContain("TV audio delay");
  await choose("HDMI TV");
  expect(calls.find(call => call.url.endsWith("/output"))!.body).toBe(JSON.stringify({ output: "hdmi" }));
  expect(trigger().textContent).toBe("HDMI TV");
});

test("offers available HDMI, analog profiles and connected Bluetooth in one select", async () => {
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
  expect(document.querySelectorAll('[role="combobox"]')).toHaveLength(1);
  expect(document.body.textContent).toContain("Playing on HDMI TV · Volume 63%");
  await openOutputs();
  expect(options().map(option => option.textContent)).toEqual(["HDMI TV", "C39S", "Built-in speakers · Pauses playback"]);
  const speaker = options().find(option => option.textContent === "C39S")!;
  await act(async () => { speaker.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); speaker.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.find(call => call.url.endsWith("/output"))!.body).toBe(JSON.stringify({ output: "bluez.C39S" }));
  expect(trigger().textContent).toBe("C39S");
  await choose("Built-in speakers · Pauses playback");
  expect(calls.find(call => call.url.endsWith("/profile"))!.body).toBe(JSON.stringify({ profile: { card: "internal", profile: "output:analog" } }));
});

test("retains a disconnected selection without silently selecting another route", async () => {
  state = { ...state, routing: { selectedOutput: "missing", observedOutput: null, volume: null, muted: false, error: "Reconnect it or choose another output, then resume playback." } };
  await render();
  expect(trigger().textContent).toContain("Previously selected output · Unavailable");
  expect(calls.every(call => call.body === undefined)).toBe(true);
});

test("does not mistake the saved output for the currently observed playback route", async () => {
  state = { ...state, routing: { selectedOutput: "hdmi", observedOutput: "analog", volume: 63, muted: false, error: "Couch left the selected audio output." } };
  await render();
  expect(trigger().textContent).toBe("HDMI TV");
  expect(document.body.textContent).toContain("Playing on Speakers · Muted");
  expect(document.querySelector('[role="status"]')!.textContent).toContain("Couch left the selected audio output");
});

test("a rejected selection keeps the previous output selected and reports the failure", async () => {
  state = { ...state, routing: { selectedOutput: "analog", observedOutput: null, volume: 25, muted: true, error: null } };
  request.mockImplementation((async (_input, init) => init?.method === "POST" ? Response.json({ error: "That audio output is unavailable." }, { status: 409 }) : Response.json(state)) as typeof fetch);
  await render();
  await choose("HDMI TV");
  expect(document.querySelector('[role="alert"]')!.textContent).toBe("That audio output is unavailable.");
  expect(trigger().textContent).toContain("Speakers · Unavailable");
});

test("polling leaves open choices in place and appends newly available outputs", async () => {
  state = { ...state, outputs: [state.outputs[0]!], routing: { selectedOutput: "hdmi", observedOutput: "hdmi", volume: 63, muted: false, error: null },
    profiles: [{ card: "internal", id: "output:analog", name: "Built-in speakers", active: false, available: true, selectable: true }],
  };
  await render();
  await openOutputs();
  const speakers = options().find(option => option.textContent === "Built-in speakers · Pauses playback")!;
  await act(async () => speakers.focus());
  state = { ...state, outputs: [{ id: "bluez.C39S", name: "C39S", state: "IDLE", availability: "available", volume: 40, muted: false }, { ...state.outputs[0]!, volume: 55 }] };
  await act(async () => { await Bun.sleep(800); });
  expect(options().map(option => option.textContent)).toEqual(["HDMI TV", "Built-in speakers · Pauses playback", "C39S"]);
  expect(document.activeElement).toBe(speakers);
  expect(document.body.textContent).toContain("Volume 55%");
  state = { ...state, outputs: [...state.outputs].reverse() };
  await act(async () => { await Bun.sleep(800); });
  expect(options().map(option => option.textContent)).toEqual(["HDMI TV", "Built-in speakers · Pauses playback", "C39S"]);
  await act(async () => { speakers.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); speakers.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.find(call => call.url.endsWith("/profile"))!.body).toBe(JSON.stringify({ profile: { card: "internal", profile: "output:analog" } }));
  state = { ...state, outputs: state.outputs.filter(output => output.id !== "hdmi") };
  await act(async () => { await Bun.sleep(800); });
  await openOutputs();
  expect(options().map(option => option.textContent)).toEqual(["Built-in speakers · Pauses playback", "C39S"]);
  expect(trigger().textContent).toContain("Previously selected output · Unavailable");
});
