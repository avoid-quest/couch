import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import type { RadioStation } from "../../../shared/radio";
import { fireEvent, screen, within } from "../../testing";

let root: Root, window: Window, request: Mock<typeof fetch>, client: QueryClient;
const originals = new Map<string, PropertyDescriptor | undefined>();
const station: RadioStation = { id: "station-713", sourceId: "avoid", name: "Station one", url: "https://stream.example/one", homepage: null, countryCode: "", codec: "", bitrate: 0 };
const queued: [string, boolean][] = [];
const credentials = { origin: "http://localhost", token: "paired" };
let programmes: Record<string, { title: string; description?: string; artworkUrl?: string; expiresAt: number }> = {};
let pendingProgrammeSignal: AbortSignal | undefined;
let holdProgrammes = false;
let catalogueError: string | null = null;
const flush = () => act(async () => { await Bun.sleep(10); });
const click = async (label: string, scope: HTMLElement = document.body) => { await act(async () => fireEvent.click(within(scope).getByRole("button", { name: label }))); await flush(); };

async function render({ origin = credentials.origin, token = credentials.token, connected = true, active = true }: { origin?: string; token?: string; connected?: boolean; active?: boolean } = {}) {
  const { AvoidRadioHome } = await import("./AvoidRadioHome");
  const component = <AvoidRadioHome key={`${origin}\0${token}`} credentials={{ origin, token }} connected={connected} active={active} canPlay onEnqueue={async (current, playNow) => { queued.push([current.id, playNow]); return true; }} />;
  await act(async () => root.render(<QueryClientProvider client={client}>{component}</QueryClientProvider>));
  await flush();
}

beforeEach(async () => {
  queued.length = 0;
  programmes = {};
  pendingProgrammeSignal = undefined;
  holdProgrammes = false;
  catalogueError = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    if (url.pathname === "/api/radio/avoid/programmes") {
      pendingProgrammeSignal = init?.signal ?? undefined;
      if (holdProgrammes) return new Promise<Response>(() => {});
      return Response.json({ programmes });
    }
    return Response.json({ playlist: { id: "avoid", name: "avoid radio", error: catalogueError }, stations: [station] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
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
  expect(screen.getByRole("button", { name: "Play: Station one" })).toBeDefined();
  await click("Play: Station one");
  expect(queued).toEqual([["station-713", true]]);
  expect(screen.getByRole("status").textContent).toContain("Starting Station one.");
  expect(request.mock.calls.some(([input]) => String(input).endsWith("/api/radio/avoid"))).toBe(true);
});

test("favorite writes invalidate radio queries and identity changes reset details", async () => {
  await render();
  await click("Details: Station one");
  const detail = screen.getByRole("dialog");
  await click("Keep Station one", detail);
  const favoriteWrites = request.mock.calls.filter(([input, init]) => new URL(String(input)).pathname === "/api/radio/favorites" && init?.method === "POST");
  expect(favoriteWrites).toHaveLength(1);
  expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/radio/favorites").length).toBeGreaterThan(1);
  expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/radio/avoid/programmes").length).toBeGreaterThan(1);
  await render({ origin: "http://other" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("programme envelopes populate a realistic station's card and details", async () => {
  programmes = { "station-713": { title: "Late afternoon", description: "A live set", artworkUrl: "https://art.example/show.jpg", expiresAt: Date.now() + 60_000 } };
  await render();
  expect(screen.getByText("Late afternoon")).toBeDefined();
  expect(screen.getByText("A live set")).toBeDefined();
  await click("Details: Station one");
  expect(within(screen.getByRole("dialog")).getByText("Late afternoon")).toBeDefined();
  await click("Close", screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Details: Station one" }));
});

test("expired programme data falls back to the station", async () => {
  programmes = { "station-713": { title: "Expired show", expiresAt: Date.now() - 1 } };
  await render();
  expect(screen.queryByText("Expired show")).toBeNull();
  expect(screen.getAllByText("Station one")).toHaveLength(2);
});

test("expiry removes programme metadata before the next poll", async () => {
  programmes = { "station-713": { title: "About to expire", expiresAt: Date.now() + 20 } };
  await render();
  expect(screen.getByText("About to expire")).toBeDefined();
  await act(async () => { await Bun.sleep(30); });
  expect(screen.queryByText("About to expire")).toBeNull();
});

test("retry forces a fresh avoid radio request", async () => {
  catalogueError = "Source unavailable";
  await render();
  await click("Retry avoid radio");
  expect(request.mock.calls.some(([input]) => {
    const url = new URL(String(input));
    return url.pathname === "/api/radio/avoid" && url.searchParams.get("refresh") === "true";
  })).toBe(true);
});

test("retiring the connection cancels the shared programme read", async () => {
  holdProgrammes = true;
  await render();
  await render({ connected: false });
  expect(pendingProgrammeSignal?.aborted).toBe(true);
});
