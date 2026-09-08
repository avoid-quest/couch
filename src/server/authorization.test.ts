import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCatalog } from "./catalog";
import { ControllerError } from "./controllers";
import { createJellyfin } from "./jellyfin";
import { createLibrary } from "./library";
import { createPlaylists } from "./playlists";
import { createProviders } from "./providers";
import { createRadio } from "./radio";
import { createRadioSettings } from "./radio-settings";
import { createSession } from "./session";
import { openStore } from "./store";
import { createSubtitles } from "./subtitles";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

test("revoked request bodies cannot change profiles, progress, favorites, playlists, or subtitles", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-authorization-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const store = openStore(databasePath);
  const session = createSession(store, () => {}, () => {});
  const library = createLibrary({ databasePath, ffprobePath: null });
  const radio = createRadio({ databasePath });
  const jellyfin = createJellyfin(databasePath);
  const catalog = createCatalog({ library, radio, jellyfin, viewing: { store, session } });
  let changes = 0, loads = 0, attachments = 0;
  const playlists = createPlaylists({ databasePath, onChange: () => changes++, queue: () => [{ id: "item", title: "Item", source: "library:item" }], loadQueue: () => loads++ });
  const providers = createProviders({ databasePath, onChange: () => changes++ });
  const subtitles = createSubtitles(() => ({ playbackId: "current", status: "playing", position: 0, duration: 20, volume: 80, seekable: true, error: null }), () => attachments++);
  cleanup.push(() => { session.close(); store.close(); radio.close(); playlists.close(); providers.close(); subtitles.close(); });
  cleanup.push(() => library.close(), () => jellyfin.close());
  const playlist = await (await playlists.handle(new Request("http://localhost/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":"Saved"}' }))).json() as { playlist: { id: string } };
  changes = 0;
  const ordinary = (request: Request, authorize: () => void) => catalog.handle(request, false, authorize);
  const radioSettings = createRadioSettings(radio);
  const radioRequest = (request: Request, authorize: () => void) => radioSettings.handle(request, () => { authorize(); return { authority: "administrator", controller: null, claimAvailable: false }; });
  const profileId = store.profiles()[0]!.id;
  const cases = [
    ["/api/profiles", '{"name":"Unauthorized"}', ordinary],
    [`/api/profiles/${profileId}/person-name`, '{"name":"Unauthorized","expectedName":"Household"}', ordinary],
    [`/api/profiles/${profileId}/rename`, '{"name":"Unauthorized","expectedName":"Household"}', ordinary],
    [`/api/profiles/${profileId}/remove`, '{"expectedName":"Household"}', ordinary],
    ["/api/progress/library:item", '{"watched":true}', ordinary],
    ["/api/radio/favorites", '{"station":{}}', ordinary],
    ["/api/radio/playlists", '{"name":"Late","url":"http://localhost/list.m3u"}', radioRequest],
    ["/api/playlists", '{"name":"Late"}', playlists.handle],
    [`/api/playlists/${playlist.playlist.id}`, '{"operation":"rename","revision":1,"name":"Late"}', playlists.handle],
    [`/api/playlists/${playlist.playlist.id}/load`, '{"revision":1,"mode":"play"}', playlists.handle],
    ["/api/providers/favorites", '{"item":{}}', providers.handle],
    ["/api/subtitles?playbackId=current&name=captions.srt", "1\n00:00:00,000 --> 00:00:20,000\nLate\n", subtitles.handle],
  ] as const;
  for (const [path, body, handle] of cases) {
    let permitted = true;
    const authorize = () => { if (!permitted) throw new ControllerError("Pair again.", 401); };
    authorize();
    let finish!: () => void;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); finish = () => controller.close(); } });
    const request = new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": path.startsWith("/api/subtitles") ? "application/octet-stream" : "application/json" }, body: stream });
    const pending = handle(request, authorize);
    permitted = false;
    finish();
    expect((await pending).status, path).toBe(401);
  }
  expect(store.profiles().map(profile => profile.name)).toEqual(["Household"]);
  expect(radio.favorites()).toEqual([]);
  expect(radio.playlists()).toEqual([]);
  expect(session.state.queue).toEqual([]);
  expect(changes).toBe(0);
  expect(loads).toBe(0);
  expect(attachments).toBe(0);
});

test("revoking a request during an M3U lookup prevents delayed stations and error writes", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  cleanup.push(() => release.resolve());
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { started.resolve(); await release.promise; return new Response("#EXTM3U\n#EXTINF:-1,Station\nhttps://radio.example/stream\n"); } });
  cleanup.push(() => feed.stop(true));
  let changes = 0, permitted = true;
  const radio = createRadio({ databasePath: ":memory:", onChange: () => changes++ });
  cleanup.push(() => radio.close());
  const authorize = () => { if (!permitted) throw new ControllerError("Pair again.", 401); };
  const pending = radio.addPlaylist({ name: "Feed", url: `http://127.0.0.1:${feed.port}/list.m3u` }, authorize);
  await started.promise;
  const before = radio.playlists();
  permitted = false;
  release.resolve();
  const error = await pending.catch(error => error);
  expect(error).toMatchObject({ status: 401 });
  expect(radio.playlists()).toEqual(before);
  expect(radio.playlistStations({ playlistId: before[0]!.id })).toEqual([]);
  expect(changes).toBe(0);
});
