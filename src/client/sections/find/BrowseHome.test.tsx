import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { HistoryItem, LibraryItem } from "../../../shared/library";
import type { SessionState } from "../../../shared/protocol";
import * as session from "../../session/session";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const played: unknown[] = [], browsed: string[] = [], requests: string[] = [];
const added: HistoryItem[] = [];
let failed = false;
const profile = { id: "household", name: "MBP", createdAt: 1 };
const unfinished = { mediaId: "library:movie", libraryItemId: "movie", title: "Halfway home", position: 120, duration: 600, watched: false, lastPlayedAt: 1 } satisfies HistoryItem;
const libraryItem = { id: "next", title: "A library film", kind: "video", duration: 120, artist: null, album: null, available: true } satisfies LibraryItem;
const state: SessionState = {
  queue: [{ id: "current", title: "Evening radio", source: "https://example.com/live", kind: "radio" }], currentEntryId: "current", activeProfile: profile, administratorClaimed: true, setupStep: "complete",
  player: { playbackId: "playback", status: "paused", position: 12, duration: 100, volume: 30, seekable: true, error: null },
};
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function renderHome(connected = true, active = true, canPlay = true, value = state) {
  const { BrowseHome } = await import("./BrowseHome");
  await act(async () => root.render(<BrowseHome state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} active={active} canPlay={canPlay} playing={false} onBrowse={name => browsed.push(name)} onAddSource={() => {}} onAdd={async item => { added.push(item); return true; }} onPlay={async (...args) => { played.push(args); return true; }} />));
}
beforeEach(async () => {
  played.length = 0; added.length = 0; browsed.length = 0; requests.length = 0; failed = false;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "location", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    requests.push(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (String(input).includes("/api/library/items")) return Response.json({ items: [libraryItem], total: 1, offset: 0, limit: 24 });
    return failed ? Response.json({ error: "History unavailable" }, { status: 503 }) : Response.json({ profile, items: [unfinished, { ...unfinished, mediaId: "finished", title: "Finished film", watched: true }, { ...unfinished, mediaId: "started", title: "No progress", position: 0 }] });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("browse home uses one history for continued and finished playback and preserves resume and restart commands", async () => {
  await renderHome();
  expect(document.body.textContent).not.toContain("MBP");
  expect(document.body.textContent).not.toContain("Good morning");
  expect(document.body.textContent).not.toContain("Watching as");
  expect(document.body.textContent).toContain("Halfway home");
  expect(document.body.textContent).toContain("Finished film");
  expect(document.body.textContent).toContain("No progress");
  expect(played).toEqual([]);
  await act(async () => button("Resume Halfway home").click());
  await act(async () => button("Details").click());
  expect(played).toHaveLength(1);
  await act(async () => button("Play Halfway home from start").click());
  expect(played).toEqual([[unfinished, { fromStart: false }], [unfinished, { fromStart: true }]]);
  await act(async () => button("Add source").click());
  expect(browsed).toEqual([]);
});
test("hidden home does not fetch and unavailable playback does not prevent browsing", async () => {
  await renderHome(true, false); expect(requests).toEqual([]);
  await renderHome(true, true, false); expect(button("Resume Halfway home").disabled).toBe(true);
  expect(button("Details for Finished film").disabled).toBe(false);
  await renderHome(false); expect(button("Resume Halfway home").disabled).toBe(true);
});
test("home history failure has an independent retry", async () => {
  failed = true; await renderHome(); expect(document.body.textContent).toContain("History unavailable");
  failed = false; await act(async () => button("Try again").click());
  expect(document.body.textContent).toContain("Halfway home"); expect(requests).toHaveLength(4);
});
test("library artwork cards open details without playback and retain actual library identity", async () => {
  await renderHome();
  await act(async () => button("Details for A library film").click());
  expect(played).toEqual([]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("TV folders");
  await act(async () => button("Add to queue: A library film").click());
  expect(added).toEqual([{ mediaId: "library:next", libraryItemId: "next", title: "A library film", position: 0, duration: 120, watched: false, lastPlayedAt: null }]);
  expect(played).toEqual([]);
  await act(async () => button("Save A library film for later").click());
  const saved = request.mock.calls.find(([input]: Parameters<typeof fetch>) => String(input).endsWith("/api/for-later"));
  expect(saved?.[1]?.method).toBe("POST");
  expect(JSON.parse(String(saved?.[1]?.body))).toEqual({ reference: { kind: "library", id: "next" } });
  expect(played).toEqual([]);
  await act(async () => button("Play now A library film").click());
  expect(played).toEqual([[{ mediaId: "library:next", libraryItemId: "next", title: "A library film", position: 0, duration: 120, watched: false, lastPlayedAt: null }, { fromStart: false }]]);
});


test("online album tracks and Jellyfin remain playable in the same history after leaving the queue", async () => {
  const items: HistoryItem[] = [
    { mediaId: "media:album", title: "Album track", libraryItemId: null, position: 45, duration: 240, watched: false, lastPlayedAt: 3, playable: true, thumbnail: "https://example.com/album.jpg", sourceLabel: "Online" },
    { mediaId: "media:jellyfin", title: "Server movie", libraryItemId: null, position: 90, duration: 900, watched: false, lastPlayedAt: 2, playable: true, sourceLabel: "Jellyfin" },
  ];
  request.mockImplementation((async input => String(input).includes("/api/library/items") ? Response.json({ items: [] }) : Response.json({ profile, items })) as typeof fetch);
  await renderHome();
  expect(button("Resume Album track").disabled).toBe(false);
  expect(document.querySelector<HTMLImageElement>('section[aria-label="Continue watching"] img')?.src).toBe("https://example.com/album.jpg");
  await act(async () => button("Resume Album track").click());
  expect(played).toEqual([[items[0], { fromStart: false }]]);
  await act(async () => button("Details for Server movie").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Jellyfin");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Open this file");
  expect(button("Resume Server movie").disabled).toBe(false);
  await act(async () => button("Play Server movie from start").click());
  expect(played.at(-1)).toEqual([items[1], { fromStart: true }]);
});


test("an empty TV home offers catalog browsing without a local-file placeholder", async () => {
  request.mockImplementation((async (_input: RequestInfo | URL) => Response.json({ profile, items: [] })) as typeof fetch);
  await renderHome();
  expect(document.body.textContent).not.toContain("From your library");
  expect(document.body.textContent).not.toContain("Library folders are managed");
  expect(document.querySelector('section[aria-label="Continue watching"]')).toBeNull();
  expect(button("Add source")).toBeDefined();
  expect(played).toEqual([]);
});


test.each(["history", "library"] as const)("Home %s details update watched state and clear resume using the current response", async source => {
  let item: HistoryItem = { mediaId: source === "history" ? "media:generic" : "library:next", libraryItemId: source === "history" ? null : "next", title: source === "history" ? "A saved file" : libraryItem.title, position: 45, duration: 120, watched: false, lastPlayedAt: 1 };
  const changes: unknown[] = [];
  request.mockImplementation((async (input, init) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method === "POST") {
      expect(url.pathname).toBe(`/api/progress/${encodeURIComponent(item.mediaId)}`);
      const body = JSON.parse(String(init.body));
      changes.push(body);
      item = { ...item, ...(body.watched === undefined ? {} : { watched: body.watched }), ...(body.clearResume ? { position: 0 } : {}) };
      return Response.json({ ok: true });
    }
    return Response.json({ profile, items: url.pathname === "/api/library/items" ? source === "library" ? [{ ...libraryItem, progress: item }] : [] : source === "history" ? [item] : [] });
  }) as typeof fetch);
  await renderHome();
  await act(async () => button(source === "history" ? "Details" : `Details for ${item.title}`).click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Continue from 0:45");
  await act(async () => button(`Watching options for ${item.title}`, dialog).click());
  await act(async () => button("Mark watched").click());
  await act(async () => button(`Watching options for ${item.title}`, dialog).click());
  expect(button("Mark unwatched")).toBeDefined();
  await act(async () => button("Mark unwatched").click());
  await act(async () => button(`Watching options for ${item.title}`, dialog).click());
  expect(button("Mark watched")).toBeDefined();
  await act(async () => button("Clear resume point").click());
  expect(dialog.textContent).not.toContain("Continue from");
  await act(async () => button(`Watching options for ${item.title}`, dialog).click());
  expect(button("Clear resume point")).toBeUndefined();
  expect(changes).toEqual([{ watched: true }, { watched: false }, { clearResume: true }]);
  expect(played).toEqual([]);
});

test.each(["history", "library"] as const)("Home %s details follow version updates and close when their item disappears", async source => {
  let progress = { position: 45, duration: 120, watched: false, lastPlayedAt: 1 };
  let title = "Original title";
  let removed = false;
  request.mockImplementation((async input => {
    const library = String(input).includes("/api/library/items");
    return Response.json({ profile, items: removed ? [] : library ? source === "library" ? [{ ...libraryItem, title, progress }] : [] : source === "history" ? [{ mediaId: "media:generic", libraryItemId: null, title, ...progress }] : [] });
  }) as typeof fetch);
  await renderHome();
  await act(async () => button(source === "history" ? "Details" : `Details for ${title}`).click());
  title = "Updated title";
  progress = { ...progress, position: 0, watched: true };
  await renderHome(true, true, true, { ...state, libraryVersion: 1 });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(title);
  expect(dialog.textContent).not.toContain("Continue from");
  await act(async () => button(`Watching options for ${title}`, dialog).click());
  expect(button("Mark unwatched")).toBeDefined();
  removed = true;
  await renderHome(true, true, true, { ...state, libraryVersion: 2 });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(played).toEqual([]);
});
