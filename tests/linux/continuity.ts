import { strict as assert } from "node:assert";
import type { LibraryItem } from "../../src/shared/library";
import { addTVFolder } from "./folder-settings";
import { verifyMusicTransition } from "./music-audio";
import type { MusicContext } from "./music";
import { keys, type startHttpRemote } from "./ui";

export async function verifyContinuity(context: MusicContext, other: Awaited<ReturnType<typeof startHttpRemote>>) {
  const { clients, until, ui, api, artifactDir, httpRemote } = context;
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: ReturnType<typeof first>) => boolean) => clients.every(client => client.state && predicate(client.state));
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("native continuity sequence stops on both controllers", () => all(state => state.player.status === "idle"));
  };
  const clear = async () => {
    await stop();
    for (const entry of first().queue) await clients[0]!.command({ type: "remove", entryId: entry.id });
  };
  const measurements = [];
  let tracks: LibraryItem[] = [];
  for (const [name, folder] of [["local", "music-fixtures"], ["mounted", "continuity-mounted"]]) {
    await clear();
    const previousIds = new Set((await api("/api/library/items?q=Transition&limit=30")).items.map((item: LibraryItem) => item.id));
    const sourceId = await addTVFolder(ui, until, folder!);
    await until(`${name} lossless reference files are scanned`, async () => {
      tracks = (await api("/api/library/items?q=Transition&limit=30")).items.filter((item: LibraryItem) => !previousIds.has(item.id)).sort((a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title));
      return tracks.length === 2;
    });
    const result = await verifyMusicTransition(context, tracks, { artifactDir: `${artifactDir}/${name}`, folder: name === "local" ? undefined : `/mnt/${folder}` });
    measurements.push({ name, sourceId, ...result });
  }

  // Exercise the two actual browser controls, in addition to the two sockets.
  await clients[0]!.command({ type: "play", entryId: first().queue[0]!.id, fromStart: true });
  await until("mounted reference starts before browser cancellation controls", () => all(state => state.player.status === "playing"));
  await httpRemote.restore();
  await httpRemote.ui.section("Queue");
  await httpRemote.ui.button("Pause", ".player-controls");
  await until("phone pause reaches the single native audio player", () => all(state => state.player.status === "paused"));
  await httpRemote.screenshot("continuity-phone-paused");
  await httpRemote.minimize();
  await other.restore();
  await other.ui.section("Queue");
  await other.ui.button("Stop playback", ".player-controls");
  await until("second phone cancels both current playback and prepared successor", () => all(state => state.player.status === "idle"));
  await Bun.sleep(3_500);
  assert.ok(all(state => state.player.status === "idle" && state.player.playbackId === null));
  await other.minimize();

  if (process.env.COUCH_TEST_JELLYFIN) {
    const config = await Bun.file(process.env.COUCH_TEST_JELLYFIN).json();
    let mode: "normal" | "slow" | "failed" = "normal";
    let secondId = "";
    const reports: { path: string; itemId?: string; session?: string; position?: number }[] = [];
    const opens: { item: string; mode: string; at: string; authorized: boolean }[] = [];
    const responses: { path: string; status: number }[] = [];
    const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/Sessions/Playing")) {
        const body = await request.clone().json();
        reports.push({ path: url.pathname, itemId: body.ItemId, session: body.PlaySessionId, position: body.PositionTicks });
      }
      const item = url.pathname.match(/^\/Audio\/([^/]+)\/stream$/)?.[1];
      if (item) {
        opens.push({ item, mode, at: new Date().toISOString(), authorized: request.headers.has("authorization") });
        if (item === secondId && mode === "slow") await Bun.sleep(4_000);
        if (request.signal.aborted) return new Response(null, { status: 499 });
        if (item === secondId && mode === "failed") return new Response(null, { status: 503 });
      }
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("accept-encoding", "identity");
      const response = await fetch(`${config.containerUrl}${url.pathname}${url.search}`, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, signal: request.signal, redirect: "manual" });
      responses.push({ path: url.pathname, status: response.status });
      return response;
    } });
    try {
    await clear();
    await ui.section("Jellyfin");
    await ui.click('[data-action="jellyfin-settings"]');
    await ui.type("#jellyfin-url", `http://127.0.0.1:${proxy.port}`);
    await ui.type("#jellyfin-user", config.username);
    await ui.type("#jellyfin-password", config.password);
    await ui.click(".jellyfin-connect .primary-button");
    await until("native TV connects to disposable official Jellyfin", async () => (await api("/api/jellyfin")).connected, 30_000);
    await ui.key(keys.escape);
    let items: { id: string; title: string }[] = [];
    await until("Jellyfin album contains the adjacent lossless reference tracks", async () => {
      items = (await api("/api/jellyfin/items?q=Transition")).items.sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title));
      return items.length === 2;
    }, 30_000);
    secondId = items[1]!.id;
    const result = await verifyMusicTransition(context, tracks, {
      artifactDir: `${artifactDir}/jellyfin`,
      enqueue: async ids => { for (const [index, item] of items.entries()) await clients[1]!.command({ type: "enqueueJellyfin", itemId: item.id, entryId: ids[index]! }); },
    });
    measurements.push({ name: "jellyfin", version: config.version, ...result });
    assert.ok(!JSON.stringify(clients.map(client => client.state)).includes(config.accessToken), "Jellyfin credentials stay off paired snapshots");
    await until("Jellyfin reports one lifecycle for preflight and each measured track", () => reports.filter(report => report.path === "/Sessions/Playing").length === 3 && reports.filter(report => report.path === "/Sessions/Playing/Stopped").length === 3);
    const normalReports = structuredClone(reports);
    for (const start of normalReports.filter(report => report.path === "/Sessions/Playing")) {
      assert.equal(normalReports.filter(report => report.session === start.session && report.path === "/Sessions/Playing").length, 1);
      assert.equal(normalReports.filter(report => report.session === start.session && report.path === "/Sessions/Playing/Stopped").length, 1);
    }
    const play = async () => {
      await clients[0]!.command({ type: "play", entryId: first().queue[0]!.id, fromStart: true });
      await until(`Jellyfin first track plays before ${mode} successor`, () => all(state => state.player.status === "playing" && state.currentEntryId === state.queue[0]!.id));
    };
    mode = "slow";
    await clear();
    const slow = await verifyMusicTransition(context, tracks, {
      artifactDir: `${artifactDir}/jellyfin-slow`,
      enqueue: async ids => { for (const [index, item] of items.entries()) await clients[1]!.command({ type: "enqueueJellyfin", itemId: item.id, entryId: ids[index]! }); },
    });
    await Bun.write(`${artifactDir}/continuity-slow.json`, JSON.stringify(slow, null, 2));
    mode = "failed";
    await play();
    await until("failed prepared Jellyfin source remains the useful current queue error", () => all(state => state.player.status === "error" && state.currentEntryId === state.queue[1]!.id), 20_000);
    assert.match(first().player.error ?? "", /source.*opened/i);
    await clients[1]!.command({ type: "next", playbackId: first().player.playbackId! });
    await until("Next remains usable after a failed prepared source", () => all(state => state.player.status === "idle"));
    mode = "slow";
    await play();
    await clients[1]!.command({ type: "remove", entryId: first().queue[1]!.id });
    await until("removing the delayed successor leaves the current track to finish", () => all(state => state.player.status === "ended" && state.currentEntryId === state.queue[0]!.id));
    await Bun.sleep(4_500);
    assert.ok(all(state => state.player.status === "ended" && state.queue.length === 1));
    await stop();
    assert.ok(opens.every(open => open.authorized), "Both current and prepared native Jellyfin opens retain host authentication");
    await Bun.write(`${artifactDir}/jellyfin-continuity-lifecycle.json`, JSON.stringify({ version: config.version, normalReports, reports, opens }, null, 2));
    } finally {
      await Bun.write(`${artifactDir}/jellyfin-continuity-responses.json`, JSON.stringify(responses, null, 2));
      await proxy.stop(true);
    }
  }
  await Bun.write(`${artifactDir}/continuity-measurements.json`, JSON.stringify({ measurements, physicalOutput: false, jellyfinQualified: !!process.env.COUCH_TEST_JELLYFIN }, null, 2));
  for (const result of measurements) {
    assert.equal(result.netInsertedSamples, 0, `${result.name} keeps boundary sample alignment`);
    assert.equal(result.insertedSilenceSamples, 0, `${result.name} inserts no boundary silence`);
  }
  await stop();
}
