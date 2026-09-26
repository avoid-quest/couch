import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient, testWindow } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowseMusic } from "./BrowseMusic";
import { BrowseRadio } from "./BrowseRadio";

setupUiTests();

const credentials = { origin: "http://localhost", token: "paired", installationId: "installation" };
const paths: string[] = [], albums: unknown[] = [], tracks: unknown[] = [], commands: unknown[] = [];
let view: ReturnType<typeof renderUI>, client: QueryClient, request: ReturnType<typeof spyOn>;
const click = async (name: string) => userEvent.click(await screen.findByRole("button", { name }));

beforeEach(async () => {
  paths.length = albums.length = tracks.length = commands.length = 0;
  testWindow.happyDOM.setURL(credentials.origin);
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
  client = createTestQueryClient();
  view = renderUI(<></>);
});

test("music browsing opens an artist and album, then queues the album and a track", async () => {
  await act(async () => view.rerender(<QueryClientProvider client={client}><BrowseMusic credentials={credentials} connected canPlay active onBack={() => {}} onAlbum={async (...args) => { albums.push(args); return true; }} onTrack={async (...args) => { tracks.push(args); return true; }} /></QueryClientProvider>));
  expect(paths).toContain("/api/library/music/artists");
  await click("Open Ada");
  expect(paths).toContain("/api/library/music/albums");
  await click("Open First");
  expect(paths).toContain("/api/library/music/albums/album");
  await click("Queue all");
  await click("Queue Opening");
  expect(albums).toEqual([["album", false]]);
  expect(tracks).toEqual([["track", false]]);
});

test("radio browsing loads built-in and playlist stations without a search term", async () => {
  await act(async () => view.rerender(<QueryClientProvider client={client}><BrowseRadio {...credentials} connected canPlay active onBack={() => {}} onCommand={async action => { commands.push(action); return true; }} /></QueryClientProvider>));
  expect(paths).toContain("/api/radio/avoid");
  expect(await screen.findByRole("button", { name: "Play Late radio" })).toBeEnabled();
  expect(await screen.findByText("Night show")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "Radio playlists" }));
  expect(paths).toContain("/api/radio/playlists/own/stations");
  await click("Play My station");
  expect(commands.at(-1)).toMatchObject({ type: "enqueueRadio", stationId: "own-station", playNow: true });
});
