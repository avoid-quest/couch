import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

let root: Root, window: Window, tick: () => void;
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
const titles = () => [...document.querySelectorAll(".guide-program-list li h3")].map(node => node.firstChild?.textContent);
const heading = () => document.querySelector(".guide-day h3")?.textContent;
const dateLabel = (date: Date) => date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };

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
    return Response.json({ authority: "controller" });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { GuidePanel } = await import("./GuidePanel");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<GuidePanel origin="http://localhost" token="test" connected canPlay host={false} version={1} controllerVersion={1} onGoLive={() => {}} active />));
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

test("open program list advances its range and airing identities at local midnight while retaining the selected day offset", async () => {
  await click("Programs");
  expect(titles()).toEqual(["airing-0"]);
  expect(heading()).toBe(dateLabel(new Date(2026, 9, 24)));
  programGate = Promise.withResolvers<void>();
  await act(async () => { setSystemTime(new Date(2026, 9, 25, 0, 0, 30)); tick(); }); await flush();
  expect(ranges.at(-1)).toEqual({ start: new Date(2026, 9, 25).getTime(), end: new Date(2026, 9, 26).getTime() });
  expect(titles()).toEqual([]);
  expect(heading()).toBe(dateLabel(new Date(2026, 9, 25)));
  programGate.resolve(); programGate = null; await flush();
  expect([...document.querySelectorAll(".guide-program-list li")].map(node => node.getAttribute("data-program-id"))).toEqual(["airing-1"]);
  expect(titles()).toEqual(["airing-1"]);
  expect(heading()).toBe(dateLabel(new Date(2026, 9, 25)));
  expect(ranges.at(-1)!.end - ranges.at(-1)!.start).toBe(25 * 3_600_000);
  await click("Next day");
  expect(titles()).toEqual(["airing-2"]);
  await act(async () => { setSystemTime(new Date(2026, 9, 26, 0, 0, 30)); tick(); }); await flush();
  expect(ranges.at(-1)).toEqual({ start: new Date(2026, 9, 27).getTime(), end: new Date(2026, 9, 28).getTime() });
  expect(titles()).toEqual(["airing-3"]);
  expect(heading()).toBe(dateLabel(new Date(2026, 9, 27)));
});

test("the real group all is distinct from All groups in the rendered Select and requests", async () => {
  const select = async (label: string) => {
    await act(async () => document.querySelector("#guide-group")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === label)!;
    expect(option).toBeDefined();
    await act(async () => { option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); option.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
  };
  await select("all");
  expect(groups.at(-1)).toBe("all");
  expect([...document.querySelectorAll(".guide-channel")].map(node => node.getAttribute("data-channel-id"))).toEqual(["news"]);
  await select("Sport"); expect(groups.at(-1)).toBe("Sport");
  expect([...document.querySelectorAll(".guide-channel")].map(node => node.getAttribute("data-channel-id"))).toEqual(["sport"]);
  await select("All groups"); expect(groups.at(-1)).toBe("");
  expect([...document.querySelectorAll(".guide-channel")].map(node => node.getAttribute("data-channel-id"))).toEqual(["news", "sport"]);
});


test("Go live invokes its explicit current-playback callback without ordinary Play", async () => {
  const { GuidePanel } = await import("./GuidePanel");
  let calls = 0;
  const render = async (currentSource: string) => act(async () => root.render(<GuidePanel origin="http://localhost" token="test" connected canPlay host={false} version={1} controllerVersion={1} currentSource={currentSource} onGoLive={() => calls++} active />));
  await render("iptv:news"); await flush();
  const before = request.mock.calls.length;
  await click("Go live");
  expect(calls).toBe(1);
  expect(request.mock.calls.slice(before).some((call: unknown[]) => String(call[0]).endsWith("/play"))).toBeFalse();
  await render("https://ordinary.test/live.m3u8"); await flush();
  expect(button("Go live")).toBeUndefined();
});
