import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen } from "@/testing";
import { rememberConnection } from "@/session/connection";
import type { Action, SessionState } from "../../../shared/protocol";

const origin = "http://living-room:4100";
const token = "living-room-secret";
const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

beforeEach(async () => {
  window = new Window({ url: `${origin}/find` });
  for (const key of ["CSS", "window", "document", "navigator", "location", "history", "localStorage", "scrollTo", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async input => Response.json(String(input).endsWith("/api/sound") ? { outputs: [], routing: null, defaultOutput: null } : { adapter: "off", devices: [] })) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function render(state?: SessionState, run?: (action: Action) => Promise<boolean>) {
  const { PlaybackStatus } = await import("./PlaybackStatus");
  const base = createRootRoute({ component: () => <PlaybackStatus credentials={{ origin, token, installationId: "living-room-installation" }} connected status="Connected" installationName="Living room" state={state} run={run} /> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => null });
  const sound = createRoute({ getParentRoute: () => base, path: "/settings/sound", component: () => null });
  const router = createRouter({ routeTree: base.addChildren([find, sound]), history: createMemoryHistory({ initialEntries: ["/find"] }) });
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => { await router.load(); root.render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>); });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Playing on Living room: Connected" })));
  await flush();
}

test("a typed Couch requires explicit switching and uses only its origin", async () => {
  window.localStorage.setItem("couch.remote-token", token);
  await render();
  await act(async () => fireEvent.change(screen.getByRole("textbox", { name: "Another Couch address" }), { target: { value: "http://kitchen:4100" } }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
  expect(window.location.origin).toBe(origin);
  expect(screen.getByText("Switch this browser to kitchen:4100?")).toBeDefined();
  expect(screen.getByText(/Living room keeps playing/)).toBeDefined();
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
  expect(window.location.origin).toBe(origin);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch" })));
  expect(window.location.href).toBe("http://kitchen:4100/");
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
  expect(window.localStorage.getItem("couch.remote-token")).toBe(token);
});

test("a remembered Couch is offered without reusing this Couch's pairing", async () => {
  rememberConnection("http://kitchen:4100", { name: "Kitchen", urls: ["http://kitchen:4100"], installationId: "kitchen-installation", player: "idle" });
  await render();
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Kitchen" })));
  expect(screen.getByText("Switch this browser to kitchen:4100?")).toBeDefined();
  expect(window.location.origin).toBe(origin);
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
});

test("addresses with pairing details or paths cannot become destinations", async () => {
  await render();
  for (const address of ["http://secret@kitchen:4100", "http://kitchen:4100/#pair=123456", "http://kitchen:4100/api", "javascript:alert(1)"]) {
    await act(async () => fireEvent.change(screen.getByRole("textbox", { name: "Another Couch address" }), { target: { value: address } }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
    expect(screen.getByRole("alert").textContent).toContain("Enter just the address");
    expect(screen.queryByRole("button", { name: "Switch" })).toBeNull();
  }
  expect(window.location.origin).toBe(origin);
});

test("Playing on exposes the same mute and volume commands as the player", async () => {
  const actions: Action[] = [];
  await render({
    queue: [], currentEntryId: null, installationName: "Living room", activeProfile: { id: "household", name: "Household" },
    player: { status: "idle", playbackId: null, position: 0, duration: null, seekable: false, volume: 40, error: null },
    systemAudio: { selectedOutput: "speakers", observedOutput: "speakers", volume: 40, muted: false, error: null },
  }, async action => { actions.push(action); return true; });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mute Living room" })));
  await act(async () => fireEvent.keyDown(screen.getByRole("slider", { name: "Volume" }), { key: "End" }));
  expect(actions).toEqual([{ type: "mute", muted: true }, { type: "volume", volume: 100 }]);
});
