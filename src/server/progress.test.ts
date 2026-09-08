import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { playbackMediaId } from "./progress";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

function fixture(options: Parameters<typeof createSession>[3] = {}, store = openStore(":memory:")) {
  let time = 100_000;
  let writes = 0;
  let fail = false;
  const commands: PlaybackCommand[] = [];
  const session = createSession({ ...store, saveProgress(profileId, item, entry) {
    if (fail) throw new Error("Private database failure");
    store.saveProgress(profileId, item, entry); writes++;
  } }, command => commands.push(command), () => {}, { now: () => time, ...options });
  session.observe(idle);
  const enqueue = (id: string, source = `library:${id}`) => session.command({ type: "enqueue", entry: { id, title: id, source } });
  const play = (id: string, fromStart = false) => { session.command({ type: "play", entryId: id, fromStart }); return session.state.player.playbackId!; };
  const observe = (position: number, status: PlayerState["status"] = "playing", duration = 120, playbackId = session.state.player.playbackId) => session.observe({ ...idle, playbackId, status, position, duration, seekable: true });
  const saved = (id = "one", profileId = "household") => store.progress(profileId, `library:${id}`);
  cleanup.push(() => { fail = false; session.close(); store.close(); });
  return { session, store, commands, enqueue, play, observe, saved, writes: () => writes, advance: (milliseconds: number) => { time += milliseconds; }, fail: (value: boolean) => { fail = value; } };
}

test("local checkpoints throttle observations, preserve rewind, and flush acknowledged pause/seek", () => {
  const f = fixture();
  f.enqueue("one");
  const playbackId = f.play("one");
  f.observe(0, "loading");
  expect(f.saved()).toBeNull();
  f.observe(10);
  expect(f.saved()?.position).toBe(10);
  f.advance(9_999);
  f.observe(20);
  expect(f.writes()).toBe(1);
  f.advance(1);
  f.observe(21);
  expect(f.saved()?.position).toBe(21);
  f.session.command({ type: "seek", playbackId, position: 5 });
  expect(f.saved()?.position).toBe(21);
  f.observe(5);
  expect(f.saved()?.position).toBe(5);
  f.observe(6, "paused");
  expect(f.saved()?.position).toBe(6);
  f.observe(6, "paused");
  expect(f.writes()).toBe(4);
  f.session.command({ type: "seek", playbackId, position: 80 });
  f.session.command({ type: "stop" });
  expect(f.saved()?.position).toBe(6);
});

test("replacement, removal, error, unavailable and shutdown flush the last observed source only", () => {
  const f = fixture();
  for (const id of ["one", "two", "three", "four"]) f.enqueue(id);
  const oldPlayback = f.play("one");
  f.observe(10);
  f.observe(14);
  f.play("two");
  expect(f.saved()?.position).toBe(14);
  f.observe(100, "playing", 120, oldPlayback);
  expect(f.saved()?.position).toBe(14);
  expect(f.saved("two")).toBeNull();
  f.observe(15);
  f.observe(18);
  f.observe(0, "error");
  expect(f.saved("two")?.position).toBe(18);
  f.play("three");
  f.observe(20);
  f.observe(23);
  f.session.command({ type: "remove", entryId: "three" });
  expect(f.saved("three")?.position).toBe(23);
  f.session.observe(idle);
  f.play("four");
  f.observe(30);
  f.observe(34);
  f.observe(0, "unavailable", 0, null);
  expect(f.saved("four")?.position).toBe(34);
  f.session.observe(idle);
  f.play("four");
  f.observe(40);
  f.observe(44);
  f.session.close();
  expect(f.saved("four")?.position).toBe(44);
});

test("an observation from before a small rewind does not acknowledge the requested seek", () => {
  const f = fixture();
  f.enqueue("one");
  const playbackId = f.play("one");
  f.observe(10);
  f.session.command({ type: "seek", playbackId, position: 8 });
  f.observe(10);
  f.observe(8);
  expect(f.saved()?.position).toBe(8);
});

test("EOF clears resume and marks watched; stop completion requires 90 percent and a minute-long item", () => {
  const f = fixture();
  f.enqueue("one");
  f.play("one");
  f.observe(18, "playing", 20);
  f.session.command({ type: "stop" });
  expect(f.saved()).toMatchObject({ position: 18, watched: false });
  f.play("one");
  f.observe(20, "ended", 20);
  expect(f.saved()).toMatchObject({ position: 0, watched: true });
  f.play("one", true);
  f.observe(5);
  expect(f.saved()).toMatchObject({ position: 5, watched: true });
  f.session.editProgress("library:one", { watched: false }, { title: "one", libraryItemId: "one" });
  f.observe(15);
  f.session.command({ type: "stop" });
  expect(f.saved()).toMatchObject({ position: 15, watched: false });
  f.play("one");
  f.observe(109);
  f.session.command({ type: "stop" });
  expect(f.saved()).toMatchObject({ position: 0, watched: true });
});

test("each play reads the shared resume point while retaining legacy history rows across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-progress-"));
  const path = join(directory, "state.sqlite");
  const f = fixture({}, openStore(path));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  f.enqueue("one");
  f.play("one");
  f.observe(25);
  const guest = f.session.createProfile("Guest");
  expect(() => f.session.selectProfile(guest.id)).toThrow("Stop playback");
  f.observe(26, "paused");
  expect(() => f.session.selectProfile(guest.id)).toThrow("Stop playback");
  f.session.command({ type: "stop" });
  f.session.observe(idle);
  f.play("one");
  expect(f.commands.at(-1)).toMatchObject({ type: "load", startPosition: 26 });
  f.session.command({ type: "stop" });
  f.session.observe(idle);
  f.session.selectProfile(guest.id);
  f.play("one");
  expect(f.commands.at(-1)).toMatchObject({ type: "load", startPosition: 26 });
  f.observe(50);
  expect(f.saved("one", guest.id)).toBeNull();
  expect(f.saved()?.position).toBe(50);
  f.session.command({ type: "stop" });
  f.play("one", true);
  expect(f.commands.at(-1)).not.toHaveProperty("startPosition");
  f.session.command({ type: "stop" });
  const reopened = openStore(path);
  const loads: PlaybackCommand[] = [];
  const fresh = createSession(reopened, command => loads.push(command), () => {});
  expect(fresh.state.activeProfile).toEqual(guest);
  expect(fresh.state.currentEntryId).toBeNull();
  expect(fresh.state.queue).toHaveLength(1);
  expect(loads).toEqual([]);
  expect(reopened.history(guest.id)).toEqual([]);
  expect(reopened.sharedHistory()[0]?.position).toBe(50);
  fresh.close(); reopened.close();
});

test("late local resolution and native observations cannot create history or restart a stopped item", async () => {
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<MediaSource>>>();
  const f = fixture({ resolveSource(entry) {
    const resolved = Promise.withResolvers<MediaSource>(); pending.set(entry.id, resolved); return resolved.promise;
  } });
  f.enqueue("one"); f.enqueue("two");
  const oldPlayback = f.play("one");
  f.play("two");
  pending.get("one")!.resolve({ source: "file:///private/one.mkv" });
  await Bun.sleep(0);
  f.observe(12, "playing", 120, oldPlayback);
  expect(f.store.history("household")).toEqual([]);
  f.session.command({ type: "stop" });
  pending.get("two")!.resolve({ source: "file:///private/two.mkv" });
  await Bun.sleep(0);
  expect(f.commands.filter(command => command.type === "load")).toEqual([]);
  expect(f.store.history("household")).toEqual([]);
});

test("failed checkpoints never invalidate durable progress and retry before replacing the source", () => {
  const f = fixture();
  f.enqueue("one"); f.enqueue("two"); f.play("one");
  const version = f.session.state.libraryVersion;
  f.fail(true);
  f.observe(10);
  expect(f.saved()).toBeNull();
  expect(f.session.state.libraryVersion).toBe(version);
  expect(f.session.state.progressError).toContain("Could not save");
  expect(f.session.state.progressError).not.toContain("Private");
  expect(() => f.play("two")).toThrow("Could not save");
  expect(f.session.state.currentEntryId).toBe("one");
  f.session.command({ type: "stop" });
  expect(f.session.state.currentEntryId).toBeNull();
  f.fail(false);
  f.play("two");
  expect(f.saved()?.position).toBe(10);
  expect(f.session.state.progressError).toBeNull();
});

test("history retains non-live sources privately and excludes radio and live entries", () => {
  const f = fixture();
  const sources = ["file:///private/library/Movie.mkv", "jellyfin:account:movie", "web:https://example.com/video", "https://example.com/album/track.mp3"];
  for (const [index, source] of sources.entries()) {
    const entry = { id: String(index), title: `Item ${index}`, source };
    f.session.command({ type: "enqueue", entry });
    f.play(entry.id); f.observe(25); f.session.command({ type: "stop" });
    const id = playbackMediaId(entry)!;
    expect(id).toMatch(/^(file|media):[a-f0-9]{64}$/);
    expect(f.store.historySource(id)).toEqual(entry);
    f.play(entry.id);
    expect(f.commands.at(-1)).toMatchObject({ startPosition: 25 });
  }
  for (const entry of [
    { id: "radio", title: "Radio", source: "radio:station" },
    { id: "raw-radio", title: "Radio URL", source: "https://radio.example/live", kind: "radio" as const },
    { id: "twitch", title: "Live Twitch", source: "web:https://twitch.tv/channel", live: true },
    { id: "rai", title: "Live RaiPlay", source: "web:https://raiplay.it/dirette/rai1", live: true },
    { id: "iptv", title: "Live TV", source: "iptv:channel" },
  ]) {
    f.session.command({ type: "enqueue", entry }); f.play(entry.id); f.observe(30);
    expect(playbackMediaId(entry)).toBeNull();
  }
  expect(f.store.history("household")).toHaveLength(sources.length);
  expect(JSON.stringify(f.store.history("household"))).not.toContain("private");
  expect(JSON.stringify(f.store.history("household"))).not.toContain("https:");
});

test("a history source remains replayable after queue removal and store restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-history-replay-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const f = fixture({}, openStore(path));
  const entry = { id: "album-track", title: "Album track", source: "web:https://artist.bandcamp.com/track/song" };
  f.session.command({ type: "enqueue", entry }); f.play(entry.id); f.observe(31);
  f.session.command({ type: "stop" }); f.session.command({ type: "remove", entryId: entry.id });
  const fresh = fixture({}, openStore(path));
  const separate = fresh.session.createProfile("Separate old history");
  fresh.session.selectProfile(separate.id);
  const mediaId = playbackMediaId(entry)!;
  fresh.session.playHistory(mediaId);
  expect(fresh.session.state.queue).toHaveLength(1);
  expect(fresh.session.state.queue[0]).toMatchObject({ source: entry.source, title: entry.title });
  expect(fresh.session.state.queue[0]!.id).not.toBe(entry.id);
  expect(fresh.commands.at(-1)).toMatchObject({ type: "load", startPosition: 31 });
  fresh.session.command({ type: "stop" }); fresh.session.playHistory(mediaId, true);
  expect(fresh.commands.at(-1)).not.toHaveProperty("startPosition");
  expect(fresh.session.state.queue).toHaveLength(1);
});

test("resolved live metadata excludes history and Jellyfin retains its fresh upstream resume", () => {
  const f = fixture({ resolveSource: entry => ({ source: "https://resolved.example/media", ...(entry.id === "live" ? { metadata: { live: true } } : { startPosition: 45 }) }) });
  f.enqueue("live", "web:https://twitch.tv/channel"); f.play("live"); f.observe(30);
  expect(f.store.history("household")).toEqual([]);
  f.enqueue("jellyfin", "jellyfin:account:movie"); f.play("jellyfin"); f.observe(20);
  f.play("jellyfin"); expect(f.commands.at(-1)).toMatchObject({ startPosition: 45 });
});

test("profile storage bounds names and count and failed profile changes do not publish", () => {
  const f = fixture();
  for (let index = 0; index < 19; index++) f.session.createProfile(`Viewer ${index}`);
  expect(() => f.session.createProfile("Overflow")).toThrow("up to 20");
  const first = f.session.state.activeProfile;
  expect(() => f.session.selectProfile("missing")).toThrow("not found");
  expect(f.session.state.activeProfile).toEqual(first);
});


test("a delayed history replay cannot defeat Stop or a revoked controller", async () => {
  for (const stopped of [true, false]) {
    const source = Promise.withResolvers<MediaSource>();
    const f = fixture({ resolveSource: () => source.promise });
    const entry = { id: "archived", title: "Old URL", source: "web:https://example.com/archived" };
    const mediaId = playbackMediaId(entry)!;
    f.store.saveProgress("household", { mediaId, title: entry.title, libraryItemId: null, position: 33, duration: 120, watched: false, lastPlayedAt: 1 }, entry);
    let allowed = true;
    f.session.playHistory(mediaId, false, () => { if (!allowed) throw new Error("This remote is no longer paired."); });
    if (stopped) f.session.command({ type: "stop" }); else allowed = false;
    source.resolve({ source: "https://example.com/newly-resolved" });
    await Bun.sleep(0);
    expect(f.commands.filter(command => command.type === "load")).toEqual([]);
    expect(f.store.progress("household", mediaId)?.position).toBe(33);
  }
});


test("a non-seekable recording enters history without an unsupported resume action", () => {
  const f = fixture();
  const entry = { id: "download", title: "Recording", source: "https://example.com/recording" };
  f.session.command({ type: "enqueue", entry });
  const playbackId = f.play(entry.id);
  f.session.observe({ ...idle, playbackId, status: "playing", position: 25 });
  const mediaId = playbackMediaId(entry)!;
  expect(f.store.progress("household", mediaId)).toMatchObject({ position: 0, watched: false });
  expect(f.store.historySource(mediaId)).toEqual(entry);
});

test("shared playback checkpoints keep the visible record and do not revive an older watched mark", () => {
  const f = fixture();
  f.enqueue("one");
  const older = f.session.createProfile("Older history");
  const item = { mediaId: "library:one", libraryItemId: "one", title: "one", position: 0, duration: 120, watched: true, lastPlayedAt: 100 };
  f.store.saveProgress("household", item);
  f.store.saveProgress(older.id, { ...item, position: 30, watched: false, lastPlayedAt: 200 });
  f.play("one");
  expect(f.commands.at(-1)).toMatchObject({ type: "load", startPosition: 30 });
  f.observe(40, "paused");
  expect(f.store.sharedProgress(item.mediaId)).toMatchObject({ position: 40, watched: false });
  expect(f.store.progress("household", item.mediaId)).toEqual(item);
  expect(f.store.progress(older.id, item.mediaId)).toMatchObject({ position: 40, watched: false });
  expect(f.session.state.activeProfile.id).toBe("household");
});
