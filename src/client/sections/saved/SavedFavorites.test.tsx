import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import { SessionGateContext } from "@/session/gate-context";

setupUiTests();

let view: ReturnType<typeof renderUI>, client: QueryClient, reorderFavorites: typeof import("./SavedFavorites").reorderFavorites;
const calls: Array<{ path: string; method: string }> = [];
const played: Array<{ kind: string; id: string; playNow: boolean }> = [];
const opened: string[] = [];
const video: ProviderItem = { id: "video", provider: "youtube", kind: "media", title: "Evening video", url: "https://youtube.com/watch?v=evening" };
const album: ProviderItem = { id: "album", provider: "bandcamp", kind: "collection", title: "Evening album", url: "https://artist.bandcamp.com/album/evening" };
const station: RadioStation = { id: "station", name: "Evening radio", url: "https://radio.example/stream", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
let online: ProviderItem[] = [], radios: RadioStation[] = [], failOnline = false;
const button = (label: string) => screen.getByRole("button", { name: label });
const queryButton = (label: string) => screen.queryByRole("button", { name: label });
const click = async (label: string) => userEvent.click(await screen.findByRole("button", { name: label }));
async function render(connected = true, canPlay = true, session?: unknown) {
  const { SavedFavorites, reorderFavorites: reorder } = await import("./SavedFavorites");
  reorderFavorites = reorder;
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = createTestQueryClient();
  const wrap = (node: React.ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  await act(async () => view.rerender(wrap(<SessionGateContext.Provider value={(session ?? null) as never}><SavedFavorites origin="http://localhost" token="paired" connected={connected} canPlay={canPlay}
    onEnqueueProvider={async (item, playNow) => { played.push({ kind: "provider", id: item.id, playNow }); return true; }}
    onEnqueueRadio={async (item, playNow) => { played.push({ kind: "radio", id: item.id, playNow }); return true; }}
    onOpenProvider={item => opened.push(item.id)} /></SessionGateContext.Provider>)));

  if (connected) await screen.findByRole("button", { name: "Play Evening radio" });
}
beforeEach(async () => {
  calls.length = 0; played.length = 0; opened.length = 0; failOnline = false;
  online = [video, album]; radios = [station];
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    calls.push({ path, method });
    if (path === "/api/for-later") return Response.json({ items: [{ id: "local", title: "Saved local movie" }] });
    if (path === "/api/progress/history") return Response.json({ items: [], profile: { id: "household", name: "Household" } });
    if (path === "/api/playlists") return Response.json({ playlists: [] });
    if (method === "POST" && path === "/api/providers/favorites") { online.push(JSON.parse(String(init!.body)).item); return Response.json({ ok: true }); }
    if (method === "POST" && path === "/api/providers/favorites/reorder") {
      const order: string[] = JSON.parse(String(init!.body)).order;
      online.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return Response.json({ ok: true });
    }
    if (method === "DELETE") {
      online = online.filter(item => path !== `/api/providers/favorites/${item.id}`);
      radios = radios.filter(item => path !== `/api/radio/favorites/${item.id}`);
      return Response.json({ ok: true });
    }
    if (path === "/api/providers/favorites" && failOnline) return Response.json({ error: "Online saves unavailable" }, { status: 503 });
    return Response.json({ favorites: path === "/api/providers/favorites" ? online : radios });
  }) as typeof fetch);
  view = renderUI(<></>);
});

test("one saved list shows existing online and radio favorites without catalog or queue writes", async () => {
  await render();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(document.body.textContent).toContain("YouTube");
  expect(document.body.textContent).toContain("Bandcamp");
  expect(document.body.textContent).toContain("Radio");
  expect(calls).toEqual([{ path: "/api/providers/favorites", method: "GET" }, { path: "/api/radio/favorites", method: "GET" }]);
  await click("Open Evening album");
  expect(opened).toEqual(["album"]); expect(played).toEqual([]);
  await click("Play Evening video"); await click("Queue Evening radio");
  expect(played).toEqual([{ kind: "provider", id: "video", playNow: true }, { kind: "radio", id: "station", playNow: false }]);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test("reorder handles are always available and a drop reorders only its own store", async () => {
  await render();
  expect(screen.getAllByRole("button", { name: /^Reorder/ }).map((node: HTMLElement) => node.getAttribute("aria-label"))).toEqual(["Reorder Evening video", "Reorder Evening album", "Reorder Evening radio"]);
  const favorites = [
    { kind: "provider" as const, item: video },
    { kind: "provider" as const, item: album },
    { kind: "radio" as const, item: station },
  ];
  expect(reorderFavorites(favorites, "provider", "album", "video")).toEqual({ kind: "provider", order: [album.id, video.id] });
  expect(reorderFavorites(favorites, "radio", "station", "station")).toBeNull();
  // A drop across stores cannot persist, so it is ignored.
  expect(reorderFavorites(favorites, "radio", "station", "video")).toBeNull();
  expect(reorderFavorites(favorites, "provider", "album", "station")).toBeNull();
});

test("removal uses original stores and preserves the queue and another controller's changes", async () => {
  await render();
  await click("Remove Evening video");
  expect(calls.some(call => call.path === "/api/providers/favorites/video" && call.method === "DELETE")).toBe(true);
  expect(document.body.textContent).not.toContain("YouTube");
  await click("Remove Evening radio");
  expect(calls.some(call => call.path === "/api/radio/favorites/station" && call.method === "DELETE")).toBe(true);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(played).toEqual([]);
  online.push({ ...video, id: "new", title: "New shared video" });
  await act(async () => { await client.invalidateQueries(); });
  await screen.findByRole("button", { name: "Play New shared video" });
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(document.body.textContent).toContain("New shared video");
});

test("Undo after removal saves the item again in its old place", async () => {
  const undos: Array<() => Promise<void>> = [];
  await render(true, true, { state: null, offerUndo: (text: string, undo: () => Promise<void>) => { expect(text).toBe("Removed Evening video from Saved."); undos.push(undo); } });
  await click("Remove Evening video");
  expect(online.map(item => item.id)).toEqual(["album"]);
  await act(async () => { await undos[0]!(); });
  await screen.findByRole("button", { name: "Play Evening video" });
  expect(online.map(item => item.id)).toEqual(["video", "album"]);
  expect(screen.getAllByRole("button", { name: /^(Play Evening video|Open Evening album|Play Evening radio)$/ }).map(button => button.getAttribute("aria-label"))).toEqual(["Play Evening video", "Open Evening album", "Play Evening radio"]);
});

test("one unavailable save source does not hide the other source and retry recovers", async () => {
  failOnline = true; await render();
  expect(screen.getByRole("alert").textContent).toContain("Online saves unavailable");
  expect(button("Play Evening radio")).toBeDefined();
  expect(queryButton("Play Evening video")).toBeNull();
  await click("Play Evening radio");
  expect(played).toEqual([{ kind: "radio", id: "station", playNow: true }]);
  expect(screen.getByRole("alert").textContent).toContain("Online saves unavailable");
  expect((button("Try again") as HTMLButtonElement).disabled).toBe(false);
  failOnline = false; await click("Try again");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test("without native playback saved media remains queueable, while disconnect clears actionable data", async () => {
  await render(true, false);
  expect((button("Play Evening video") as HTMLButtonElement).disabled).toBe(true);
  expect((button("Queue Evening video") as HTMLButtonElement).disabled).toBe(false);
  expect((button("Remove Evening video") as HTMLButtonElement).disabled).toBe(false);
  const count = calls.length; await render(false);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(calls).toHaveLength(count);
  expect(document.body.textContent).toContain("Offline. Reconnecting to Couch…");
});

test("Saved keeps saved collections together without a separate history destination", async () => {
  const { SavedSection } = await import("./SavedSection");
  type SavedTab = import("./SavedSection").SavedTab;
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const found: string[] = [];
  const client = createTestQueryClient();
  function Saved() {
    const [tab, setTab] = useState<SavedTab>("later");
    return <SavedSection state={null} credentials={{ origin: "http://localhost", token: "paired" }} connected canPlay tab={tab} onTabChange={setTab}
      onFind={() => found.push("Find")} onEnqueueProvider={async () => true} onEnqueueRadio={async () => true} onOpenProvider={() => {}} />;
  }
  await act(async () => view.rerender(<QueryClientProvider client={client}><Saved /></QueryClientProvider>));

  expect(document.body.textContent).toContain("Saved on Couch");
  expect(await screen.findByRole("button", { name: "Play Saved local movie" })).toBeEnabled();
  expect(screen.getByRole("tab", { name: /For later/ }).textContent).toContain("1");
  await userEvent.click(screen.getByRole("tab", { name: /Channels & stations/ }));
  await screen.findByRole("button", { name: "Play Evening video" });

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Channels & stations");
  for (const itemTitle of ["Evening video", "Evening album", "Evening radio"]) expect(document.body.textContent).toContain(itemTitle);
  await userEvent.click(screen.getByRole("tab", { name: /Lists/ }));

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lists");
  expect(found).toEqual([]);
  expect(calls.every(call => call.method === "GET")).toBe(true);
  expect(calls.some(call => call.path === "/api/progress/history")).toBe(false);
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
});
