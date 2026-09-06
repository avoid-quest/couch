import { strict as assert } from "node:assert";
import { rename } from "node:fs/promises";
import type { LibraryItem, LibrarySource, VideoShow } from "../../src/shared/library";
import type { Action, QueueEntry } from "../../src/shared/protocol";
import { assertResponsive, keys, type UiDriver } from "./ui";
import { assertNativeVideoPixels } from "./pixels";
import { musicControls, type MusicContext } from "./music";
import { videoFixtureMovie, videoFixtureTitles } from "./video-library-fixture";

type Context = MusicContext & { clients: readonly (MusicContext["clients"][number] & { socket: WebSocket; connect(): void })[] };
type SavedVideoLibrary = { source: LibrarySource; movie: LibraryItem; show: VideoShow; ids: string[]; queue: QueueEntry[] };
const active = '.library-panel [data-slot="tabs-content"][data-state="active"] .video-library';
const labeled = (value: string) => `[aria-label=${JSON.stringify(value)}]`;
const row = (id: string) => `${active} [data-video-item="${id}"]`;

async function xdotool(...args: string[]) {
  const child = Bun.spawn(["xdotool", ...args], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  return { code: await child.exited, output: output.trim() };
}

async function nativeScreenshot(context: Context, name: string) {
  await context.httpRemote.minimize();
  await context.ui.execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong, [data-administrator-code], [data-pairing-code]').forEach(element => element.style.visibility = 'hidden')");
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${context.artifactDir}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await child.exited, 0);
}

async function rescan(context: Context, sourceId: string, status = "ready") {
  const { ui, until, api, clients } = context;
  const version = clients[0]!.state!.libraryVersion ?? 0;
  await context.httpRemote.minimize();
  await ui.section("Library");
  await ui.click('[data-action="library-folders"]');
  const index = await ui.execute("return [...document.querySelectorAll('.library-folders li')].findIndex(item => item.textContent.includes('/video-fixtures'))");
  assert.ok(index >= 0);
  await ui.button("Scan again", `.library-folders li:nth-child(${index + 1})`);
  await until(`video library rescan commits ${status} and invalidates both controllers`, async () =>
    (await api("/api/library/sources")).sources.some((source: LibrarySource) => source.id === sourceId && source.status === status)
    && clients.every(client => (client.state?.libraryVersion ?? 0) > version));
  await ui.key(keys.escape);
  await until("video folder dialog closes before browsing", () => ui.execute("return !document.querySelector('[role=dialog]')"));
}

async function restoreQueue(context: Context, queue: QueueEntry[]) {
  const { first, all, stop } = musicControls(context);
  await stop();
  for (const entry of [...first().queue]) await context.clients[0]!.command({ type: "remove", entryId: entry.id });
  for (const entry of queue) {
    const action: Action = entry.source.startsWith("library:") ? { type: "enqueueLibrary", entryId: entry.id, itemId: entry.source.slice(8) }
      : entry.source.startsWith("radio:") ? { type: "enqueueRadio", entryId: entry.id, stationId: entry.source.slice(6) }
      : entry.source.startsWith("jellyfin:") ? { type: "enqueueJellyfin", entryId: entry.id, itemId: entry.source.split(":").at(-1)! }
      : entry.source.startsWith("web:") ? { type: "enqueueWeb", entryId: entry.id, url: entry.source.slice(4), title: entry.title, thumbnail: entry.thumbnail, quality: entry.quality }
      : { type: "enqueue", entry };
    await context.clients[0]!.command(action);
  }
  await context.until("video qualification restores the original queue without autoplay", () => all(state => state.player.status === "idle" && JSON.stringify(state.queue.map(item => item.id)) === JSON.stringify(queue.map(item => item.id))));
}

async function loadedArtwork(ui: UiDriver, context: Context, width: number, description: string, selector = active) {
  await context.until(description, () => ui.execute("return [...document.querySelectorAll(arguments[0] + ' img')].some(img => img.complete && img.naturalWidth === arguments[1] && img.naturalHeight > 0)", [selector, width]));
}

async function verifySelectedShowRefresh(context: Context, source: LibrarySource, show: VideoShow) {
  const { ui, httpRemote, until, api } = context;
  const nfoPath = "/video-fixtures/Observatory/tvshow.nfo", fanartPath = "/video-fixtures/Observatory/fanart.jpg";
  const nfo = await Bun.file(nfoPath).text(), fanart = await Bun.file(fanartPath).bytes();
  await httpRemote.minimize();
  await ui.section("Library");
  await ui.button("Shows", '[aria-label="Library view"]');
  await until("TV retains season two before editing the selected show", () => ui.execute("return document.querySelector(arguments[0])?.textContent.includes('Season 2')", [active]));
  await httpRemote.restore();
  await httpRemote.ui.section("Library");
  await httpRemote.ui.button("Shows", '[aria-label="Library view"]');
  await httpRemote.ui.type(`${active} input[type=search]`, "the");
  await httpRemote.ui.button("Search", active);
  try {
    await Bun.write(nfoPath, nfo.replace(show.title, "Revised observatory journals").replace(show.plot!, "Updated local show plot."));
    await Bun.write(fanartPath, await Bun.file("/video-fixtures/Movie/Observatory-poster.jpg").bytes());
    await rescan(context, source.id);
    const current = (await api(`/api/library/items?showId=${show.id}&limit=1`)).items[0].video.show as VideoShow;
    assert.equal(current.title, "Revised observatory journals");
    assert.notEqual(current.fanartId, show.fanartId);
    await until("selected TV and phone show headings refresh without changing their seasons or phone search", async () =>
      await ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1] && document.querySelector(arguments[0])?.textContent.includes('Season 2')", [active, current.title])
      && await httpRemote.ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1] && document.querySelector(arguments[0])?.textContent.includes('Season 1') && document.querySelector(arguments[0] + ' input[type=search]')?.value === 'the'", [active, current.title]));
    await ui.click(`${active} [data-back]`);
    await until("Back history uses the refreshed show title and plot", () => ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1] && document.querySelector('.video-show-summary .video-plot')?.textContent === arguments[2]", [active, current.title, current.plot]));
    await loadedArtwork(ui, context, 240, "selected show summary decodes newly scanned fanart", ".video-show-summary .video-fanart");
    await nativeScreenshot(context, "native-video-show-rescanned");
    await ui.click(`${active} [data-video-season="2"]`);
    await httpRemote.restore();
    await httpRemote.ui.click(`${active} [data-back]`);
    await until("phone Back history also uses the refreshed show description", () => httpRemote.ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1] && document.querySelector('.video-show-summary .video-plot')?.textContent === arguments[2]", [active, current.title, current.plot]));
    await loadedArtwork(httpRemote.ui, context, 240, "phone decodes newly scanned fanart after Back", ".video-show-summary .video-fanart");
    await httpRemote.screenshot("http-video-show-rescanned");
    await httpRemote.ui.click(`${active} [data-video-season="1"]`);
  } finally { await Bun.write(nfoPath, nfo); await Bun.write(fanartPath, fanart); }
  await rescan(context, source.id);
  await until("selected show headings refresh again when original sidecars are restored", async () =>
    await ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1]", [active, show.title])
    && await httpRemote.ui.execute("return document.querySelector(arguments[0] + ' h3')?.textContent === arguments[1]", [active, show.title]));
}

export async function verifyVideoLibrary(context: Context): Promise<SavedVideoLibrary> {
  const { ui, until, api, clients, httpRemote, origin, artifactDir } = context;
  const { first, all, stop } = musicControls(context);
  const queue = structuredClone(first().queue);
  await stop();
  await httpRemote.minimize();
  await ui.section("Library");
  await ui.execute("window.__videoLibraryStage = document.querySelector('.video-stage')");
  await ui.button("Add folder", ".library-heading");
  let picker = "";
  await until("native folder picker opens for the playable video catalog", async () => { picker = (await xdotool("search", "--onlyvisible", "--name", "Add a media folder on this player")).output.split("\n")[0] ?? ""; return !!picker; });
  assert.ok(await Bun.file("/video-fixtures/Movie/Observatory.mkv").exists(), "The playable movie exists in this native test container");
  assert.equal((await xdotool("windowactivate", "--sync", picker)).code, 0);
  assert.equal((await xdotool("getwindowfocus")).output, picker, "Physical input targets the native folder picker");
  // Leave GTK's Recent/search view before entering an absolute folder location.
  assert.equal((await xdotool("key", "--clearmodifiers", "alt+Home")).code, 0);
  await Bun.sleep(250);
  assert.equal((await xdotool("key", "--clearmodifiers", "ctrl+l")).code, 0);
  await Bun.sleep(150);
  assert.equal((await xdotool("key", "--clearmodifiers", "ctrl+a")).code, 0);
  assert.equal((await xdotool("type", "--clearmodifiers", "--delay", "25", "/video-fixtures/")).code, 0);
  await Bun.sleep(150);
  await nativeScreenshot(context, "native-video-folder-location");
  assert.equal((await xdotool("key", "--clearmodifiers", "Return")).code, 0);
  await Bun.sleep(300);
  if ((await xdotool("search", "--onlyvisible", "--name", "Add a media folder on this player")).output) await xdotool("key", "Return");
  await until("native folder location is accepted and the chooser closes", async () => !(await xdotool("search", "--onlyvisible", "--name", "Add a media folder on this player")).output);
  let source!: LibrarySource;
  await until("actual native folder selection scans two movies and four multi-season episodes", async () => {
    source = (await api("/api/library/sources")).sources.find((item: LibrarySource) => item.name === "video-fixtures");
    return source?.status === "ready" && source.itemCount === 6;
  }, 30_000);
  assert.match(source.warning!, /invalid or oversized NFO\/artwork/);
  const movie = (await api(`/api/library/items?videoType=movie&q=${encodeURIComponent(videoFixtureMovie)}`)).items[0] as LibraryItem;
  assert.ok(movie?.artworkId && movie.video?.fanartId);
  assert.equal(movie.title, videoFixtureMovie);
  assert.equal(movie.video.year, 2020);
  assert.ok(movie.duration! >= 20 && movie.duration! < 21, "Actual file duration takes precedence over NFO runtime99");
  assert.equal(movie.progress, null, "Imported Kodi watched/resume fields do not replace Couch profile progress");
  const show = (await api("/api/library/video/shows?q=Observatory")).items[0] as VideoShow;
  const episodes = (await api(`/api/library/items?showId=${show.id}`)).items as LibraryItem[];
  assert.deepEqual(episodes.map(item => item.title), videoFixtureTitles);
  assert.deepEqual(episodes.map(item => [item.video?.season, item.video?.episode]), [[1, 2], [1, 10], [2, 1], [2, 10]]);
  assert.deepEqual((await api(`/api/library/video/shows/${show.id}/seasons`)).items.map((item: any) => item.season), [1, 2]);
  const malformed = (await api("/api/library/items?q=Embedded%20observatory")).items.find((item: LibraryItem) => item.id !== movie.id);
  assert.ok(malformed?.available && !malformed.artworkId, "Malformed NFO/artwork leaves a playable file with embedded title fallback");
  const allItems = [movie, ...episodes, malformed] as LibraryItem[];
  const ids = allItems.map(item => item.id).sort();
  for (const item of allItems) assert.ok(!JSON.stringify(item).includes("/video-fixtures") && !JSON.stringify(item).includes("Original sidecar data"));
  const artworkUrl = `${origin}/api/library/artwork/${movie.artworkId}`;
  assert.equal((await fetch(artworkUrl, { headers: { origin } })).status, 401);

  await ui.button("Movies", '[aria-label="Library view"]');
  await loadedArtwork(ui, context, 240, "native movie browser decodes nearby JPEG poster");
  await ui.type(`${active} input[type=search]`, "observatory");
  await ui.button("Search", active);
  await ui.click(`${row(movie.id)} ${labeled(`Details for ${movie.title}`)}`);
  await loadedArtwork(ui, context, 640, "native movie details decode cached PNG fanart", ".video-detail");
  assert.ok(await ui.execute("return document.querySelector('.video-detail')?.textContent.includes('A local film about a night under the stars.')"));
  await nativeScreenshot(context, "native-video-movie-details");
  await ui.key(keys.escape);
  await until("movie details close and restore native card focus", () => ui.execute("return !document.querySelector('.video-detail') && document.activeElement?.getAttribute('aria-label') === arguments[0]", [`Details for ${movie.title}`]));
  await ui.click(`${row(movie.id)} ${labeled(`Add ${movie.title} to queue`)}`);
  await until("TV movie Queue commits to both controllers", () => all(state => state.queue.some(entry => entry.source === `library:${movie.id}`)));
  await ui.click(`${row(movie.id)} ${labeled(`Play ${movie.title}`)}`);
  await until("TV movie Play runs native video and two audio tracks", () => all(state => state.player.status === "playing" && state.player.position > 0 && state.player.tracks?.filter(track => track.kind === "audio").length === 2 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${movie.id}`));
  await ui.watching();
  await assertNativeVideoPixels(ui.execute, artifactDir, "native-library-movie-playback");
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("native catalog movie pauses before seeking", () => all(state => state.player.status === "paused"));
  await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 7 });
  await until("native catalog movie reaches the requested resume point", () => all(state => Math.abs(state.player.position - 7) < 0.4));
  await stop();
  await ui.section("Library");
  await ui.button("Shows", '[aria-label="Library view"]');
  await loadedArtwork(ui, context, 240, "native show browser decodes nearby PNG poster");
  await ui.click(`${active} [data-video-show="${show.id}"]`);
  await loadedArtwork(ui, context, 640, "native show summary decodes nearby JPEG fanart");
  await nativeScreenshot(context, "native-video-seasons");
  await ui.click(`${active} [data-video-season="2"]`);
  await until("TV shows season two in numeric episode order", () => ui.execute("return JSON.stringify([...document.querySelectorAll(arguments[0] + ' .video-episode-title')].map(item => item.textContent)) === JSON.stringify(arguments[1])", [active, videoFixtureTitles.slice(2)]));
  await ui.key(keys.escape);
  await until("native season Back restores selected season focus", () => ui.execute("return document.activeElement?.getAttribute('data-video-season') === '2'"));
  await ui.click(`${active} [data-video-season="2"]`);

  await httpRemote.restore();
  await httpRemote.ui.section("Library");
  await httpRemote.ui.button("Movies", '[aria-label="Library view"]');
  await loadedArtwork(httpRemote.ui, context, 240, "HTTP phone decodes cached movie poster");
  await assertResponsive(httpRemote.ui, "Phone movie library");
  await httpRemote.screenshot("http-video-movies");
  await httpRemote.ui.click(`${row(movie.id)} ${labeled(`Play ${movie.title} from start`)}`);
  await until("phone Play from start clears the movie resume offset in native playback", () => all(state => state.player.status === "playing" && state.player.position > 0 && state.player.position < 4 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${movie.id}`));
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("phone-started movie pauses", () => all(state => state.player.status === "paused"));
  await clients[0]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 7 });
  await until("movie progress returns to seven seconds", () => all(state => Math.abs(state.player.position - 7) < 0.4));
  await httpRemote.ui.button("Shows", '[aria-label="Library view"]');
  await httpRemote.ui.click(`${active} [data-video-show="${show.id}"]`);
  await httpRemote.ui.click(`${active} [data-video-season="1"]`);
  await loadedArtwork(httpRemote.ui, context, 320, "HTTP phone decodes episode thumbnails");
  await until("phone season one ordering is independent of TV season two", async () =>
    await httpRemote.ui.execute("return JSON.stringify([...document.querySelectorAll(arguments[0] + ' .video-episode-title')].map(item => item.textContent)) === JSON.stringify(arguments[1])", [active, videoFixtureTitles.slice(0, 2)])
    && await ui.execute("return document.querySelector(arguments[0])?.textContent.includes('Season 2')", [active]));
  await assertResponsive(httpRemote.ui, "Phone episode library");
  await httpRemote.screenshot("http-video-episodes");
  await httpRemote.ui.click(`${row(episodes[0]!.id)} ${labeled(`Add ${episodes[0]!.title} to queue`)}`);
  await httpRemote.ui.click(`${row(episodes[0]!.id)} ${labeled(`Play ${episodes[0]!.title}`)}`);
  await until("phone episode selection replaces movie playback on the one native player", () => all(state => state.player.status === "playing" && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${episodes[0]!.id}`));
  await stop();
  const currentMovie = async () => (await api(`/api/library/items?videoType=movie&q=${encodeURIComponent(videoFixtureMovie)}`)).items.find((item: LibraryItem) => item.id === movie.id) as LibraryItem;
  assert.ok(Math.abs((await currentMovie()).progress!.position - 7) < 0.5, "Source replacement commits observed movie progress");

  // A real pending native HTTP load must not replace a later local selection or Stop.
  for (const replacement of ["episode", "stop"] as const) {
    let requested = false;
    const gate = Promise.withResolvers<void>();
    const delayed = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { requested = true; await gate.promise; return new Response(Bun.file("/fixtures/multitrack.mkv")); } });
    try {
      const entryId = crypto.randomUUID();
      await clients[0]!.command({ type: "enqueue", entry: { id: entryId, title: "Pending catalog source", source: `http://127.0.0.1:${delayed.port}/movie.mkv` } });
      await clients[0]!.command({ type: "play", entryId });
      await until("native HTTP source is actually pending", () => requested && all(state => state.player.status === "loading"));
      if (replacement === "stop") await stop();
      else await clients[1]!.command({ type: "enqueueLibrary", itemId: episodes[1]!.id, entryId: crypto.randomUUID(), playNow: true });
      gate.resolve();
      await until(`late native HTTP completion respects ${replacement}`, () => replacement === "stop" ? all(state => state.player.status === "idle" && state.currentEntryId === null)
        : all(state => state.player.status === "playing" && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${episodes[1]!.id}`));
      await stop();
    } finally { gate.resolve(); await delayed.stop(true); }
  }

  clients[1]!.socket.close();
  await until("second catalog controller disconnects", () => clients[1]!.socket.readyState === WebSocket.CLOSED);
  await clients[0]!.command({ type: "enqueueLibrary", itemId: episodes[3]!.id, entryId: crypto.randomUUID() });
  clients[1]!.connect();
  await until("reconnecting controller receives the current queue snapshot with the new episode", () => all(state => state.queue.at(-1)?.source === `library:${episodes[3]!.id}`));
  assert.equal(await ui.execute("return window.__videoLibraryStage === document.querySelector('.video-stage')"), true, "VideoStage remains mounted throughout catalog browsing/playback");
  await rescan(context, source.id);
  assert.deepEqual((await api(`/api/library/items?showId=${show.id}`)).items.map((item: LibraryItem) => item.id), episodes.map(item => item.id));
  assert.ok(Math.abs((await currentMovie()).progress!.position - 7) < 0.5);
  const nfo = await Bun.file("/video-fixtures/Movie/Observatory.nfo").text();
  await Bun.write("/video-fixtures/Movie/Observatory.nfo", nfo.replace(videoFixtureMovie, "Rescanned observatory title"));
  await rescan(context, source.id);
  assert.equal((await api("/api/library/items?q=Rescanned")).items[0].id, movie.id);
  await Bun.write("/video-fixtures/Movie/Observatory.nfo", nfo);
  await rescan(context, source.id);
  await verifySelectedShowRefresh(context, source, show);
  await rename("/video-fixtures", "/video-fixtures-offline");
  await rescan(context, source.id, "unavailable");
  const offlineMovie = await currentMovie();
  assert.equal(offlineMovie.available, false);
  assert.equal(offlineMovie.artworkId, movie.artworkId);
  assert.ok(Math.abs(offlineMovie.progress!.position - 7) < 0.5);
  await restoreQueue(context, queue);
  await httpRemote.restore();
  await httpRemote.ui.section("Library");
  await httpRemote.ui.button("Movies", '[aria-label="Library view"]');
  await loadedArtwork(httpRemote.ui, context, 240, "phone continues decoding cached artwork while source is unplugged");
  await until("unavailable movie remains browsable with disabled playback", () => httpRemote.ui.execute("return !!document.querySelector(arguments[0] + ' button[aria-label^=Resume]:disabled') && document.querySelector(arguments[0])?.textContent.includes('File unavailable')", [row(movie.id)]));
  await httpRemote.screenshot("http-video-offline");
  await ui.section("Library");
  await nativeScreenshot(context, "native-video-offline");
  await Bun.write(`${artifactDir}/video-library-before-restart.json`, JSON.stringify({ source, movie: offlineMovie, show, episodes, ids, note: "Source unavailable; real native H264/AAC fixture and decoded local artwork. Software rendering and silent audio." }, null, 2));
  await Bun.write(`${artifactDir}/video-library-fixture-manifest.json`, await Bun.file("/video-fixtures-offline/fixture-manifest.json").text());
  await ui.section("Queue");
  return { source, movie: offlineMovie, show, ids, queue };
}

export async function assertVideoLibraryAfterRestart(context: Context, expected: SavedVideoLibrary) {
  const { api, ui, httpRemote, until, clients, artifactDir } = context;
  assert.ok(clients.every(client => client.state?.player.status === "idle" && client.state.currentEntryId === null), "Offline video catalog restart does not autoplay");
  const movie = (await api(`/api/library/items?videoType=movie&q=${encodeURIComponent(videoFixtureMovie)}`)).items[0] as LibraryItem;
  assert.deepEqual(movie, expected.movie);
  assert.equal((await api("/api/library/video/shows?q=Observatory")).items[0].id, expected.show.id);
  assert.equal((await api("/api/library/sources")).sources.find((item: LibrarySource) => item.id === expected.source.id).status, "unavailable");
  await httpRemote.restore();
  await httpRemote.ui.section("Library");
  await httpRemote.ui.button("Movies", '[aria-label="Library view"]');
  const freshArtwork = await httpRemote.ui.request(`/session/${httpRemote.ui.session()}/execute/async`, { args: [movie.artworkId], script: `
    const id = arguments[0], done = arguments[arguments.length - 1];
    (async () => {
      const response = await fetch('/api/library/artwork/' + id, { cache: 'no-store', headers: { Authorization: 'Bearer ' + localStorage.getItem('couch.remote-token') }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Fresh artwork HTTP ' + response.status);
      const blob = await response.blob(), url = URL.createObjectURL(blob);
      try {
        const image = new Image(); image.src = url; await image.decode();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return { status: response.status, mimeType: blob.type, hash, width: image.naturalWidth, height: image.naturalHeight };
      } finally { URL.revokeObjectURL(url); }
    })().then(done, error => done({ error: error.message }));
  ` });
  assert.deepEqual(freshArtwork, { status: 200, mimeType: "image/jpeg", hash: movie.artworkId, width: 240, height: 360 }, "Fresh authenticated bytes for the expected movie decode after host restart while its source remains offline");
  await loadedArtwork(httpRemote.ui, context, 240, "HTTP movie card displays persisted artwork after offline restart", row(movie.id));
  await httpRemote.screenshot("http-video-offline-restart");
  await rename("/video-fixtures-offline", "/video-fixtures");
  await rescan(context, expected.source.id);
  await httpRemote.restore();
  await until("restoring the source enables the same movie UUID and resume action on the phone", () => httpRemote.ui.execute("return !!document.querySelector(arguments[0] + ' button[aria-label^=Resume]:enabled')", [row(movie.id)]));
  await httpRemote.ui.click(`${row(movie.id)} ${labeled(`Resume ${movie.title}`)}`);
  await until("phone resumes the preserved movie point in native playback after restart", () => clients.every(client => client.state?.player.status === "playing" && client.state.player.position >= 6.5 && client.state.player.position < 10 && client.state.queue.find(item => item.id === client.state!.currentEntryId)?.source === `library:${movie.id}`));
  await restoreQueue(context, expected.queue);
  await Bun.write(`${artifactDir}/video-library-after-restart.json`, JSON.stringify({ movie: (await api(`/api/library/items?q=${encodeURIComponent(movie.title)}`)).items.find((item: LibraryItem) => item.id === movie.id), show: (await api("/api/library/video/shows?q=Observatory")).items[0], freshArtwork, queueRestored: true }, null, 2));
  await httpRemote.ui.section("Queue");
  await httpRemote.minimize();
  await ui.section("Queue");
}
