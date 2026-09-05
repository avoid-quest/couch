import { afterEach, expect, test } from "bun:test";
import type { ControllerIdentity } from "../shared/controllers";
import { createRadio } from "./radio";
import { createRadioSettings } from "./radio-settings";

const radios: ReturnType<typeof createRadio>[] = [];
const source = { name: "Saved stations", url: "https://feed.example/private.m3u?token=source-secret" };
const feed = (name = "First station") => `#EXTM3U\n#EXTINF:-1 tvg-id="first" group-title="Jazz" tvg-logo="https://images.example/first.png",${name}\nhttps://stream.example/first\n`;
afterEach(() => { for (const radio of radios.splice(0)) radio.close(); });

function fixture(fetch: typeof globalThis.fetch = (async () => new Response(feed())) as unknown as typeof globalThis.fetch) {
  const radio = createRadio({ databasePath: ":memory:", fetch });
  radios.push(radio);
  const settings = createRadioSettings(radio);
  let authority: ControllerIdentity["authority"] | null = "administrator";
  const identity = (): ControllerIdentity | null => authority ? { authority, controller: null, claimAvailable: false } : null;
  const request = (path: string, method = "GET", value?: unknown) => settings.handle(new Request(`http://localhost/api/radio/${path}`, {
    method, headers: { "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }), identity);
  return { radio, settings, identity, request, caller: (value: typeof authority) => { authority = value; } };
}

test("only current administrators and the host can inspect definitions or mutate sources", async () => {
  const f = fixture();
  const added = await f.request("playlists", "POST", source);
  expect(added.status).toBe(201);
  const { playlist } = await added.json();
  for (const authority of ["controller", null] as const) {
    f.caller(authority);
    const status = authority ? 403 : 401;
    for (const [path, method, value] of [["sources", "GET"], ["playlists", "POST", source], [`playlists/${playlist.id}/refresh`, "POST"], [`playlists/${playlist.id}`, "DELETE"]] as const) {
      const response = await f.request(path, method, value);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("source-secret");
    }
  }
  for (const authority of ["administrator", "host"] as const) {
    f.caller(authority);
    expect(await (await f.request("sources")).json()).toEqual({ sources: [{ ...playlist, updatedAt: expect.any(Number) }] });
    expect((await f.request(`playlists/${playlist.id}/refresh`, "POST")).status).toBe(200);
  }
  expect((await f.request(`playlists/${playlist.id}`, "DELETE")).status).toBe(204);
});

test("browse summaries conceal feed URLs and raw errors while cached stations and favorites remain usable", async () => {
  let fail = false;
  const f = fixture((async () => { if (fail) throw new Error(`Failed request ${source.url}`); return new Response(feed()); }) as unknown as typeof fetch);
  const { playlist } = await (await f.request("playlists", "POST", source)).json();
  const station = f.radio.playlistStations({ playlistId: playlist.id })[0]!;
  f.radio.saveFavorite(station);
  fail = true;
  expect((await f.request(`playlists/${playlist.id}/refresh`, "POST")).status).toBe(502);
  expect((await (await f.request("sources")).json()).sources[0].error).toContain("source-secret");
  f.caller("controller");
  const response = await f.request("playlists");
  const summary = await response.json();
  expect(summary.playlists[0]).toMatchObject({ id: playlist.id, name: source.name, stationCount: 1, updatedAt: playlist.updatedAt });
  expect(summary.playlists[0].url).toBeUndefined();
  expect(summary.playlists[0].error).toContain("Cached stations are still available");
  expect(JSON.stringify(summary)).not.toContain("source-secret");
  expect(f.radio.playlistStations({ playlistId: playlist.id })).toEqual([station]);
  expect(f.radio.favorites()).toEqual([station]);
  f.caller("administrator");
  await f.request(`playlists/${playlist.id}`, "DELETE");
  expect(f.radio.favorites()).toEqual([station]);
  expect(f.radio.getPlayable(station.id).source).toBe(station.url);
});

test("source removal retains unrelated and imported favorites and does not alter other sources", async () => {
  const f = fixture();
  const first = await f.radio.addPlaylist(source);
  const second = await f.radio.addPlaylist({ name: "Other", url: "https://feed.example/other.m3u" });
  const favorites = [f.radio.playlistStations({ playlistId: first.id })[0]!, f.radio.playlistStations({ playlistId: second.id })[0]!];
  for (const station of favorites) f.radio.saveFavorite(station);
  expect((await f.request(`playlists/${first.id}`, "DELETE")).status).toBe(204);
  expect(f.radio.playlists()).toEqual([second]);
  expect(f.radio.favorites().map(station => station.id).sort()).toEqual(favorites.map(station => station.id).sort());
});

test("lost administration while reading the body prevents the initial source write", async () => {
  const f = fixture();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const pending = f.settings.handle(new Request("http://localhost/api/radio/playlists", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { body = controller; } }),
  }), f.identity);
  f.caller("controller");
  body.enqueue(new TextEncoder().encode(JSON.stringify(source)));
  body.close();
  expect((await pending).status).toBe(403);
  expect(f.radio.playlists()).toEqual([]);
});

for (const failure of [false, true]) test(`lost identity during a ${failure ? "failed" : "successful"} refresh cannot change cache or error status`, async () => {
  let delayed = false;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  const f = fixture((async () => {
    if (!delayed) return new Response(feed());
    started.resolve();
    return release.promise;
  }) as unknown as typeof fetch);
  const { playlist } = await (await f.request("playlists", "POST", source)).json();
  const stations = f.radio.playlistStations({ playlistId: playlist.id });
  delayed = true;
  const pending = f.request(`playlists/${playlist.id}/refresh`, "POST");
  await started.promise;
  f.caller(null);
  release.resolve(failure ? new Response("Unavailable", { status: 503 }) : new Response(feed("Changed station")));
  expect((await pending).status).toBe(401);
  expect(f.radio.playlists()).toEqual([playlist]);
  expect(f.radio.playlistStations({ playlistId: playlist.id })).toEqual(stations);
});

test("rejects malformed source requests and preserves failed imports for administrator repair", async () => {
  const f = fixture((async () => new Response("Not an M3U")) as unknown as typeof fetch);
  for (const value of [null, [], {}, { ...source, role: "administrator" }, { ...source, name: 2 }, { ...source, url: "file:///etc/passwd" }]) {
    expect((await f.request("playlists", "POST", value)).status).toBe(400);
  }
  expect(f.radio.playlists()).toEqual([]);
  expect((await f.request("playlists", "POST", source)).status).toBe(502);
  const { sources } = await (await f.request("sources")).json();
  expect(sources[0]).toMatchObject({ name: source.name, url: source.url, stationCount: 0, updatedAt: null });
  expect(sources[0].error).toContain("extended M3U");
  expect((await f.request("playlists", "POST", source)).status).toBe(502);
  expect(f.radio.playlists()).toHaveLength(1);
});
