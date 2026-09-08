import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { HistoryItem } from "../shared/library";
import type { SessionState } from "../shared/protocol";
import * as session from "./session";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
let sessionMock: ReturnType<typeof spyOn> | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();
const played: unknown[] = [], browsed: string[] = [], requests: string[] = [];
let failed = false;
const profile = { id: "household", name: "Household", createdAt: 1 };
const unfinished = { mediaId: "library:movie", libraryItemId: "movie", title: "Halfway home", position: 120, duration: 600, watched: false, lastPlayedAt: 1 } satisfies HistoryItem;
const state: SessionState = {
  queue: [{ id: "current", title: "Evening radio", source: "https://example.com/live", kind: "radio" }], currentEntryId: "current", activeProfile: profile, administratorClaimed: true, setupStep: "complete",
  player: { playbackId: "playback", status: "paused", position: 12, duration: 100, volume: 30, seekable: true, error: null },
};
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function renderHome(connected = true, active = true, canPlay = true) {
  const { BrowseHome } = await import("./BrowseHome");
  await act(async () => root.render(<BrowseHome state={state} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} active={active} canPlay={canPlay} playing={false} onBrowse={name => browsed.push(name)} onPlay={async (...args) => { played.push(args); return true; }} />));
}
beforeEach(async () => {
  played.length = 0; browsed.length = 0; requests.length = 0; failed = false;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "location", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    requests.push(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
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
test("browse home offers only unfinished local history and preserves resume and restart commands", async () => {
  await renderHome();
  expect(document.body.textContent).toContain("Watching as");
  expect(document.body.textContent).toContain("Halfway home");
  expect(document.body.textContent).not.toContain("Finished film");
  expect(document.body.textContent).not.toContain("No progress");
  expect(played).toEqual([]);
  await act(async () => button("Resume Halfway home").click());
  await act(async () => button("Play Halfway home from start").click());
  expect(played).toEqual([[unfinished, { fromStart: false }], [unfinished, { fromStart: true }]]);
  for (const source of ["Search", "For later", "Library", "Online", "Guide", "Radio", "Jellyfin"]) await act(async () => button(source).click());
  expect(browsed).toEqual(["Search", "For later", "Library", "Online", "Guide", "Radio", "Jellyfin"]);
});
test("hidden home does not fetch and unavailable playback does not prevent browsing", async () => {
  await renderHome(true, false); expect(requests).toEqual([]);
  await renderHome(true, true, false); expect(button("Resume Halfway home").disabled).toBe(true);
  expect(button("Search").disabled).toBe(false);
  await renderHome(false); expect(button("Resume Halfway home").disabled).toBe(true);
});
test("home history failure has an independent retry", async () => {
  failed = true; await renderHome(); expect(document.body.textContent).toContain("History unavailable");
  failed = false; await act(async () => button("Try again").click());
  expect(document.body.textContent).toContain("Halfway home"); expect(requests).toHaveLength(2);
});
test("a paired remote starts with its current TV session and can browse and search without changing playback", async () => {
  localStorage.setItem("couch.remote-token", "paired");
  const command = async (...args: unknown[]) => { played.push(args); };
  sessionMock = spyOn(session, "useSession").mockReturnValue({ state, status: "connected", details: null, identity: { authority: "controller", controller: null, claimAvailable: false }, playerStatus: undefined, pairingRequired: false, reachable: true, connected: true, command, reconnect: () => {} });
  const { App } = await import("./App");
  await act(async () => root.render(<App />));
  expect(document.querySelector(".app-shell")?.classList.contains("remote-session")).toBe(true);
  expect(document.querySelector('[data-source="Queue"]')?.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".remote-controller .media-title")?.textContent).toBe("Evening radio");
  await act(async () => button("Browse", document.querySelector('[aria-label="Controller views"]')!).click());
  expect(document.querySelector('[data-source="Home"]')?.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".app-shell")?.classList.contains("remote-browse")).toBe(true);
  const searchShortcut = button("Search", document.querySelector('[aria-label="Browse media"]')!);
  searchShortcut.focus();
  expect(document.activeElement).toBe(searchShortcut);
  await act(async () => searchShortcut.click());
  expect(document.querySelector('[data-source="Search"]')?.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(document.querySelector('[data-source="Search"]'));
  request.mockImplementation((async () => Response.json({ items: [{ id: "saved", title: "Saved evening film" }] })) as typeof fetch);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-source="For later"]')!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
  expect(document.querySelector('[data-source="For later"]')?.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector('[aria-label="Saved for later"]')?.textContent).toContain("Saved evening film");
  await act(async () => button("On TV", document.querySelector('[aria-label="Controller views"]')!).click());
  expect(document.querySelector(".app-shell")?.classList.contains("remote-session")).toBe(true);
  expect(state.queue).toHaveLength(1); expect(played).toEqual([]);
});
