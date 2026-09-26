import { setupUiTests, render as renderUI, act, screen, within, fireEvent, waitFor, userEvent, createTestQueryClient } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test, jest } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { toast, Toaster } from "sonner";
import type { Action } from "../../../shared/protocol";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";

setupUiTests();
afterEach(() => toast.dismiss());
let view: ReturnType<typeof renderUI>, queryClient: QueryClient;
const paths: string[] = [], queued: unknown[] = [];
let empty = false;
const commands: Action[] = [];
let integrated = false, youtubeError = false;
let onlineFavorites: ProviderItem[] = [], radioFavorites: RadioStation[] = [];
const video: ProviderItem = { id: "yt-video", provider: "youtube", kind: "media", title: "Evening video", subtitle: "An artist", url: "https://www.youtube.com/watch?v=abcdefghijk" };
const collection: ProviderItem = { id: "yt-list", provider: "youtube", kind: "collection", title: "Evening collection", url: "https://www.youtube.com/playlist?list=PLabc" };
const station: RadioStation = { id: "station-one", sourceId: "own", name: "Evening radio", url: "https://radio.example/live", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
const local = { id: "local", title: "Evening movie", kind: "video", artist: null, album: null, available: true, duration: 180, video: { type: "movie", plot: "An evening story" }, progress: { position: 12 } };
const button = (name: string) => screen.queryByRole("button", { name });
const click = async (name: string) => userEvent.click(await screen.findByRole("button", { name }));
async function search(query: string) {
  const user = userEvent.setup();
  const input = screen.getByRole("searchbox");
  await user.clear(input);
  await user.type(input, `${query}{Enter}`);
}
async function render() {
  const { SearchPanel } = await import("./SearchPanel");
  view.rerender(<QueryClientProvider client={queryClient}><Toaster /><SearchPanel origin="http://localhost" token="paired" connected canPlay active defaultQuality="1080p" onCommand={async command => { commands.push(command); return true; }} onEnqueue={async (...args) => { queued.push(args); return true; }} /></QueryClientProvider>);
}
beforeEach(async () => {
  commands.length = 0; integrated = youtubeError = false; onlineFavorites = []; radioFavorites = [];
  paths.length = 0; queued.length = 0; empty = false;
  queryClient = createTestQueryClient();
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (url.pathname === "/api/providers/favorites") {
      if (init?.method === "POST") onlineFavorites.push(JSON.parse(String(init.body)).item);
      return Response.json({ favorites: onlineFavorites });
    }
    if (url.pathname.startsWith("/api/providers/favorites/")) { onlineFavorites = onlineFavorites.filter(item => item.id !== url.pathname.split("/").at(-1)); return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/radio/favorites") {
      if (init?.method === "POST") radioFavorites.push(JSON.parse(String(init.body)).station);
      return Response.json({ favorites: radioFavorites });
    }
    if (url.pathname.startsWith("/api/radio/favorites/")) { radioFavorites = radioFavorites.filter(item => item.id !== url.pathname.split("/").at(-1)); return new Response(null, { status: 204 }); }
    if (url.pathname === "/api/providers/youtube/items") {
      if (youtubeError) return Response.json({ error: "YouTube is temporarily unavailable" }, { status: 502 });
      return Response.json({ items: integrated ? url.searchParams.get("url") ? [{ ...video, id: "collection-video", title: "Collection episode" }] : url.searchParams.get("cursor") ? [{ ...video, id: "yt-more", title: "Another video" }] : [video, collection] : [], ...(!url.searchParams.has("url") && !url.searchParams.has("cursor") && integrated ? { nextCursor: "24" } : {}) });
    }
    if (url.pathname === "/api/providers/raiplay/items" && url.searchParams.get("url")?.endsWith("/dirette")) return Response.json({ items: [{ id: "rai-one", provider: "raiplay", title: "Rai 1", kind: "media", live: true, url: "https://www.raiplay.it/dirette/rai1" }] });
    if (url.pathname === "/api/providers/bandcamp/items") return Response.json({ title: "Public album", items: [{ id: "bc-track", provider: "bandcamp", kind: "media", title: "Album track", url: "https://artist.bandcamp.com/track/one" }] });
    if (url.pathname.startsWith("/api/providers/")) return Response.json({ items: [] });
    if (url.pathname === "/api/radio/playlists") return Response.json({ playlists: integrated ? [{ id: "own", name: "My radio" }] : [] });
    if (url.pathname === "/api/radio/playlists/own/stations") return Response.json({ stations: integrated ? [station] : [] });
    if (url.pathname === "/api/radio/avoid/programmes") return Response.json({ programmes: {} });
    if (url.pathname === "/api/radio/avoid") return Response.json({ stations: [] });
    if (url.pathname === "/api/radio/stations") return Response.json({ stations: integrated ? [{ ...station, sourceId: undefined, id: "directory-one", name: "Directory radio" }] : [] });
    if (url.pathname === "/api/jellyfin") return Response.json({ connected: true, serverName: "Home" });
    if (url.pathname === "/api/jellyfin/items") return Response.json({ items: empty ? [] : [{ id: url.searchParams.get("startIndex") === "50" ? "remote-next" : "remote", title: "Evening song", kind: "Audio", detail: "Artist", duration: 80, resumePosition: 0, played: false }], total: empty ? 0 : 55, startIndex: Number(url.searchParams.get("startIndex")) });
    if (url.pathname.endsWith("/sources")) return Response.json({ sources: [{ name: "NAS", status: "ready" }] });
    return Response.json({ items: empty ? [] : [{ ...local, id: url.searchParams.get("offset") === "30" ? "local-next" : local.id, available: true, title: url.searchParams.get("q") === "new" ? "New movie" : local.title }], total: empty ? 0 : 40, offset: Number(url.searchParams.get("offset")), limit: 30 });
  }) as typeof fetch);
  view = renderUI(<></>);
});


test("Find merges local, Jellyfin, provider and radio results with direct actions", async () => {
  integrated = true; await render(); await search("Evening");
  await screen.findByRole("button", { name: "Play Evening video" });
  for (const label of ["Resume Evening movie", "Play Evening song", "Play Evening video", "Play Evening radio"]) expect(button(label)).toBeInTheDocument();
  for (const path of ["/api/providers/youtube/items?q=Evening", "/api/radio/playlists/own/stations?q=Evening", "/api/library/items?q=Evening&offset=0&limit=30"]) expect(paths).toContain(path);
  await click("Queue Evening movie"); expect(queued.at(-1)).toEqual(["Library", "local", undefined]);
  expect(toast.getToasts()).toHaveLength(0);
  await click("Play Evening video"); expect(commands.at(-1)).toMatchObject({ type: "enqueueProvider", url: video.url, playNow: true });
});

test("playback, queueing and save toggles stay quiet", async () => {
  integrated = true; await render(); await search("Evening");
  await screen.findByRole("button", { name: "Play Evening video" });
  await click("Resume Evening movie");
  await click("Play Evening video");
  await click("Play Evening radio");
  await click("Save Evening radio");
  await click("Saved Evening radio");
  await click("Save Evening collection");
  await click("Saved Evening collection");
  expect(toast.getToasts()).toHaveLength(0);
  await click("Queue Evening radio");
  await click("Play next Evening video");
  expect(toast.getToasts()).toHaveLength(0);
});

test("opening and leaving a collection restores focus to its result", async () => {
  integrated = true; await render(); await search("Evening");
  await screen.findByRole("button", { name: "Open Evening collection" });
  await click("Open Evening collection");
  await screen.findByRole("button", { name: "Play Collection episode" });
  expect(document.activeElement).toBe(button("Results"));
  await click("Results");
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Evening collection" })).toHaveFocus());
});

test("one failed provider stays visible as feedback while other results work, and retry is independent", async () => {
  integrated = true; youtubeError = true; await render(); await search("Evening");
  await screen.findByText("YouTube is temporarily unavailable");
  expect(button("Resume Evening movie")).toBeInTheDocument();
  expect(button("Play Evening radio")).toBeInTheDocument();
  const raiCount = paths.filter(path => path.includes("raiplay/items")).length;
  youtubeError = false; await click("Try again");
  await screen.findByRole("button", { name: "Play Evening video" });
  expect(paths.filter(path => path.includes("raiplay/items"))).toHaveLength(raiCount);
});

test("local and provider pagination controls are available in the merged Find view", async () => {
  integrated = true; await render(); await search("Evening");
  await screen.findByRole("button", { name: "More from Folders" });
  await click("More from Folders");
  expect(paths).toContain("/api/library/items?q=Evening&offset=30&limit=30");
  await click("More from YouTube");
  await screen.findByRole("button", { name: "Play Another video" });
  expect(paths).toContain("/api/providers/youtube/items?q=Evening&cursor=24");
});

test("empty results and filters give a way back", async () => {
  empty = true; await render(); await search("nothing");
  await screen.findByRole("heading", { name: "Nothing found for “nothing”" });
  empty = false; await search("Evening");
  await screen.findByRole("button", { name: "Resume Evening movie" });
  await screen.findByRole("button", { name: "Play Evening song" });
  const what = screen.getByRole("radiogroup", { name: "What filter" });
  await userEvent.click(within(what).getByRole("radio", { name: /^Video/ }));
  await waitFor(() => expect(screen.queryAllByRole("button", { name: "Play Evening song" })).toHaveLength(0));
  expect(button("Resume Evening movie")).toBeInTheDocument();
  await userEvent.click(within(what).getByRole("radio", { name: /^All/ }));
  expect(screen.getByRole("button", { name: "Play Evening song" })).toBeInTheDocument();
});

test("focus moves to a real result when the focused result is filtered away", async () => {
  integrated = true; await render(); await search("Evening");
  await screen.findByRole("button", { name: "Resume Evening movie" });
  await screen.findByRole("button", { name: "Play Evening song" });
  screen.getByRole("button", { name: "Resume Evening movie" }).focus();
  const from = screen.getByRole("radiogroup", { name: "From filter" });
  await act(async () => fireEvent.click(within(from).getByRole("radio", { name: /^Jellyfin/ })));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Resume Evening movie" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Play Evening song" })).toHaveFocus();
});

test("a pasted direct-media link queues an entry with a server-safe title", async () => {
  await render();
  const url = `https://example.com/${"x".repeat(240)}`;
  await search(url);
  await userEvent.click(screen.getByRole("radio", { name: "Direct media" }));
  await click("Queue");
  expect(commands.at(-1)).toMatchObject({ type: "enqueue", playNow: false });
  const entry = (commands.at(-1) as Extract<Action, { type: "enqueue" }>).entry;
  expect(entry.title.length).toBeLessThanOrEqual(200);
});
test("an unfinished link stays editable without crashing Find", async () => {
  await render();
  await search("http://");
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("http://");
  expect(screen.queryByRole("region", { name: "Pasted link" })).toBeNull();
});
test("controlled search drafts change only through the owner and never report route updates as edits", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = createTestQueryClient();
  const edits: string[] = [];
  const draw = async (draftQuery: string, routeQuery: string) => act(async () => view.rerender(<QueryClientProvider client={client}><SearchPanel draftQuery={draftQuery} searchState={{ query: routeQuery, source: "All" }} onQueryChange={query => edits.push(query)} origin="http://localhost" token="paired" connected canPlay active={false} onEnqueue={async () => true} /></QueryClientProvider>));
  await draw("Owner draft", "route");
  const input = screen.getByRole("searchbox") as HTMLInputElement;
  expect(input.value).toBe("Owner draft"); expect(edits).toEqual([]);
  await act(async () => { fireEvent.change(input, { target: { value: "Typed edit" } }); });
  expect(edits).toEqual(["Typed edit"]); expect(input.value).toBe("Owner draft");
  await draw("Accepted edit", "new route");
  expect(input.value).toBe("Accepted edit"); expect(edits).toEqual(["Typed edit"]);
  await click("Clear search");
  expect(edits).toEqual(["Typed edit", ""]); expect(input.value).toBe("Accepted edit");
});

test("standalone drafts follow route updates without reporting synthetic edits", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = createTestQueryClient();
  const edits: string[] = [];
  const draw = async (query: string) => act(async () => view.rerender(<QueryClientProvider client={client}><SearchPanel searchState={{ query, source: "All" }} onQueryChange={value => edits.push(value)} origin="http://localhost" token="paired" connected canPlay active={false} onEnqueue={async () => true} /></QueryClientProvider>));
  await draw("first route"); await draw("second route");
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("second route");
  expect(edits).toEqual([]);
});

test("debounced drafts survive frequent parent renders, use the latest callback and support explicit retry", async () => {
  const { SearchPanel } = await import("./SearchPanel");
  const client = createTestQueryClient();
  const oldRoutes: string[] = [], newRoutes: string[] = [];
  let setDraft!: (query: string) => void;
  function Controlled({ latest }: { latest: boolean }) {
    const [draftQuery, updateDraft] = useState(""); setDraft = updateDraft;
    const [searchState, setRoute] = useState({ query: "", source: "All" });
    return <QueryClientProvider client={client}><SearchPanel draftQuery={draftQuery} onQueryChange={updateDraft} searchState={searchState} onSearchChange={value => { (latest ? newRoutes : oldRoutes).push(value.query); setRoute(value); }} origin="http://localhost" token="paired" connected canPlay active onEnqueue={async () => true} /></QueryClientProvider>;
  }
  jest.useFakeTimers();
  await act(async () => view.rerender(<Controlled latest={false} />));
  await act(async () => setDraft("Evening"));
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => view.rerender(<Controlled latest />));
    await act(async () => { jest.advanceTimersByTime(75); });
  }
  jest.useRealTimers();
  expect(oldRoutes).toEqual([]); expect(newRoutes).toEqual(["Evening"]);
  await screen.findByRole("button", { name: "Resume Evening movie" });
  const reads = paths.filter(path => path.includes("youtube/items")).length;
  await act(async () => fireEvent.submit(screen.getByRole("search")));
  await waitFor(() => expect(paths.filter(path => path.includes("youtube/items"))).toHaveLength(reads + 1));
});

test("successive searches reuse supporting reads and revisiting a fresh query reuses its results", async () => {
  integrated = true;
  await render(); await search("Evening");
  await screen.findByRole("button", { name: "Resume Evening movie" });
  await screen.findByRole("button", { name: "Play Evening song" });
  await search("new");
  await screen.findByRole("button", { name: "Resume New movie" });
  for (const path of ["/api/providers/favorites", "/api/radio/favorites", "/api/for-later", "/api/library/sources", "/api/jellyfin", "/api/radio/avoid"]) expect(paths.filter(value => value === path)).toHaveLength(1);
  const reads = paths.length;
  await search("Evening");
  await screen.findByRole("button", { name: "Resume Evening movie" });
  expect(paths).toHaveLength(reads);
  await click("More from Jellyfin");
  expect(paths.filter(path => path === "/api/jellyfin")).toHaveLength(1);
  expect(paths).toContain("/api/jellyfin/items?q=Evening&startIndex=50");
});

test("explicit resubmission refreshes cached local and radio results", async () => {
  await render(); await search("Evening");
  await screen.findByRole("button", { name: "Resume Evening movie" });
  const reads = paths.filter(path => path.startsWith("/api/library/items")).length;
  const radioReads = paths.filter(path => path === "/api/radio/avoid").length;
  await search("Evening");
  await waitFor(() => expect(paths.filter(path => path.startsWith("/api/library/items")).length).toBeGreaterThan(reads));
  expect(paths.filter(path => path === "/api/radio/avoid")).toHaveLength(radioReads + 1);
});

test("search waits for IME composition to finish before starting its debounce", async () => {
  await render();
  const input = screen.getByRole("searchbox") as HTMLInputElement;
  jest.useFakeTimers();
  fireEvent.compositionStart(input);
  await act(async () => {
    fireEvent.change(input, { target: { value: "映画" } });
  });
  await act(async () => fireEvent.submit(screen.getByRole("search")));
  await act(async () => { jest.advanceTimersByTime(350); });
  expect(paths).toEqual([]);
  jest.useRealTimers();
  await act(async () => fireEvent.compositionEnd(input, { data: "映画" }));
  await waitFor(() => expect(paths.filter(path => path.startsWith("/api/library/items"))).toEqual(["/api/library/items?q=%E6%98%A0%E7%94%BB&offset=0&limit=30"]));
});
