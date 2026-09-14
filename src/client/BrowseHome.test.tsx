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
  for (const source of ["Library", "Find something to play", "Radio", "Live TV", "Jellyfin", "TV folders"]) await act(async () => button(source).click());
  expect(browsed).toEqual(["Library", "Search", "Radio", "Guide", "Jellyfin", "Files"]);
});
test("hidden home does not fetch and unavailable playback does not prevent browsing", async () => {
  await renderHome(true, false); expect(requests).toEqual([]);
  await renderHome(true, true, false); expect(button("Resume Halfway home").disabled).toBe(true);
  expect(button("Find something to play").disabled).toBe(false);
  await renderHome(false); expect(button("Resume Halfway home").disabled).toBe(true);
});
test("home history failure has an independent retry", async () => {
  failed = true; await renderHome(); expect(document.body.textContent).toContain("History unavailable");
  failed = false; await act(async () => button("Try again").click());
  expect(document.body.textContent).toContain("Halfway home"); expect(requests).toHaveLength(4);
});
test("a paired remote starts with its current TV session and can browse and search without changing playback", async () => {
  localStorage.setItem("couch.remote-token", "paired");
  const command = async (...args: unknown[]) => { played.push(args); };
  sessionMock = spyOn(session, "useSession").mockReturnValue({ state, status: "connected", details: null, identity: { authority: "controller", controller: { id: "desk", name: "Desk remote", role: "controller", createdAt: 1, lastSeenAt: 1 }, claimAvailable: false }, playerStatus: undefined, pairingRequired: false, reachable: true, connected: true, command, reconnect: () => {} });
  const { App } = await import("./App");
  const { CouchRouter } = await import("./routes");
  await act(async () => root.render(<CouchRouter native={false}><App /></CouchRouter>));
  expect(document.querySelector('[data-source="Home"]')?.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector(".session-home .media-title")?.textContent).toBe("Evening radio");
  expect(document.querySelector(".mode-switch, .source-nav")).toBeNull();
  const header = document.querySelector(".app-header")!;
  expect(header.textContent).toContain("Desk remote");
  expect(header.textContent).not.toContain("MBP");
  expect(header.querySelector('[aria-label^="Your name"], [aria-label^="Watching profile"]')).toBeNull();
  expect(header.querySelector(".header-status")?.lastElementChild?.tagName).toBe("TIME");
  const navigation = document.querySelector('[aria-label="Main navigation"]')!;
  expect([...navigation.querySelectorAll('a')].map(node => node.textContent)).toEqual(["Home", "Search", "Library", "Saved", "Up next", "Settings"]);
  await act(async () => button("Find something").click());
  expect(document.querySelector('[data-source="Search"]')?.getAttribute("aria-current")).toBe("page");
  expect(document.activeElement).toBe(document.querySelector('[data-source="Search"]'));
  request.mockResolvedValue(Response.json({ items: [{ id: "saved", title: "Saved evening film" }] }));
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Saved"]')!.click());
  expect(document.querySelector('[data-source="Saved"]')?.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector('[aria-label="Saved for later"]')?.textContent).toContain("Saved evening film");
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Settings"]')!.click());
  expect(document.querySelector('.settings-page:not([hidden])')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => navigation.querySelector<HTMLElement>('[data-source="Home"]')!.click());
  expect(document.querySelector('[data-page="Home"]')?.hasAttribute('hidden')).toBe(false);
  expect(window.location.pathname).toBe("/");
  await act(async () => { window.history.back(); await Bun.sleep(20); });
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.querySelector('[data-page="Settings"]')?.hasAttribute("hidden")).toBe(false);
  await act(async () => { window.history.forward(); await Bun.sleep(20); });
  expect(window.location.pathname).toBe("/");
  expect(localStorage.getItem("couch.remote-token")).toBe("paired");
  expect(state.player.playbackId).toBe("playback");
  expect(state.queue).toHaveLength(1); expect(played).toEqual([]);
  const { UiDriver } = await import("../../tests/linux/ui");
  const ui = new UiDriver(async () => { throw new Error("Unexpected native request"); }, () => "dom");
  ui.element = async selector => document.querySelector(selector) as unknown as string;
  ui.execute = async (script, args = []) => {
    const result = new Function("document", "args", `return (function () { ${script} }).apply(null, args)`)(document, args);
    return Array.isArray(result) ? result.map(element => ({ "element-6066-11e4-a52e-4f735466cecf": element })) : result;
  };
  ui.clickElement = async element => { await act(async () => (element as unknown as HTMLElement).click()); };
  ui.waitFor = async (_description, predicate) => { expect(await predicate()).toBe(true); };
  await ui.section("Search");
  expect(window.location.pathname).toBe("/search");
  await ui.button("Settings");
  expect(window.location.pathname).toBe("/settings/playback");
  request.mockImplementation((async input => Response.json(String(input).endsWith("/sources") ? { sources: [] } : String(input).endsWith("/favorites") ? { favorites: [] } : { items: [], total: 0, offset: 0, limit: 24 })) as typeof fetch);
  await ui.section("Files");
  expect(window.location.pathname).toBe("/browse/files");
  expect(document.querySelector('[data-page="Files"]:not([hidden]) h2')?.textContent).toBe("TV folders");
  expect(played).toEqual([]);
});

test("library artwork cards open details without playback and retain actual library identity", async () => {
  await renderHome();
  await act(async () => button("Details for A library film").click());
  expect(played).toEqual([]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("TV folders");
  await act(async () => button("Add A library film to Up next").click());
  expect(added).toEqual([{ mediaId: "library:next", libraryItemId: "next", title: "A library film", position: 0, duration: 120, watched: false, lastPlayedAt: null }]);
  expect(played).toEqual([]);
  await act(async () => button("Save A library film for later").click());
  const saved = request.mock.calls.find(([input]: Parameters<typeof fetch>) => String(input).endsWith("/api/for-later"));
  expect(saved?.[1]?.method).toBe("POST");
  expect(JSON.parse(String(saved?.[1]?.body))).toEqual({ reference: { kind: "library", id: "next" } });
  expect(played).toEqual([]);
  await act(async () => button("Play A library film").click());
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
  expect(document.querySelector('[aria-label="Browse media"]')?.hasAttribute("hidden")).toBe(false);
  await act(async () => button("Library").click());
  expect(browsed).toEqual(["Library"]);
  expect(played).toEqual([]);
});
