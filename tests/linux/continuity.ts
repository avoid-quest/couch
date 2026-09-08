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
    const sourceId = await addTVFolder(ui, until, folder!);
    await until(`${name} lossless reference files are scanned`, async () => {
      tracks = (await api("/api/library/items?q=Transition&limit=30")).items.filter((item: LibraryItem) => item.sourceId === sourceId).sort((a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title));
      return tracks.length === 2;
    });
    const result = await verifyMusicTransition(context, tracks, { artifactDir: `${artifactDir}/${name}`, folder: name === "local" ? undefined : `/mnt/${folder}` });
    measurements.push({ name, ...result });
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
    await clear();
    await ui.section("Jellyfin");
    await ui.click('[data-action="jellyfin-settings"]');
    await ui.type("#jellyfin-url", config.containerUrl);
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
    const result = await verifyMusicTransition(context, tracks, {
      artifactDir: `${artifactDir}/jellyfin`,
      enqueue: async ids => { for (const [index, item] of items.entries()) await clients[1]!.command({ type: "enqueueJellyfin", itemId: item.id, entryId: ids[index]! }); },
    });
    measurements.push({ name: "jellyfin", version: config.version, ...result });
    assert.ok(!JSON.stringify(clients.map(client => client.state)).includes(config.accessToken), "Jellyfin credentials stay off paired snapshots");
  }
  await Bun.write(`${artifactDir}/continuity-measurements.json`, JSON.stringify({ measurements, physicalOutput: false, jellyfinQualified: !!process.env.COUCH_TEST_JELLYFIN }, null, 2));
  for (const result of measurements) {
    assert.equal(result.netInsertedSamples, 0, `${result.name} keeps boundary sample alignment`);
    assert.equal(result.insertedSilenceSamples, 0, `${result.name} inserts no boundary silence`);
  }
  await stop();
}
