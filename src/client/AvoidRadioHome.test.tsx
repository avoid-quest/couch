import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { RadioStation } from "../shared/radio";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const station: RadioStation = { id: "one", sourceId: "avoid", tvgId: "avoid-radio-one", name: "Station one", url: "https://stream.example/one", homepage: null, countryCode: "", codec: "", bitrate: 0 };
const queued: [string, boolean][] = [];
let favorites: RadioStation[] = [], failing = false, delayProgramme = false;
let releaseProgramme: (() => void) | undefined;
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string, scope: ParentNode = document) => { await act(async () => button(label, scope).click()); await flush(); };
async function render(origin = "http://localhost", connected = true, active = true) {
  const { AvoidRadioHome } = await import("./AvoidRadioHome");
  await act(async () => root.render(<AvoidRadioHome origin={origin} token="paired" connected={connected} canPlay={connected} active={active} version={1} onEnqueue={async (current, playNow) => { queued.push([current.id, playNow]); return true; }} />));
  await flush();
}
beforeEach(async () => {
  queued.length = 0; favorites = []; failing = delayProgramme = false; releaseProgramme = undefined;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (url.pathname === "/api/radio/favorites") {
      if (init?.method === "POST") favorites.push(JSON.parse(String(init.body)).station);
      return Response.json({ favorites });
    }
    if (url.pathname.startsWith("/api/radio/favorites/")) { favorites = []; return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/radio/avoid/programmes") {
      if (delayProgramme) await new Promise<void>(resolve => { releaseProgramme = resolve; });
      return Response.json({ programmes: { one: { title: "Current programme", description: "Provider description", programmeUrl: "https://provider.example/show", sampledAt: Date.now(), expiresAt: Date.now() + 900000 } } });
    }
    if (failing) return Response.json({ error: "avoid radio is unavailable" }, { status: 502 });
    return Response.json({ playlist: { id: "avoid", name: "avoid radio", error: null }, stations: url.hostname === "other" ? [] : [station] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  releaseProgramme?.(); await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("browse and details do not play, queue and play are distinct, and closing details restores focus", async () => {
  await render();
  expect(document.body.textContent).toContain("Current programme");
  expect(queued).toEqual([]);
  await click("Details: Station one");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Provider description");
  expect(queued).toEqual([]);
  await click("Add to queue: Station one", dialog);
  await click("Play now: Station one", dialog);
  expect(queued).toEqual([["one", false], ["one", true]]);
  await click("Close", dialog);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details: Station one");
  await click("Save Station one");
  expect(favorites).toEqual([station]);
  expect(button("Unsave Station one").getAttribute("aria-pressed")).toBe("true");
});

test("slow programme metadata never delays station browsing or queue actions", async () => {
  delayProgramme = true;
  await render();
  expect(button("Add to queue: Station one")).toBeDefined();
  await click("Add to queue: Station one");
  expect(queued).toEqual([["one", false]]);
  releaseProgramme?.(); await flush();
  expect(document.body.textContent).toContain("Current programme");
});

test("provider failure retries directly and changing installation clears the previous station state", async () => {
  failing = true; await render();
  expect(document.body.textContent).toContain("avoid radio is unavailable");
  failing = false; await click("Retry avoid radio");
  expect(button("Details: Station one")).toBeDefined();
  await render("http://other");
  expect(button("Details: Station one")).toBeUndefined();
  expect(document.body.textContent).toContain("No stations are available");
});

test("inactive discovery makes no requests and disconnected controls cannot send actions", async () => {
  await render("http://localhost", true, false);
  expect(request).not.toHaveBeenCalled();
  await render();
  await render("http://localhost", false);
  expect(button("Play now: Station one").disabled).toBe(true);
  expect(button("Add to queue: Station one").disabled).toBe(true);
});


test("programme title and artwork expire even when the following metadata request fails", async () => {
  let now = 1000, programmeReads = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const originalTimer = globalThis.setTimeout;
  const scheduled = new Map<number, () => void>();
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay] = args;
    if (typeof callback === "function" && (delay === 1000 || delay === 60_000)) scheduled.set(delay, callback as () => void);
    return originalTimer(...args);
  }) as typeof setTimeout);
  const originalRequest = request.getMockImplementation()!;
  request.mockImplementation((async (input, init) => {
    if (new URL(String(input)).pathname !== "/api/radio/avoid/programmes") return originalRequest(input, init);
    if (++programmeReads > 1) return Response.json({ error: "Programme service unavailable" }, { status: 503 });
    return Response.json({ programmes: { one: { title: "Expiring programme", artworkUrl: "https://provider.example/expiring.jpg", sampledAt: 1000, expiresAt: 2000 } } });
  }) as typeof fetch);
  try {
    await render();
    expect(document.body.textContent).toContain("Expiring programme");
    expect(document.querySelector('img[src="https://provider.example/expiring.jpg"]')).not.toBeNull();
    await act(async () => { now = 1500; scheduled.get(60_000)!(); });
    await flush();
    expect(programmeReads).toBe(2);
    expect(document.body.textContent).toContain("Expiring programme");
    await act(async () => { now = 2000; scheduled.get(1000)!(); });
    expect(document.body.textContent).not.toContain("Expiring programme");
    expect(document.querySelector('img[src="https://provider.example/expiring.jpg"]')).toBeNull();
    expect(button("Add to queue: Station one").disabled).toBe(false);
  } finally { timers.mockRestore(); clock.mockRestore(); }
});
