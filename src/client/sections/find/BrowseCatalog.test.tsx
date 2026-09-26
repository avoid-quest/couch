import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { BrowseMusic } from "./BrowseMusic";
import { BrowseRadio } from "./BrowseRadio";

const credentials = { origin: "http://localhost", token: "paired", installationId: "installation" };
const original = new Map<string, PropertyDescriptor | undefined>();
const paths: string[] = [], albums: unknown[] = [], tracks: unknown[] = [], commands: unknown[] = [];
let window: Window, root: Root, client: QueryClient, request: ReturnType<typeof spyOn>;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.getAttribute("aria-label") === name || value.textContent === name)!;
const flush = () => act(async () => { await Bun.sleep(20); });

beforeEach(async () => {
  paths.length = albums.length = tracks.length = commands.length = 0;
  window = new Window({ url: credentials.origin });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (url.pathname === "/api/library/music/artists") return Response.json({ items: [{ id: "artist", name: "Ada", albumCount: 1, trackCount: 1, artworkId: null }], total: 1 });
    if (url.pathname === "/api/library/music/albums") return Response.json({ items: [{ id: "album", title: "First", artist: "Ada", artworkId: null, trackCount: 1, duration: 120 }], total: 1 });
    if (url.pathname === "/api/library/music/albums/album") return Response.json({ album: { id: "album", title: "First", artist: "Ada", artworkId: null, trackCount: 1, duration: 120 }, items: [{ id: "track", title: "Opening", kind: "audio", artist: "Ada", artworkId: null, available: true, duration: 120 }] });
    if (url.pathname === "/api/radio/avoid") return Response.json({ stations: [{ id: "avoid", sourceId: "avoid-radio", name: "Late radio", url: "https://radio.example/live", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 }] });
    if (url.pathname === "/api/radio/avoid/programmes") return Response.json({ programmes: { avoid: { stationId: "avoid", provider: "radio.avoid.quest", title: "Night show", sampledAt: Date.now(), expiresAt: Date.now() + 60_000 } } });
    if (url.pathname === "/api/radio/playlists") return Response.json({ playlists: [{ id: "own", name: "My stations" }] });
    if (url.pathname === "/api/radio/playlists/own/stations") return Response.json({ stations: [{ id: "own-station", sourceId: "own", name: "My station", url: "https://radio.example/own", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 }] });
    if (url.pathname === "/api/radio/favorites") return Response.json({ favorites: [] });
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  original.clear();
});

test("music browsing opens an artist and album, then queues the album and a track", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><BrowseMusic credentials={credentials} connected canPlay active onBack={() => {}} onAlbum={async (...args) => { albums.push(args); return true; }} onTrack={async (...args) => { tracks.push(args); return true; }} /></QueryClientProvider>));
  await flush();
  expect(paths).toContain("/api/library/music/artists");
  await act(async () => button("Open Ada").click()); await flush();
  expect(paths).toContain("/api/library/music/albums");
  await act(async () => button("Open First").click()); await flush();
  expect(paths).toContain("/api/library/music/albums/album");
  await act(async () => button("Queue all").click());
  await act(async () => button("Queue Opening").click());
  expect(albums).toEqual([["album", false]]);
  expect(tracks).toEqual([["track", false]]);
});

test("radio browsing loads built-in and playlist stations without a search term", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><BrowseRadio {...credentials} connected canPlay active onBack={() => {}} onCommand={async action => { commands.push(action); return true; }} /></QueryClientProvider>));
  await flush();
  expect(paths).toContain("/api/radio/avoid");
  expect(button("Play Late radio")).toBeDefined();
  expect(document.body.textContent).toContain("Night show");
  await act(async () => button("Radio playlists").click()); await flush();
  expect(paths).toContain("/api/radio/playlists/own/stations");
  await act(async () => button("Play My station").click());
  expect(commands.at(-1)).toMatchObject({ type: "enqueueRadio", stationId: "own-station", playNow: true });
});
