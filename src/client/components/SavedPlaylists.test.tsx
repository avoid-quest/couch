import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const writes: Array<{ path: string; method: string; body: unknown }> = [];
const playlist = { id: "friday", name: "Friday night", revision: 3, updatedAt: 1, source: null, entries: [{ id: "movie", title: "Evening movie" }] };
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const flush = () => act(async () => { await Bun.sleep(15); });
const click = async (node: HTMLElement) => { await act(async () => node.click()); await flush(); };

beforeEach(async () => {
  writes.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...playlist, entryCount: 1 }] } : { playlist });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

for (const inline of [false, true]) test(`${inline ? "Saved page" : "Queue dialog"} reuses authenticated playlist loading and deletion confirmation`, async () => {
  const { SavedPlaylists } = await import("./SavedPlaylists");
  await act(async () => root.render(<SavedPlaylists origin="http://localhost" token="paired" connected canPlay version={1} queueCount={1} inline={inline} />));
  await flush();
  if (inline) expect(document.querySelector('[role="dialog"]')).toBeNull();
  else { expect(request).not.toHaveBeenCalled(); await click(button("Saved lists")); }
  await click(document.querySelector<HTMLButtonElement>('[data-playlist-id="friday"]')!);
  expect(document.querySelector('[data-slot="badge"]')).toBeNull();
  expect(writes).toEqual([]);
  await click(button("Up next"));
  expect(writes).toEqual([{ path: "/api/playlists/friday/load", method: "POST", body: { revision: 3, mode: "append" } }]);
  await click(button("Delete list"));
  expect(writes).toHaveLength(1);
  await click(button("Cancel"));
  expect(writes).toHaveLength(1);
  await click(button("Delete list")); await click(button("Confirm delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/friday", method: "DELETE", body: { revision: 3 } });
});

const sources = {
  youtube: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" },
  raiplay: { provider: "raiplay", url: "https://www.raiplay.it/programmi/report" },
  bandcamp: { provider: "bandcamp", url: "https://artist.bandcamp.com/album/public" },
  // Shaped like the StreamingCommunity title saves from #345: the resolved
  // title name with capturePlaylistEntries-shaped entries.
  streamingcommunity: { provider: "streamingcommunity", url: "https://streamingcommunityz.academy/title/1234" },
} as const;
const providerLabels = { youtube: "YouTube", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };

for (const [provider, source] of Object.entries(sources)) test(`${provider} source-saved playlists show the provider badge and load and remove like queue saves`, async () => {
  const saved = { id: "source-list", name: "Evening list", revision: 2, updatedAt: 1, source, entries: [{ id: "ep-1", title: "Pilot", duration: 2700 }] };
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...saved, entryCount: 1 }] } : { playlist: saved });
  }) as typeof fetch);
  const { SavedPlaylists } = await import("./SavedPlaylists");
  await act(async () => root.render(<SavedPlaylists origin="http://localhost" token="paired" connected canPlay version={1} queueCount={1} />));
  await click(button("Saved lists"));
  expect(document.querySelector('[data-slot="badge"]')?.textContent).toBe(providerLabels[provider as keyof typeof sources]);
  await click(document.querySelector<HTMLButtonElement>('[data-playlist-id="source-list"]')!);
  expect(writes).toEqual([]);
  await click(button("Up next"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list/load", method: "POST", body: { revision: 2, mode: "append" } });
  await click(button("Delete list")); await click(button("Confirm delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list", method: "DELETE", body: { revision: 2 } });
});
