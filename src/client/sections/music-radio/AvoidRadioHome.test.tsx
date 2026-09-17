import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import type { RadioStation } from "../../../shared/radio";

let root: Root, window: Window, request: Mock<typeof fetch>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const station: RadioStation = { id: "one", sourceId: "avoid", name: "Station one", url: "https://stream.example/one", homepage: null, countryCode: "", codec: "", bitrate: 0 };
const queued: [string, boolean][] = [];
const credentials = { origin: "http://localhost", token: "paired" };
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label)!;
const click = async (label: string, scope: ParentNode = document) => { await act(async () => button(label, scope).click()); await flush(); };

async function render(origin = credentials.origin, token = credentials.token) {
  const { AvoidRadioHome } = await import("./AvoidRadioHome");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const component = <AvoidRadioHome key={`${origin}\0${token}`} credentials={{ origin, token }} connected canPlay onEnqueue={async (current, playNow) => { queued.push([current.id, playNow]); return true; }} />;
  await act(async () => root.render(<QueryClientProvider client={client}>{component}</QueryClientProvider>));
  await flush();
}

beforeEach(async () => {
  queued.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/radio/favorites" && init?.method === "POST") return Response.json({});
    if (url.pathname === "/api/radio/favorites") return Response.json({ favorites: [] });
    if (url.pathname === "/api/radio/avoid/programmes") return Response.json({ programmes: {} });
    return Response.json({ playlist: { id: "avoid", name: "avoid radio", error: null }, stations: [station] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("avoid radio reads through Query and playback stays on the session callback", async () => {
  await render();
  expect(button("Play: Station one")).toBeDefined();
  await click("Play: Station one");
  expect(queued).toEqual([["one", true]]);
  expect(document.body.textContent).toContain("Starting Station one.");
  expect(request.mock.calls.some(([input]) => String(input).endsWith("/api/radio/avoid"))).toBe(true);
});

test("favorite writes invalidate radio queries and identity changes reset details", async () => {
  await render();
  await click("Details: Station one");
expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click("Keep Station one", document.querySelector('[role="dialog"]')!);
  const favoriteWrites = request.mock.calls.filter(([input, init]) => new URL(String(input)).pathname === "/api/radio/favorites" && init?.method === "POST");
  expect(favoriteWrites).toHaveLength(1);
  expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/radio/favorites").length).toBeGreaterThan(1);
  await render("http://other");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
