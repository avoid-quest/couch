import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen } from "../../testing";

let root: Root, window: Window, client: QueryClient, tick: () => void;
let programGate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
const originals = new Map<string, PropertyDescriptor | undefined>();
const ranges: { start: number; end: number }[] = [], groups: string[] = [];
let interval: ReturnType<typeof spyOn>, request: ReturnType<typeof spyOn>;
const zone = process.env.TZ;
const channels = [{ id: "news", name: "News", group: "all" }, { id: "sport", name: "Sport", group: "Sport" }].map(channel => ({ ...channel, sourceId: "source", tvgId: channel.id, hasLogo: false, now: null, next: null }));
const programs = () => Array.from({ length: 5 }, (_, day) => {
  const start = new Date(2026, 9, 24 + day).getTime();
  return { id: `airing-${day}`, channelId: "news", start, end: new Date(2026, 9, 25 + day).getTime(), title: `airing-${day}`, description: "" };
});
const flush = () => act(async () => { await Bun.sleep(180); });
const dateLabel = (date: Date) => date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const click = async (label: string) => { await act(async () => fireEvent.click(screen.getAllByRole("button", { name: label })[0]!)); await flush(); };

beforeEach(async () => {
  process.env.TZ = "Europe/Rome";
  setSystemTime(new Date(2026, 9, 24, 23, 59, 30));
  ranges.length = 0; groups.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const set = globalThis.setInterval;
  interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => { if (delay === 60_000) tick = callback; return set(callback, delay); }) as typeof set);
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/capabilities")) return Response.json({ liveEdge: "reload", catchup: null });
    if (url.pathname.endsWith("/programs")) {
      const range = { start: Number(url.searchParams.get("start")), end: Number(url.searchParams.get("end")) }; ranges.push(range);
      if (programGate) await programGate.promise;
      return Response.json({ programs: programs().filter(entry => entry.start < range.end && entry.end > range.start), truncated: false });
    }
    if (url.pathname.endsWith("/guide")) {
      const group = url.searchParams.get("group") ?? ""; groups.push(group);
      const filtered = channels.filter(channel => !group || channel.group === group);
      return Response.json({ channels: filtered, total: filtered.length, groups: ["all", "Sport"], sources: [{ id: "source", name: "Test", channelCount: 2, programCount: 5, updatedAt: 0, error: null }], at: Date.now() });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { GuidePanel } = await import("./GuidePanel");
  const container = document.createElement("div"); document.body.append(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><GuidePanel credentials={{ origin: "http://localhost", token: "test" }} connected canPlay host={false} onGoLive={() => {}} active run={async () => true} /></QueryClientProvider>));
  await flush();
});

afterEach(async () => {
  programGate?.resolve(); programGate = null;
  if (root) await act(async () => root.unmount());
  interval?.mockRestore(); request?.mockRestore();
  await window?.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); setSystemTime();
  if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
});

test("program list follows local midnight and keeps the selected day", async () => {
  await click("Programs");
  expect(screen.getByRole("heading", { name: /^airing-0/ })).toBeDefined();
  expect(screen.getByRole("heading", { name: dateLabel(new Date(2026, 9, 24)) })).toBeDefined();
  programGate = Promise.withResolvers<void>();
  await act(async () => { setSystemTime(new Date(2026, 9, 25, 0, 0, 30)); tick(); }); await flush();
  expect(ranges.at(-1)).toEqual({ start: new Date(2026, 9, 25).getTime(), end: new Date(2026, 9, 26).getTime() });
  expect(screen.queryByRole("heading", { name: /^airing-0/ })).toBeNull();
  programGate.resolve(); programGate = null; await flush();
  expect(screen.getByRole("heading", { name: /^airing-1/ })).toBeDefined();
  expect(ranges.at(-1)!.end - ranges.at(-1)!.start).toBe(25 * 3_600_000);
  await click("Next day");
  expect(screen.getByRole("heading", { name: /^airing-2/ })).toBeDefined();
  await act(async () => { setSystemTime(new Date(2026, 9, 26, 0, 0, 30)); tick(); }); await flush();
  expect(screen.getByRole("heading", { name: /^airing-3/ })).toBeDefined();
  expect(screen.getByRole("heading", { name: dateLabel(new Date(2026, 9, 27)) })).toBeDefined();
});

test("the real group all differs from All groups", async () => {
  const select = async (label: string) => {
    await act(async () => fireEvent.pointerDown(screen.getByRole("combobox", { name: "Group" }), { button: 0, pointerType: "mouse" }));
    const option = screen.getByRole("option", { name: label });
    await act(async () => { fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" }); fireEvent.click(option); });
    await flush();
  };
  await select("all"); expect(groups.at(-1)).toBe("all");
  expect(screen.getByRole("heading", { name: "News" })).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Sport" })).toBeNull();
  await select("Sport"); expect(groups.at(-1)).toBe("Sport");
  expect(screen.getByRole("heading", { name: "Sport" })).toBeDefined();
  await select("All groups"); expect(groups.at(-1)).toBe("");
  expect(screen.getByRole("heading", { name: "News" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Sport" })).toBeDefined();
});

test("Go live uses the current channel and recording controls stay absent", async () => {
  const { GuidePanel } = await import("./GuidePanel");
  let calls = 0;
  const render = async (currentSource: string) => act(async () => root.render(<QueryClientProvider client={client}><GuidePanel credentials={{ origin: "http://localhost", token: "test" }} connected canPlay host={false} currentSource={currentSource} onGoLive={() => calls++} active run={async () => true} /></QueryClientProvider>));
  await render("iptv:news"); await flush();
  await click("Go live"); expect(calls).toBe(1);
  await click("Programs");
  expect(screen.queryByRole("button", { name: "Record programme" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Recordings" })).toBeNull();
  await click("Close");
  await render("https://ordinary.test/live.m3u8"); await flush();
  expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  expect(request.mock.calls.some((call: unknown[]) => String(call[0]).includes("/api/recordings"))).toBeFalse();
});
