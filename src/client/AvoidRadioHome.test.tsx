import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import type { AvoidRadioHomeProps } from "./AvoidRadioHome";
import type { Root } from "react-dom/client";
import type { RadioStation } from "../shared/radio";

let root: Root, window: Window, request: Mock<typeof fetch>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const station: RadioStation = { id: "one", sourceId: "avoid", tvgId: "avoid-radio-one", name: "Station one", url: "https://stream.example/one", homepage: null, countryCode: "", codec: "", bitrate: 0 };
const queued: [string, boolean][] = [];
let favorites: RadioStation[] = [], stations = [station], failing = false, delayProgramme = false;
let releaseProgramme: (() => void) | undefined;
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string, scope: ParentNode = document) => { await act(async () => button(label, scope).click()); await flush(); };
async function render(props: Partial<AvoidRadioHomeProps> = {}, strict = false) {
  const { AvoidRadioHome } = await import("./AvoidRadioHome");
  const content = <AvoidRadioHome origin="http://localhost" token="paired" connected canPlay version={1} onEnqueue={async (current, playNow) => { queued.push([current.id, playNow]); return true; }} {...props} />;
  await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
  await flush();
}
beforeEach(async () => {
  queued.length = 0; favorites = []; stations = [station]; failing = delayProgramme = false; releaseProgramme = undefined;
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
    return Response.json({ playlist: { id: "avoid", name: "avoid radio", error: null }, stations: url.hostname === "other" ? [] : stations });
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
  await render({ origin: "http://other" });
  expect(button("Details: Station one")).toBeUndefined();
  expect(document.body.textContent).toContain("No stations are available");
});

test("inactive discovery makes no requests and disconnected controls cannot send actions", async () => {
  await render({ active: false });
  expect(request).not.toHaveBeenCalled();
  await render();
  await render({ connected: false, canPlay: false });
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


for (const strict of [false, true]) test(`only an explicit Retry forces a catalog refresh${strict ? " in Strict Mode" : ""}`, async () => {
  const reads = () => request.mock.calls.map(([input, init]) => ({ url: new URL(String(input)), signal: init?.signal as AbortSignal }))
    .filter(({ url }) => url.pathname === "/api/radio/avoid");
  failing = true; await render({}, strict);
  expect(reads().map(({ url }) => url.searchParams.has("refresh"))).toEqual(strict ? [false, false] : [false]);
  if (strict) expect(reads()[0]!.signal.aborted).toBe(true);
  failing = false; await click("Retry avoid radio");
  await render({ connected: false }, strict); await render({}, strict);
  await render({ active: false }, strict); await render({}, strict);
  await render({ version: 2 }, strict);
  await render({ origin: "http://other", version: 2 }, strict);
  expect(reads().map(({ url }) => url.searchParams.has("refresh"))).toEqual([...(strict ? [false, false] : [false]), true, false, false, false, ...(strict ? [false, false] : [false])]);
});

test("version changes update open station details and remove deleted actions without restarting the programme poll", async () => {
  const played: RadioStation[] = [];
  const onEnqueue = async (value: RadioStation) => { played.push(value); return true; };
  const programmeReads = () => request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/radio/avoid/programmes").length;
  await render({ onEnqueue }); await click("Details: Station one");
  const initialProgrammeReads = programmeReads();
  stations = [{ ...station, name: "Updated station", url: "https://stream.example/updated" }];
  await render({ version: 2, onEnqueue });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe("Updated station");
  await click("Play now: Updated station", dialog);
  expect(played).toEqual(stations);
  expect(programmeReads()).toBe(initialProgrammeReads);
  stations = []; await render({ version: 3, onEnqueue });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Play now: Updated station")).toBeUndefined();
  stations = [station]; await render({ version: 4, onEnqueue });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("obsolete catalog responses and errors cannot replace the current version", async () => {
  const originalRequest = request.getMockImplementation()!;
  const pending: { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  request.mockImplementation(((input, init) => {
    if (new URL(String(input)).pathname !== "/api/radio/avoid") return originalRequest(input, init);
    return new Promise<Response>((resolve, reject) => pending.push({ signal: init!.signal as AbortSignal, resolve, reject }));
  }) as typeof fetch);
  await render(); await render({ version: 2 }); await render({ version: 3 });
  expect(pending.slice(0, 2).every(value => value.signal.aborted)).toBe(true);
  const catalog = (name: string) => Response.json({ playlist: { id: "avoid", name: "avoid radio", error: null }, stations: [{ ...station, name }] });
  await act(async () => pending[2]!.resolve(catalog("Current station"))); await flush();
  await act(async () => { pending[0]!.resolve(catalog("Obsolete station")); pending[1]!.reject(new Error("Obsolete failure")); }); await flush();
  expect(button("Details: Current station")).toBeDefined();
  expect(document.body.textContent).not.toContain("Obsolete");
  expect(document.body.textContent).not.toContain("Loading stations");
});

test("deactivation closes details and reactivation restores the result opener", async () => {
  await render(); await click("Details: Station one");
  const trigger = button("Details: Station one");
  await render({ active: false });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const navigation = document.createElement("button"); document.body.append(navigation); navigation.focus();
  expect(document.activeElement === navigation).toBe(true);
  await render(); await act(async () => { await Bun.sleep(30); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement === trigger).toBe(true);
});

for (const blockedBy of ["dialog", "hidden", "deleted"]) test(`returning to discovery does not focus an opener blocked by ${blockedBy}`, async () => {
  await render(); await click("Details: Station one");
  await render({ active: false });
  const navigation = document.createElement("button"); document.body.append(navigation); navigation.focus();
  if (blockedBy === "dialog") {
    const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); modal.setAttribute("data-state", "open");
    modal.append(navigation); document.body.append(modal); navigation.focus();
  } else if (blockedBy === "hidden") button("Details: Station one").closest("section")!.hidden = true;
  else { stations = []; await render({ connected: true, active: false, version: 2 }); }
  await render({ version: blockedBy === "deleted" ? 2 : 1 }); await act(async () => { await Bun.sleep(30); });
  expect(document.activeElement === navigation).toBe(true);
});

test("identity changes cancel pending favorite mutations and discard their late completion", async () => {
  const originalRequest = request.getMockImplementation()!;
  let release: (response: Response) => void = () => {};
  let signal: AbortSignal | undefined;
  request.mockImplementation(((input, init) => {
    if (new URL(String(input)).pathname === "/api/radio/favorites" && init?.method === "POST") {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return originalRequest(input, init);
  }) as typeof fetch);
  await render(); await click("Save Station one");
  await render({ origin: "http://other" });
  expect(signal?.aborted).toBe(true);
  await act(async () => release(Response.json({}))); await flush();
  expect(document.body.textContent).not.toContain("saved to favorites");
  expect(button("Details: Station one")).toBeUndefined();
});

test("unmount cancels reads and mutations, including a pending programme response", async () => {
  delayProgramme = true;
  const originalRequest = request.getMockImplementation()!;
  let rejectFavorite: (error: Error) => void = () => {};
  request.mockImplementation(((input, init) => {
    if (new URL(String(input)).pathname === "/api/radio/favorites" && init?.method === "POST") return new Promise<Response>((_, reject) => { rejectFavorite = reject; });
    return originalRequest(input, init);
  }) as typeof fetch);
  await render(); await click("Save Station one");
  const signals = request.mock.calls.map(([, init]) => init?.signal as AbortSignal);
  await act(async () => root.unmount());
  expect(signals.every(signal => signal.aborted)).toBe(true);
  await act(async () => { releaseProgramme?.(); rejectFavorite(new Error("Obsolete favorite failure")); }); await flush();
  expect(document.body.textContent).toBe("");
});

test("deactivation cancels the scheduled programme poll and reactivation starts one ordinary read", async () => {
  const originalTimer = globalThis.setTimeout;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const timer = originalTimer(...args);
    if (args[1] === 60_000) pollTimer = timer;
    return timer;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout");
  const programmeReads = () => request.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/radio/avoid/programmes");
  try {
    await render();
    const firstPoll = pollTimer;
    expect(firstPoll).toBeDefined();
    await render({ active: false });
    expect(clear.mock.calls.some(([timer]) => timer === firstPoll)).toBe(true);
    expect(programmeReads()).toHaveLength(1);
    expect(programmeReads()[0]![1]!.signal!.aborted).toBe(true);
    await render();
    expect(programmeReads()).toHaveLength(2);
  } finally { timers.mockRestore(); clear.mockRestore(); }
});

test("changing credentials resets details and ignores a previous queue completion", async () => {
  const originalRequest = request.getMockImplementation()!;
  request.mockImplementation(((input, init) => {
    if (new Headers(init?.headers).get("Authorization") === "Bearer replacement") {
      if (new URL(String(input)).pathname === "/api/radio/favorites") return Promise.resolve(Response.json({ favorites: [] }));
      return Promise.resolve(Response.json({ playlist: { id: "avoid", name: "avoid radio", error: null }, stations: [] }));
    }
    return originalRequest(input, init);
  }) as typeof fetch);
  let finish: (success: boolean) => void = () => {};
  await render({ onEnqueue: () => new Promise(resolve => { finish = resolve; }) });
  await click("Details: Station one");
  await click("Add to queue: Station one", document.querySelector('[role="dialog"]')!);
  await render({ token: "replacement" });
  await act(async () => finish(true)); await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain("added to queue");
  expect(button("Details: Station one")).toBeUndefined();
});
