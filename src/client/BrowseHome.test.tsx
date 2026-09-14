import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { HistoryItem, LibraryItem } from "../shared/library";
import type { SessionState } from "../shared/protocol";
import * as session from "./session";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
let sessionMock: ReturnType<typeof spyOn> | undefined;
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
async function renderHome(connected = true, active = true, canPlay = true) {
  const { BrowseHome } = await import("./BrowseHome");
  await act(async () => root.render(<BrowseHome state={state} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} active={active} canPlay={canPlay} playing={false} onBrowse={name => browsed.push(name)} onAdd={async item => { added.push(item); return true; }} onPlay={async (...args) => { played.push(args); return true; }} />));
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
  await act(async () => root.unmount()); sessionMock?.mockRestore(); sessionMock = undefined;
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
  for (const source of ["Local library", "YouTube", "Radio directory & playlists", "Live TV", "Jellyfin"]) await act(async () => button(source).click());
  expect(browsed).toEqual(["Files", "Online", "Radio", "Guide", "Jellyfin"]);
});
test("hidden home does not fetch and unavailable playback does not prevent browsing", async () => {
  await renderHome(true, false); expect(requests).toEqual([]);
  await renderHome(true, true, false); expect(button("Resume Halfway home").disabled).toBe(true);
  expect(button("YouTube").disabled).toBe(false);
  await renderHome(false); expect(button("Resume Halfway home").disabled).toBe(true);
});
test("home history failure has an independent retry", async () => {
  failed = true; await renderHome(); expect(document.body.textContent).toContain("History unavailable");
  failed = false; await act(async () => button("Try again").click());
  expect(document.body.textContent).toContain("Halfway home"); expect(requests).toHaveLength(4);
});
async function renderApp(value = state, administrator = false) {
  localStorage.setItem("couch.remote-token", "paired");
  localStorage.setItem("couch.remote-installation-id", "living-room");
  request.mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (path === "/api/radio/avoid") return Response.json({ playlist: { id: "avoid", error: null }, stations: [] });
    if (path === "/api/settings/streamingcommunity") return Response.json({ origin: "https://streamingcommunityz.taxi" });
    if (path === "/api/for-later") return Response.json({ items: [{ id: "saved", title: "Saved evening film" }] });
    return Response.json({ profile, items: [], favorites: [], playlists: [], sources: [], stations: [], total: 0, offset: 0, limit: 24, configured: false });
  }) as typeof fetch);
  const role = administrator ? "administrator" as const : "controller" as const;
  sessionMock = spyOn(session, "useSession").mockReturnValue({ state: value, status: "connected", details: null, identity: { authority: role, controller: { id: "desk", name: "Desk remote", role, createdAt: 1, lastSeenAt: 1 }, claimAvailable: false }, playerStatus: undefined, pairingRequired: false, reachable: true, connected: true, command: async (...args: unknown[]) => { played.push(args); }, reconnect: () => {} });
  const { App } = await import("./App");
  const { CouchRouter } = await import("./routes");
  await act(async () => root.render(<CouchRouter native={false}><App /></CouchRouter>));
}
const frame = () => act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
async function searchHome(query: string) {
  await act(async () => {
    const search = document.querySelector<HTMLInputElement>("#media-search")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, query);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector('form[role="search"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

test("a paired remote starts on consolidated Home and keeps playback unchanged while browsing", async () => {
  await renderApp();
  expect(document.querySelector('[data-source="Home"]')?.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector('[data-page="Home"] h1')?.textContent).toBe("Find something to play");
  expect(document.querySelector("#media-search")).not.toBeNull();
  expect(document.querySelector(".session-bar strong")?.textContent).toBe("Evening radio");
  expect(document.querySelector(".now-playing, .mode-switch, .source-nav")).toBeNull();
  const header = document.querySelector(".app-header")!;
  expect(header.textContent).toContain("Desk remote");
  expect(header.textContent).not.toContain("MBP");
  expect(header.querySelector('[aria-label^="Your name"], [aria-label^="Watching profile"]')).toBeNull();
  expect(header.querySelector(".header-status")?.lastElementChild?.tagName).toBe("TIME");
  const navigation = document.querySelector('[aria-label="Main navigation"]')!;
  expect([...navigation.querySelectorAll('a')].map(node => node.textContent)).toEqual(["Home", "Saved", "Up next", "Settings"]);
  const query = "https://media.example/evening";
  await searchHome(query);
  expect(window.location.pathname).toBe("/");
  expect(new URLSearchParams(window.location.search).get("q")).toBe(query);
  expect(document.querySelector('[data-source="Home"]')?.getAttribute("aria-current")).toBe("page");
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Saved"]')!.click());
  expect(document.querySelector('[aria-label="Saved for later"]')?.textContent).toContain("Saved evening film");
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Settings"]')!.click());
  expect(document.querySelector('.settings-page:not([hidden])')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Home"]')!.click());
  expect(document.querySelector('[data-page="Home"]')?.hasAttribute('hidden')).toBe(false);
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe(query);
  await act(async () => { window.history.back(); await Bun.sleep(20); });
  expect(window.location.pathname).toBe("/settings/playback");
  await act(async () => { window.history.forward(); await Bun.sleep(20); });
  expect(window.location.pathname).toBe("/");
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe(query);
  expect(localStorage.getItem("couch.remote-token")).toBe("paired");
  expect(localStorage.getItem("couch.remote-installation-id")).toBe("living-room");
  expect(state.player.playbackId).toBe("playback");
  expect(state.queue).toHaveLength(1);
  expect(played).toEqual([]);
});

test("Now playing opens and returns to the preserved Home search and playback trigger", async () => {
  await renderApp();
  const query = "https://media.example/evening";
  await searchHome(query);
  const search = document.querySelector<HTMLInputElement>("#media-search")!;
  const trigger = button("Open Now playing: Evening radio");
  await act(async () => { trigger.focus(); trigger.click(); });
  await frame();
  expect(document.querySelector(".session-bar")).toBeNull();
  expect(document.querySelector(".now-playing .media-title")?.textContent).toBe("Evening radio");
  expect(document.activeElement === button("Back to browsing")).toBe(true);
  expect(search.isConnected).toBe(true);
  expect(search.closest("[hidden]")).not.toBeNull();
  await act(async () => button("Back to browsing").click());
  await frame();
  expect(document.querySelector(".now-playing")).toBeNull();
  expect(document.querySelector<HTMLInputElement>("#media-search") === search).toBe(true);
  expect(search.value).toBe(query);
  expect(search.closest("[hidden]")).toBeNull();
  expect(document.activeElement === button("Open Now playing: Evening radio")).toBe(true);
  expect(played).toEqual([]);
});

test("Stop in Now playing then Back restores Home focus after the playback bar is gone", async () => {
  await renderApp();
  await act(async () => { button("Open Now playing: Evening radio").focus(); button("Open Now playing: Evening radio").click(); });
  await act(async () => button("Stop playback").click());
  await renderApp({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(document.querySelector(".now-playing h1")?.textContent).toBe("Nothing playing");
  await act(async () => button("Back to browsing").click());
  await frame();
  expect(document.querySelector(".session-bar, .now-playing")).toBeNull();
  expect(document.activeElement === document.querySelector('.primary-nav [data-source="Home"]')).toBe(true);
  expect(played).toEqual([[{ type: "stop" }]]);
});

test("a terminal radio failure keeps Now playing and its retry reachable", async () => {
  const failed = { ...state, player: { ...state.player, status: "error" as const, error: "Radio unavailable" }, radioRetry: { attempt: 3, maximum: 3, retryAt: null } };
  await renderApp(failed);
  expect(button("Open Now playing: Evening radio").textContent).toContain("Playback error");
  await act(async () => button("Open Now playing: Evening radio").click());
  expect(document.querySelector(".now-playing")?.textContent).toContain("Radio unavailable");
  await act(async () => button("Try again").click());
  expect(played).toEqual([[{ type: "play", entryId: "current" }]]);
});

test("source setup opens directly from a pasted link and restores its search and trigger", async () => {
  await renderApp(state, true);
  const query = "https://streamingcommunityz.taxi/watch/evening";
  await searchHome(query);
  const trigger = button("StreamingCommunity settings");
  await act(async () => { trigger.focus(); trigger.click(); });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Add source");
  expect(dialog.querySelector<HTMLInputElement>("#streamingcommunity-origin")?.value).toBe("https://streamingcommunityz.taxi");
  expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("StreamingCommunity");
  await act(async () => button("Close", dialog).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>("#media-search")?.value).toBe(query);
  expect(new URLSearchParams(window.location.search).get("q")).toBe(query);
  expect(document.activeElement === trigger).toBe(true);
  expect(played).toEqual([]);
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
  expect(document.querySelector<HTMLImageElement>(".browse-hero img")?.src).toBe("https://example.com/album.jpg");
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
  expect(document.querySelector(".browse-empty, .browse-hero")).toBeNull();
  expect(document.querySelector('[aria-label="Browse sources"]')?.hasAttribute("hidden")).toBe(false);
  await act(async () => button("Local library").click());
  expect(browsed).toEqual(["Files"]);
  expect(played).toEqual([]);
});
