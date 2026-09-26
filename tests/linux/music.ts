import { addTVFolder } from "./folder-settings";
import { strict as assert } from "node:assert";
import type { Action, QueueEntry, SessionState } from "../../src/shared/protocol";
import type { LibraryItem, MusicAlbum } from "../../src/shared/library";
import type { SavedPlaylist } from "../../src/shared/playlists";
import { assertResponsive, type UiDriver, type Wait } from "./ui";
import { verifyMusicTransition } from "./music-audio";

export type MusicContext = {
  origin: string;
  ui: UiDriver;
  until: Wait;
  clients: readonly { token: string; state: SessionState | null; command: (action: Action) => Promise<void> }[];
  api: (path: string, body?: unknown, index?: number) => Promise<any>;
  httpRemote: { ui: UiDriver; restore: () => Promise<unknown>; minimize: () => Promise<unknown>; screenshot: (name: string) => Promise<void> };
  artifactDir: string;
};
export type SavedMusic = { playlist: SavedPlaylist; album: MusicAlbum; tracks: LibraryItem[] };
const label = (text: string) => `[aria-label=${JSON.stringify(text)}]`;
const orderedTitles = ["Disc one first", "Disc one last", "Disc two first"];
const playlistDialog = 'section[aria-label="Lists"]';

export function musicControls({ clients, until }: MusicContext) {
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("music acceptance stops the native player on both controllers", () => all(state => state.player.status === "idle" && state.currentEntryId === null));
  };
  return { first, all, stop };
}

async function addMusicFolder({ ui, until, api, artifactDir }: MusicContext) {
  await addTVFolder(ui, until, "music-fixtures");
  try {
    await until("Sources folder selection scans all six tagged and transition songs", async () =>
      (await api("/api/library/sources", undefined, 1)).sources.some((source: any) => source.status === "ready" && source.itemCount === 6), 30_000);
  } finally { await Bun.write(`${artifactDir}/music-library-sources.json`, JSON.stringify(await api("/api/library/sources"), null, 2)); }
}

async function closePlaylists(ui: UiDriver, until: Wait) {
  await ui.section("Now");
}

async function openPlaylist(ui: UiDriver, until: Wait, id?: string) {
  await ui.section("Saved");
  await ui.click('[role="tab"][id$="-trigger-lists"]');
  await until("Saved Lists opens", async () => await ui.execute("return !!document.querySelector(arguments[0])", [playlistDialog]));
  if (await ui.execute("return !!document.querySelector('#rename-playlist')")) await ui.button("Lists", playlistDialog);
  await until("Saved Lists is ready", async () => await ui.execute("return [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent === 'Save Up next as a list')", [playlistDialog]));
  if (id) await ui.click(`[data-playlist-id=${JSON.stringify(id)}] [data-play]`);
}

export async function restoreQueue(context: MusicContext, queue: QueueEntry[]) {
  const { first, all, stop } = musicControls(context);
  await stop();
  for (const entry of [...first().queue]) await context.clients[0]!.command({ type: "remove", entryId: entry.id });
  for (const entry of queue) {
    const shared = { entryId: entry.id };
    const action: Action = entry.source.startsWith("library:") ? { type: "enqueueLibrary", ...shared, itemId: entry.source.slice(8) }
      : entry.source.startsWith("radio:") ? { type: "enqueueRadio", ...shared, stationId: entry.source.slice(6) }
      : entry.source.startsWith("jellyfin:") ? { type: "enqueueJellyfin", ...shared, itemId: entry.source.split(":").at(-1)! }
      : entry.source.startsWith("web:") ? { type: "enqueueWeb", ...shared, url: entry.source.slice(4), title: entry.title, thumbnail: entry.thumbnail, quality: entry.quality }
      : { type: "enqueue", entry };
    await context.clients[1]!.command(action);
  }
  await context.until("music acceptance restores the original shared queue identities and order", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queue.map(entry => entry.id))));
}

export async function verifyMusic(context: MusicContext): Promise<SavedMusic> {
  const { ui, until, clients, api, httpRemote, origin, artifactDir } = context;
  const { first, all, stop } = musicControls(context);
  const originalQueue = structuredClone(first().queue);
  await stop();
  await httpRemote.minimize();
  await addMusicFolder(context);
  const artists = await api("/api/library/music/artists?q=Fixture", undefined, 1);
  const artist = artists.items.find((item: any) => item.name === "Fixture Ensemble");
  assert.ok(artist, "Compilation songs belong to their album artist");
  const albums = await api(`/api/library/music/albums?artistId=${artist.id}`, undefined, 1);
  const album = albums.items.find((item: MusicAlbum) => item.title === "Fixture Collection") as MusicAlbum;
  assert.ok(album && album.trackCount === 3 && album.artworkId);
  const { items: tracks } = await api(`/api/library/music/albums/${album.id}`, undefined, 1) as { items: LibraryItem[] };
  assert.deepEqual(tracks.map(track => track.title), orderedTitles);
  assert.deepEqual(tracks.map(track => [track.discNumber, track.trackNumber]), [[1, 2], [1, 10], [2, 1]]);
  assert.equal(tracks[0]!.artist, "Guest Singer");
  for (const track of tracks) assert.ok(track.artworkId && track.albumArtist === "Fixture Ensemble", "MP3, FLAC and M4A retain embedded artwork and album-artist tags");
  const artwork = await fetch(`${origin}/api/library/artwork/${album.artworkId}`, { headers: { origin, authorization: `Bearer ${clients[1]!.token}` } });
  assert.equal(artwork.status, 200);
  assert.match(artwork.headers.get("content-type")!, /^image\//);
  assert.ok((await artwork.arrayBuffer()).byteLength > 50);
  assert.equal((await fetch(`${origin}/api/library/artwork/${album.artworkId}`, { headers: { origin } })).status, 401, "Embedded artwork requires paired-controller authorization");

  const soloist = artists.items.find((item: any) => item.name === "Fixture Soloist");
  assert.ok(soloist && soloist.albumCount === 0 && soloist.trackCount === 1);
  await clients[0]!.command({ type: "enqueueAlbum", albumId: album.id, playNow: false });
  await until("TV adds the complete album in disc and track order to both controllers", () => all(state => JSON.stringify(state.queue.slice(-3).map(entry => entry.title)) === JSON.stringify(orderedTitles)));
  const beforePlay = new Set(first().queue.map(entry => entry.id));
  await httpRemote.restore();
  await clients[1]!.command({ type: "enqueueAlbum", albumId: album.id, playNow: true });
  await until("phone Play album starts the first ordered track in native libmpv", () => all(state => state.player.status === "playing" && state.player.position > 0 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${tracks[0]!.id}`));
  assert.ok(first().player.tracks?.some(track => track.kind === "audio"));
  const played = first().queue.filter(entry => !beforePlay.has(entry.id));
  assert.equal(new Set(played.map(entry => entry.id)).size, 3, "Repeated album loads create independent queue occurrences");
  assert.deepEqual(played.map(entry => entry.title), orderedTitles);
  assert.equal(first().currentEntryId, played[0]!.id);
  await stop();
  for (const entry of first().queue) if (beforePlay.has(entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });

  await openPlaylist(httpRemote.ui, until);
  const existing = new Set((await api("/api/playlists", undefined, 1)).playlists.map((item: any) => item.id));
  await httpRemote.ui.button("Save Up next as a list", playlistDialog);
  let newId = "";
  await until("phone saves Up next as a list", async () => !!(newId = (await api("/api/playlists", undefined, 1)).playlists.find((item: any) => !existing.has(item.id))?.id ?? ""));
  await httpRemote.ui.click(`[data-playlist-id=${JSON.stringify(newId)}] [data-play]`);
  await httpRemote.ui.type("#rename-playlist", "Evening album");
  const initialVersion = first().versions?.playlists ?? 0;
  await httpRemote.ui.button("Rename", playlistDialog);
  let saved!: SavedPlaylist;
  await until("phone saves a durable named queue and invalidates both controllers", async () => {
    const summary = (await api("/api/playlists", undefined, 1)).playlists.find((item: any) => item.name === "Evening album");
    if (!summary || !all(state => (state.versions?.playlists ?? 0) > initialVersion)) return false;
    saved = (await api(`/api/playlists/${summary.id}`, undefined, 1)).playlist;
    return saved.entries.length === 3;
  });
  assert.deepEqual(saved.entries.map(entry => entry.title), orderedTitles);
  assert.ok(saved.entries.every(entry => !("source" in entry)), "Saved playlist snapshots do not expose host paths or resolved sources");
  await assertResponsive(httpRemote.ui, "Phone saved playlist dialog");
  await closePlaylists(httpRemote.ui, until);
  await openPlaylist(httpRemote.ui, until, saved.id);
  await httpRemote.minimize();
  await openPlaylist(ui, until, saved.id);
  await ui.type("#rename-playlist", "Evening collection");
  await ui.button("Rename", playlistDialog);
  await until("TV rename commits the new saved playlist revision", async () => (await api(`/api/playlists/${saved.id}`, undefined, 1)).playlist.name === "Evening collection");
  const stale = await fetch(`${origin}/api/playlists/${saved.id}`, { method: "POST", headers: { origin, authorization: `Bearer ${clients[1]!.token}`, "content-type": "application/json" }, body: JSON.stringify({ revision: saved.revision, operation: "rename", name: "Stale overwrite" }) });
  assert.equal(stale.status, 409, "An out-of-date controller cannot overwrite a saved playlist");
  const beforeStaleLoad = first().queue.map(entry => entry.id);
  const staleLoad = await fetch(`${origin}/api/playlists/${saved.id}/load`, { method: "POST", headers: { origin, authorization: `Bearer ${clients[1]!.token}`, "content-type": "application/json" }, body: JSON.stringify({ revision: saved.revision, mode: "play" }) });
  assert.equal(staleLoad.status, 409, "An out-of-date controller cannot play an obsolete playlist revision");
  assert.deepEqual(first().queue.map(entry => entry.id), beforeStaleLoad);
  const renamed = (await api(`/api/playlists/${saved.id}`)).playlist as SavedPlaylist;
  await api(`/api/playlists/${saved.id}`, { revision: renamed.revision, operation: "move", entryId: renamed.entries[2]!.id, beforeEntryId: renamed.entries[1]!.id });
  await until("saved playlist reorder is visible to the second controller", async () => JSON.stringify((await api(`/api/playlists/${saved.id}`, undefined, 1)).playlist.entries.map((entry: any) => entry.title)) === JSON.stringify([orderedTitles[0], orderedTitles[2], orderedTitles[1]]));
  await until("TV renders the reordered list before editing its new revision", () => ui.execute("return [...document.querySelectorAll('[aria-label=\"List items\"] button[aria-label^=Reorder]')].map(button => button.getAttribute('aria-label')).join('|') === arguments[0]", [[orderedTitles[0], orderedTitles[2], orderedTitles[1]].map(title => `Reorder ${title}`).join("|")]));
  await ui.click(`${playlistDialog} ${label("Remove Disc one last from list")}`);
  await until("TV removes only the chosen saved occurrence", async () => (await api(`/api/playlists/${saved.id}`, undefined, 1)).playlist.entries.length === 2);
  await closePlaylists(ui, until);
  await httpRemote.restore();
  await until("open HTTP phone playlist receives the TV rename, order and removal through shared invalidation", async () => await httpRemote.ui.execute("return document.querySelector(arguments[0])?.textContent.includes('Evening collection') && document.querySelectorAll('[aria-label=\"List items\"] li').length === 2", [playlistDialog]));
  const queueCount = first().queue.length;
  await httpRemote.ui.button("Queue", playlistDialog);
  await until("phone appends a saved playlist without replacing existing queue entries", () => all(state => state.queue.length === queueCount + 2 && state.queue.at(-2)?.title === orderedTitles[0] && state.queue.at(-1)?.title === orderedTitles[2]));
  await httpRemote.ui.button("Play", playlistDialog);
  await until("phone plays the saved queue through the one native player", () => all(state => state.queue.length === 2 && state.currentEntryId === state.queue[0]?.id && state.player.status === "playing" && state.player.position > 0));
  await stop();
  await httpRemote.ui.button("Update from Up next", playlistDialog);
  await httpRemote.ui.button("Replace", '[role="alertdialog"]');
  await until("explicit Update from Up next persists current queue occurrences", async () => JSON.stringify((await api(`/api/playlists/${saved.id}`, undefined, 1)).playlist.entries.map((entry: any) => entry.id)) === JSON.stringify(first().queue.map(entry => entry.id)));
  saved = (await api(`/api/playlists/${saved.id}`, undefined, 1)).playlist;
  await httpRemote.screenshot("http-saved-playlist");
  await httpRemote.ui.button("Lists", playlistDialog);
  await httpRemote.ui.button("Save Up next as a list", playlistDialog);
  let temporaryId = "";
  await until("phone saves a disposable second playlist", async () => {
    temporaryId = (await api("/api/playlists", undefined, 1)).playlists.find((item: any) => item.id !== saved.id)?.id ?? "";
    return !!temporaryId;
  });
  await until("new saved list appears on the phone", () => httpRemote.ui.execute("return !!document.querySelector(arguments[0])", [`[data-playlist-id=${JSON.stringify(temporaryId)}]`]));
  await httpRemote.ui.click(`[data-playlist-id=${JSON.stringify(temporaryId)}] [data-play]`);
  await httpRemote.ui.button("Delete", playlistDialog);
  await until("phone deletion removes only the selected saved playlist on both controllers", async () => {
    const { playlists } = await api("/api/playlists", undefined, 1);
    return !playlists.some((item: any) => item.id === temporaryId) && playlists.some((item: any) => item.id === saved.id);
  });
  await closePlaylists(httpRemote.ui, until);
  await httpRemote.minimize();
  await restoreQueue(context, []);
  const transitionAlbum = albums.items.find((item: MusicAlbum) => item.title === "Transition measurement") as MusicAlbum;
  assert.ok(transitionAlbum);
  const transitionTracks = (await api(`/api/library/music/albums/${transitionAlbum.id}`)).items as LibraryItem[];
  await verifyMusicTransition(context, transitionTracks);
  await restoreQueue(context, originalQueue);
  await Bun.write(`${artifactDir}/music-persistence-before.json`, JSON.stringify({ playlist: saved, album, tracks }, null, 2));
  await ui.section("Queue");
  return { playlist: saved, album, tracks };
}

export async function assertMusicAfterRestart(context: MusicContext, expected: SavedMusic) {
  const { api, until, httpRemote } = context;
  const { all } = musicControls(context);
  assert.ok(all(state => state.player.status === "idle"), "Saved music and playlists restart without autoplay");
  assert.deepEqual((await api(`/api/playlists/${expected.playlist.id}`, undefined, 1)).playlist, expected.playlist);
  const album = await api(`/api/library/music/albums/${expected.album.id}`, undefined, 1);
  assert.deepEqual(album.album, expected.album);
  assert.deepEqual(album.items.map((track: LibraryItem) => [track.id, track.artworkId, track.discNumber, track.trackNumber]), expected.tracks.map(track => [track.id, track.artworkId, track.discNumber, track.trackNumber]));
  await httpRemote.restore();
  await openPlaylist(httpRemote.ui, until, expected.playlist.id);
  await until("reconnected phone retains its named playlist and saved track order after desktop restart", async () => await httpRemote.ui.execute("return document.querySelector(arguments[2])?.textContent.includes(arguments[0]) && document.querySelectorAll('[aria-label=\"List items\"] li').length === arguments[1]", [expected.playlist.name, expected.playlist.entries.length, playlistDialog]));
  await closePlaylists(httpRemote.ui, until);
  await httpRemote.ui.section("Library");
  await httpRemote.ui.type("#media-search", expected.tracks[0]!.title);
  await until("reconnected phone decodes persisted embedded artwork after desktop restart", () => httpRemote.ui.execute("return [...document.querySelectorAll('[aria-label=\"Search results\"] img')].some(img => img.complete && img.naturalWidth === 96)"));
  await httpRemote.ui.section("Queue");
  await httpRemote.minimize();
}
