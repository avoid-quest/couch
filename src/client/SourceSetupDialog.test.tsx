import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
let SourceSetupDialog: typeof import("./SourceSetupDialog")["SourceSetupDialog"];

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const writes: { path: string; body: unknown }[] = [];
let iptvFailure = false;
const flush = () => act(async () => { await Bun.sleep(20); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === name)!;
const click = async (name: string) => { await act(async () => { const target = button(name); if (target.getAttribute("role") === "tab") target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); target.click(); }); await flush(); };
async function type(id: string, value: string) {
  await act(async () => { const input = document.getElementById(id)!; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function Harness({ canManage = true }: { canManage?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><input aria-label="Existing search" defaultValue="evening jazz" /><button onClick={() => setOpen(true)}>Add source</button><SourceSetupDialog open={open} onOpenChange={setOpen} credentials={{ origin: "http://localhost", token: "paired" }} connected canManage={canManage} version={1} radioVersion={1} libraryVersion={1} /></>;
}
beforeEach(async () => {
  writes.length = 0; iptvFailure = false;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method === "POST") { writes.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({}); }
    if (path === "/api/controllers/me") return Response.json({ authority: "administrator" });
    if (path === "/api/jellyfin/connection") return Response.json({ connected: false, url: null });
    if (path === "/api/settings/streamingcommunity") return Response.json({ origin: "https://streamingcommunityz.academy" });
    if (path === "/api/iptv/sources" && iptvFailure) return Response.json({ error: "Guide unavailable" }, { status: 503 });
    return Response.json({ sources: [] });
  }) as typeof fetch);
  ({ SourceSetupDialog } = await import("./SourceSetupDialog"));
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("source setup opens current forms directly and restores the browsing trigger and query", async () => {
  await act(async () => root.render(<Harness />));
  const opener = button("Add source"); opener.focus(); await click("Add source");
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.getElementById("jellyfin-url")).not.toBeNull();
  await click("IPTV"); expect(document.getElementById("guide-playlist-url")).not.toBeNull();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await type("guide-source-name", "Evening TV"); await type("guide-playlist-url", "https://example.com/list.m3u"); await type("guide-xmltv-url", "https://example.com/guide.xml");
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush();
  expect(writes).toEqual([{ path: "/api/iptv/sources", body: { name: "Evening TV", playlistUrl: "https://example.com/list.m3u", guideUrl: "https://example.com/guide.xml" } }]);
  await click("Local folders"); expect(!!button("Add TV folder")).toBe(true);
  await click("Radio playlist"); expect(document.getElementById("radio-source-url")).not.toBeNull();
  await click("StreamingCommunity"); expect(document.getElementById("streamingcommunity-origin")).not.toBeNull();
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement === opener).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Existing search"]')?.value).toBe("evening jazz");
});

test("controllers receive a role explanation without loading administrator forms", async () => {
  await act(async () => root.render(<Harness canManage={false} />)); await click("Add source");
  expect(document.body.textContent).toContain("An administrator can add or update sources");
  expect(document.querySelector("form")).toBeNull();
  expect(request.mock.calls).toHaveLength(0);
});

test("IPTV read failure has its own retry and leaves other setup types reachable", async () => {
  iptvFailure = true;
  await act(async () => root.render(<Harness />)); await click("Add source"); await click("IPTV");
  expect(document.body.textContent).toContain("Guide unavailable");
  iptvFailure = false; await click("Retry IPTV sources");
  expect(document.body.textContent).not.toContain("Guide unavailable");
  await click("Jellyfin"); expect(document.getElementById("jellyfin-url")).not.toBeNull();
  expect(writes).toEqual([]);
});

test("reopening setup mounts the requested form without reading the last selected source", async () => {
  await act(async () => root.render(<Harness />)); await click("Add source");
  await click("IPTV"); await type("guide-source-name", "Unsubmitted draft"); await click("Close");
  request.mockClear(); await click("Add source");
  expect(document.getElementById("jellyfin-url")).not.toBeNull();
  expect(request.mock.calls.map(([input]: [RequestInfo | URL]) => new URL(String(input)).pathname)).toEqual(["/api/jellyfin/connection"]);
  await click("IPTV");
  expect(document.querySelector<HTMLInputElement>("#guide-source-name")!.value).toBe("");
});

test("changing the requested source mounts only that form even when setup is already open", async () => {
  const draw = async (source: "jellyfin" | "iptv" | "radio", open = true) => {
    await act(async () => root.render(<SourceSetupDialog open={open} onOpenChange={() => {}} source={source} credentials={{ origin: "http://localhost", token: "paired" }} connected canManage version={1} radioVersion={1} libraryVersion={1} />)); await flush();
  };
  await draw("jellyfin");
  request.mockClear(); await draw("iptv");
  expect(document.getElementById("guide-playlist-url")).not.toBeNull();
  expect(document.getElementById("jellyfin-url")).toBeNull();
  expect(request.mock.calls.map(([input]: [RequestInfo | URL]) => new URL(String(input)).pathname)).toEqual(["/api/controllers/me", "/api/iptv/sources"]);
  await draw("iptv", false);
  request.mockClear(); await draw("radio");
  expect(document.getElementById("radio-source-url")).not.toBeNull();
  expect(request.mock.calls.map(([input]: [RequestInfo | URL]) => new URL(String(input)).pathname)).toEqual(["/api/radio/sources"]);
});
