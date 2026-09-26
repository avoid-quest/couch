import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { toast } from "sonner";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "@/session/gate-context";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const writes: Array<{ path: string; method: string; body: unknown }> = [];
const playlist = { id: "friday", name: "Friday night", revision: 3, updatedAt: 1, source: null, entries: [{ id: "movie", title: "Evening movie" }] };
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const flush = () => act(async () => { await Bun.sleep(15); });
const click = async (node: HTMLElement) => { await act(async () => node.click()); await flush(); };
// The session's Undo toast, as SessionGate offers it.
const session = { state: null, offerUndo: (text: string, undo: () => Promise<void>, duration = 6_000) => toast(text, { duration, action: { label: "Undo", onClick: () => void undo() } }) };
const render = async (queueCount = 1) => {
  const { SavedPlaylists } = await import("./SavedPlaylists");
  await act(async () => root.render(<QueryClientProvider client={queryClient}><SessionGateContext.Provider value={session as never}><SavedPlaylists origin="http://localhost" token="paired" connected canPlay queueCount={queueCount} /></SessionGateContext.Provider></QueryClientProvider>));
  await flush();
};
const undo = async () => {
  const latest = toast.getToasts().at(-1);
  const action = latest && "action" in latest ? latest.action : undefined;
  expect(latest && "duration" in latest ? latest.duration : null).toBe(6_000);
  expect(action && typeof action === "object" && "label" in action ? action.label : null).toBe("Undo");
  await act(async () => { if (action && typeof action === "object" && "onClick" in action) action.onClick({} as React.MouseEvent<HTMLButtonElement>); });
  await flush();
};

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
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true, ...(init.method === "DELETE" ? { undoToken: "restore-token" } : {}) }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...playlist, entryCount: 1, totalDuration: 2700 }] } : { playlist });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { queryClient.clear();
  await act(async () => root.unmount()); toast.dismiss(); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("Lists opens a list, queues it and offers Undo after deletion", async () => {
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[data-playlist-id="friday"]')?.hasAttribute("data-nav-row")).toBe(true);
  await click(button("Open Friday night"));
  expect(document.querySelector("h1")?.textContent).toBe("Friday night");
  expect(document.activeElement?.hasAttribute("data-back")).toBe(true);
  expect(button("Remove Evening movie from list").closest("li")?.hasAttribute("data-nav-row")).toBe(true);
  expect(writes).toEqual([]);
  await click(button("Queue"));
  expect(writes).toEqual([{ path: "/api/playlists/friday/load", method: "POST", body: { revision: 3, mode: "append" } }]);
  expect(toast.getToasts().at(-1)).toMatchObject({ title: "Queued Friday night." });
  await click(button("Delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/friday", method: "DELETE", body: { revision: 3 } });
  expect(document.querySelector("h1")?.textContent).toBe("Lists");
  await undo();
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/restore", method: "POST", body: { token: "restore-token" } });
});

test("Lists shows total length and saves Up next with its generated name", async () => {
  await render(2);
  expect(document.querySelector('[data-playlist-id="friday"]')?.textContent).toContain("1 item · 45:00");
  await click(button("Save Up next as a list"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists", method: "POST", body: { name: expect.stringMatching(/^Up next, /), scope: "upNext" } });
  await click(button("Open Friday night"));
  await click(button("Lists"));
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Friday night");
});

test("Update from Up next confirms before replacing the list", async () => {
  await render(2);
  await click(button("Open Friday night"));
  await click(button("Update from Up next"));
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Its items become the 2 in Up next.");
  expect(writes).toEqual([]);
  await click(button("Replace"));
  expect(writes).toEqual([{ path: "/api/playlists/friday", method: "POST", body: { revision: 3, operation: "saveQueue" } }]);
});

test("an empty Up next cannot be saved and says why", async () => {
  await render(0);
  expect(button("Save Up next as a list").disabled).toBe(true);
  expect(document.body.textContent).toContain("Queue something first.");
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

for (const [provider, source] of Object.entries(sources)) test(`${provider} source-saved playlists show the provider and load and remove like queue saves`, async () => {
  const saved = { id: "source-list", name: "Evening list", revision: 2, updatedAt: 1, source, entries: [{ id: "ep-1", title: "Pilot", duration: 2700 }] };
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true, ...(init.method === "DELETE" ? { undoToken: "restore-token" } : {}) }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...saved, entryCount: 1, totalDuration: 2700 }] } : { playlist: saved });
  }) as typeof fetch);
  await render();
  expect(document.querySelector('[data-playlist-id="source-list"]')?.textContent).toContain(`${providerLabels[provider as keyof typeof sources]} · 1 item`);
  await click(button("Open Evening list"));
  expect(writes).toEqual([]);
  await click(button("Queue"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list/load", method: "POST", body: { revision: 2, mode: "append" } });
  await click(button("Delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list", method: "DELETE", body: { revision: 2 } });
});
