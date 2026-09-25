import { strict as assert } from "node:assert";
import { addTVFolder, openFolderSources, closeFolderSources, folderCard } from "./folder-settings";
import { assertResponsive } from "./ui";
import { musicControls, restoreQueue, type MusicContext, type SavedMusic } from "./music";
import type { PlayerState } from "../../src/shared/protocol";
import type { LibraryItem, MusicAlbum } from "../../src/shared/library";


export async function verifyCue(context: MusicContext & { screenshot: (name: string) => Promise<void> }) {
  const { ui, until, clients, api, httpRemote, artifactDir } = context;
  const { first, all, stop } = musicControls(context);
  const originalQueue = structuredClone(first().queue);
  await restoreQueue(context, []);
  await httpRemote.minimize();
  await addTVFolder(ui, until, "cue-fixtures");
  await until("cue source scans with explicit invalid-sheet warning", async () => (await api("/api/library/sources")).sources.some((source: any) => source.name === "cue-fixtures" && source.status === "ready" && source.warning?.includes("missing.cue")));
  const album = (await api("/api/library/music/albums?q=Three%20tones")).items.find((album: MusicAlbum) => album.trackCount === 3) as MusicAlbum;
  assert.ok(album);
  const tracks = (await api(`/api/library/music/albums/${album.id}`)).items as LibraryItem[];
  assert.deepEqual(tracks.map(track => track.title), ["First tone", "Second tone", "Final tone"]);
  assert.equal(album.duration, 18);
  assert.ok(!JSON.stringify(tracks).includes("album.flac"));
  await clients[0]!.command({ type: "enqueueAlbum", albumId: album.id, playNow: false });
  await until("TV queues cue references in track order on both controllers", () => all(state => JSON.stringify(state.queue.slice(-3).map(entry => entry.source)) === JSON.stringify(tracks.map(track => `library:${track.id}`))));
  const entries = first().queue.slice(-3);
  const playlist = (await api("/api/playlists", { name: "Cue boundary qualification" })).playlist as SavedMusic["playlist"];
  await httpRemote.restore();
  await httpRemote.ui.section("Library");
  await httpRemote.ui.type("#media-search", "Second tone");
  await httpRemote.ui.button("Play Second tone", '[aria-label="Search results"]');
  await until("phone starts the second cue at relative zero with its own duration", () => all(state => state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${tracks[1]!.id}` && state.player.status === "playing" && state.player.position > 0 && state.player.position < 2 && Math.abs(state.player.duration! - tracks[1]!.duration!) < 0.01));
  const phoneEntryId = first().currentEntryId!;
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("cue pause is authoritative on both remotes", () => all(state => state.player.status === "paused"));
  await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 2 });
  await until("cue seek acknowledges two seconds within the segment", () => all(state => state.player.status === "paused" && Math.abs(state.player.position - 2) < 0.4));
  const profileId = first().activeProfile.id;
  await httpRemote.ui.section("Queue");
  await httpRemote.ui.button("Stop playback", ".player-band");
  await until("phone Stop retires the cue playback ID", () => all(state => state.player.status === "idle" && state.player.playbackId === null));
  if (!entries.some(entry => entry.id === phoneEntryId)) await clients[0]!.command({ type: "remove", entryId: phoneEntryId });
  await clients[0]!.command({ type: "remove", entryId: entries[0]!.id });
  await clients[0]!.command({ type: "play", entryId: entries[1]!.id });
  await until("cue resumes at its saved segment-relative position", () => all(state => state.currentEntryId === entries[1]!.id && state.player.status === "playing" && state.player.position >= 1.6 && state.player.position < 3));
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("resumed cue pauses before Next", () => all(state => state.player.status === "paused"));
  await httpRemote.ui.button("Next in queue", ".player-band");
  await until("phone Next starts the final cue from relative zero", () => all(state => state.currentEntryId === entries[2]!.id && state.player.status === "playing" && state.player.position > 0 && state.player.position < 2));
  await stop();
  await clients[0]!.command({ type: "play", entryId: entries[1]!.id, fromStart: true });
  await until("middle cue starts before testing natural segment EOF", () => all(state => state.currentEntryId === entries[1]!.id && state.player.status === "playing" && state.player.position > 0));
  const middlePlaybackId = first().player.playbackId;
  await clients[1]!.command({ type: "seek", playbackId: middlePlaybackId!, position: tracks[1]!.duration! - 0.6 });
  await until("middle cue native EOF automatically advances to the final ordered track", () => all(state => state.currentEntryId === entries[2]!.id && state.player.playbackId !== middlePlaybackId && state.player.status === "playing" && state.player.position > 0 && state.player.position < 2 && Math.abs(state.player.duration! - tracks[2]!.duration!) < 0.01));
  await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position: tracks[2]!.duration! - 0.6 });
  await until("final cue reaches physical file EOF without replaying the whole album", () => all(state => state.currentEntryId === entries[2]!.id && state.player.status === "ended" && Math.abs(state.player.duration! - tracks[2]!.duration!) < 0.01));
  await stop();
  // Replacement must clear both native start and end before ordinary audio opens.
  const ordinary = (await api("/api/library/items?q=Three%20tones%20source")).items.find((item: LibraryItem) => item.duration === 18) as LibraryItem;
  assert.ok(ordinary);
  const ordinaryEntry = crypto.randomUUID();
  await clients[0]!.command({ type: "enqueueLibrary", entryId: ordinaryEntry, itemId: ordinary.id });
  await clients[0]!.command({ type: "play", entryId: entries[1]!.id, fromStart: true });
  await until("middle cue sets an end bound shorter than the replacement source", () => all(state => state.currentEntryId === entries[1]!.id && state.player.status === "playing" && Math.abs(state.player.duration! - tracks[1]!.duration!) < 0.01));
  await clients[0]!.command({ type: "play", entryId: ordinaryEntry, fromStart: true });
  await until("ordinary replacement begins at file zero with full duration", () => all(state => state.currentEntryId === ordinaryEntry && state.player.status === "playing" && state.player.position > 0 && state.player.position < 2 && state.player.duration === 18));
  await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 12 });
  await until("ordinary replacement plays past the previous cue end bound", () => all(state => state.player.status === "playing" && state.player.position >= 12));
  await stop();
  await clients[0]!.command({ type: "play", entryId: entries[1]!.id, fromStart: true });
  await until("explicit cue restart clears its saved resume", () => all(state => state.currentEntryId === entries[1]!.id && state.player.status === "playing" && state.player.position > 0 && state.player.position < 1.9));
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("cue pauses before its final checkpoint seek", () => all(state => state.player.status === "paused"));
  await clients[1]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 2 });
  await until("cue checkpoint is stored relative to the track before restart", () => all(state => state.player.status === "paused" && Math.abs(state.player.position - 2) < 0.4));
  const checkpoint = first().player.position;
  await stop();
  const source = (await api("/api/library/sources")).sources.find((source: any) => source.name === "cue-fixtures");
  await httpRemote.minimize();
  await openFolderSources(ui, until);
  await ui.button("Scan again", folderCard(source.id));
  await closeFolderSources(ui, until);
  await until("cue rescan completes before comparing identities", async () => (await api("/api/library/sources")).sources.some((current: any) => current.id === source.id && current.status === "ready" && current.lastScanned > source.lastScanned));
  await until("cue rescan preserves album and track IDs", async () => JSON.stringify((await api(`/api/library/music/albums/${album.id}`)).items.map((item: LibraryItem) => item.id)) === JSON.stringify(tracks.map(track => track.id)));
  const result = { album, tracks, playlist, profileId, checkpoint };
  await Bun.write(`${artifactDir}/cue-before-restart.json`, JSON.stringify(result, null, 2));
  await restoreQueue(context, originalQueue);
  await httpRemote.minimize();
  return result;
}

export async function assertCueAfterRestart(context: MusicContext, saved: Awaited<ReturnType<typeof verifyCue>>) {
  const { all, first, stop } = musicControls(context);
  assert.ok(all(state => state.player.status === "idle" && state.player.playbackId === null));
  assert.deepEqual((await context.api(`/api/library/music/albums/${saved.album.id}`)).items.map((item: LibraryItem) => item.id), saved.tracks.map(track => track.id));
  const playlist = (await context.api(`/api/playlists/${saved.playlist.id}`)).playlist as SavedMusic["playlist"];
  assert.deepEqual(playlist.entries, saved.playlist.entries);
  const originalProfile = first().activeProfile.id;
  const originalQueue = structuredClone(first().queue);
  await context.api(`/api/profiles/${saved.profileId}/select`, {});
  const entryId = crypto.randomUUID();
  try {
    const item = (await context.api("/api/library/items?q=Second%20tone")).items.find((item: LibraryItem) => item.id === saved.tracks[1]!.id) as LibraryItem;
    assert.ok(item.progress && Math.abs(item.progress.position - saved.checkpoint) < 0.4, "Restart retains the observed segment-relative checkpoint");
    await context.clients[1]!.command({ type: "enqueueLibrary", itemId: item.id, entryId });
    await context.clients[1]!.command({ type: "play", entryId });
    const firstPlaying = new Map<number, PlayerState>();
    await context.until("both controllers receive the first playing observation of the restarted cue occurrence", () => {
      context.clients.forEach((client, index) => {
        if (!firstPlaying.has(index) && client.state?.currentEntryId === entryId && client.state.player.status === "playing") firstPlaying.set(index, structuredClone(client.state.player));
      });
      return firstPlaying.size === context.clients.length;
    });
    for (const player of firstPlaying.values()) {
      assert.ok(player.playbackId && player.position >= saved.checkpoint - 0.4 && player.position < saved.checkpoint + 1, "The first native playing observation must already reflect saved cue progress");
      assert.ok(Math.abs(player.duration! - saved.tracks[1]!.duration!) < 0.01);
    }
    await Bun.write(`${context.artifactDir}/cue-after-restart.json`, JSON.stringify({ stoppedBeforeExplicitPlay: true, stableIds: true, playlistPreserved: true, savedProgress: item.progress, resumedPlayer: first().player, physicalOutputQualified: false }, null, 2));
  } finally {
    await stop();
    await restoreQueue(context, originalQueue);
    await context.api(`/api/profiles/${originalProfile}/select`, {});
  }
}
