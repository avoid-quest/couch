import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { DisplayState } from "../shared/display";
let DisplaySettings: typeof import("./DisplaySettings")["DisplaySettings"];
let root: Root, window: Window, request: ReturnType<typeof spyOn>, state: DisplayState;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { url: string; body: unknown }[] = [];
const render = async (connected = true) => act(async () => root.render(<DisplaySettings credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} />));
beforeEach(async () => {
  state = { outputs: [
    { id: "panel", name: "eDP-1", connected: true, width: 1366, height: 768, x: 0, y: 0, refresh: 60 },
    { id: "tv", name: "HDMI-1", connected: true, width: 1920, height: 1080, x: 1366, y: 0, refresh: 59.94 },
    { id: "disabled", name: "HDMI-2", connected: true, width: 0, height: 0, x: 0, y: 0, refresh: null },
  ], saved: "tv", current: "panel", notice: "The saved screen is unavailable.", preview: null };
  calls.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    calls.push({ url: String(input), body: init?.body });
    if (String(input).endsWith("/preview")) state = { ...state, preview: { token: "current-preview", expiresAt: Date.now() + 20_000 } };
    if (String(input).endsWith("/confirm")) state = { ...state, preview: null, current: "tv" };
    return Response.json(state);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ DisplaySettings } = await import("./DisplaySettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("shows observed modes and disabled outputs without offering unusable targets", async () => {
  await render();
  expect(document.body.textContent).toContain("59.94 Hz");
  expect(document.body.textContent).toContain("Connected, disabled");
  expect(document.body.textContent).toContain("Couch is here");
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("HDMI-2"))!.disabled).toBe(true);
});
test("preview supplies physical identity and confirm uses the native preview token", async () => {
  await render();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Preview on HDMI-1")!.click());
  expect(calls.find(call => call.url.endsWith("/preview"))!.body).toBe(JSON.stringify({ output: "tv" }));
  expect(document.body.textContent).toContain("seconds remaining");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Keep this screen")!.click());
  expect(calls.find(call => call.url.endsWith("/confirm"))!.body).toBe(JSON.stringify({ token: "current-preview" }));
});
test("a native mutation failure remains visible after polling succeeds", async () => {
  await render();
  request.mockImplementation((async (input) => String(input).endsWith("/preview") ? Response.json({ error: "That screen disappeared." }, { status: 503 }) : Response.json(state)) as typeof fetch);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Preview on HDMI-1")!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("That screen disappeared.");
});
test("disconnect aborts the pending mutation and ignores a late response", async () => {
  await render();
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  request.mockImplementation((async (input, init) => {
    if (String(input).endsWith("/preview")) { signal = init?.signal as AbortSignal; return gate.promise; }
    return Response.json(state);
  }) as typeof fetch);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Preview on HDMI-1")!.click());
  await render(false);
  expect(signal!.aborted).toBe(true);
  await act(async () => gate.resolve(Response.json({ ...state, notice: "Stale response must be ignored." })));
  expect(document.body.textContent).not.toContain("Stale response");
  expect(document.body.textContent).toContain("Reconnect to read");
});
