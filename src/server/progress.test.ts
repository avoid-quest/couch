import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { localMediaId } from "./progress";
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
  const session = createSession({ ...store, saveProgress(profileId, item) {
    if (fail) throw new Error("Private database failure");
    store.saveProgress(profileId, item); writes++;
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

test("each play reads current profile resume instead of queue metadata; restart restores profiles without playback", () => {
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
  expect(f.commands.at(-1)).not.toHaveProperty("startPosition");
  f.observe(50);
  expect(f.saved("one", guest.id)?.position).toBe(50);
  expect(f.saved()?.position).toBe(26);
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
  expect(reopened.history(guest.id)[0]?.position).toBe(50);
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

test("direct file history uses opaque identities; radio, live entries, websites and Jellyfin never enter local history", () => {
  const f = fixture();
  const file = { id: "file", title: "Movie", source: "file:///private/library/Movie.mkv" };
  f.session.command({ type: "enqueue", entry: file });
  f.play("file"); f.observe(12); f.session.command({ type: "stop" });
  const mediaId = localMediaId(file)!;
  expect(mediaId).toMatch(/^file:[a-f0-9]{64}$/);
  expect(JSON.stringify(f.store.history("household"))).not.toContain("private");
  f.play("file");
  expect(f.commands.at(-1)).toMatchObject({ startPosition: 12 });
  for (const [id, source] of [["radio", "radio:station"], ["jellyfin", "jellyfin:movie"], ["web", "web:https://example.com/video"], ["http", "https://radio.example/live"]]) {
    f.enqueue(id!, source); f.play(id!); f.observe(25);
  }
  f.session.command({ type: "enqueue", entry: { id: "live", title: "Live", source: "library:live", live: true } });
  f.play("live"); f.observe(30);
  expect(f.store.history("household")).toHaveLength(1);
});

test("profile storage bounds names and count and failed profile changes do not publish", () => {
  const f = fixture();
  for (let index = 0; index < 19; index++) f.session.createProfile(`Viewer ${index}`);
  expect(() => f.session.createProfile("Overflow")).toThrow("up to 20");
  const first = f.session.state.activeProfile;
  expect(() => f.session.selectProfile("missing")).toThrow("not found");
  expect(f.session.state.activeProfile).toEqual(first);
});


test("growing recording EOF offers explicit resume without watched or queue advance; confirmed completion advances", () => {
  let complete = false;
  const source = `recording:${crypto.randomUUID()}`;
  const f = fixture({ resolveSource: entry => entry.source === source ? { source: "http://127.0.0.1/private/event.m3u8", eventStart: true, canComplete: ended => ended && complete } : { source: entry.source } });
  const saved = () => f.store.progress("household", source);
  f.enqueue("growing", source); f.enqueue("after"); f.play("growing");
  f.observe(114, "playing", 120);
  f.session.command({ type: "stop" });
  expect(saved()).toMatchObject({ position: 114, watched: false });
  f.play("growing");
  expect(f.commands.findLast(command => command.type === "load")).toMatchObject({ startPosition: 114, eventStart: true });
  expect(f.commands.findLast(command => command.type === "load")).not.toHaveProperty("canComplete");
  f.observe(118, "playing", 120); f.observe(120, "ended", 120);
  expect(f.session.state.player).toMatchObject({ status: "error", error: expect.stringContaining("Play it again") });
  expect(f.session.state.currentEntryId).toBe("growing"); expect(saved()).toMatchObject({ position: 118, watched: false });
  f.play("growing");
  expect(f.commands.findLast(command => command.type === "load")).toMatchObject({ startPosition: 118 });
  f.observe(150, "playing", 180); complete = true; f.observe(180, "ended", 180);
  expect(saved()).toMatchObject({ position: 0, watched: true }); expect(f.session.state.currentEntryId).toBe("after");
  f.observe(120, "ended", 120); expect(f.saved("after")).toMatchObject({ watched: true });
});

test("confirmed Ant recording still needs native completion to mark watched when stopped near its end", () => {
  const source = `recording:${crypto.randomUUID()}`;
  const f = fixture({ resolveSource: () => ({ source: "http://127.0.0.1/event.m3u8", canComplete: ended => ended }) });
  f.enqueue("one", source); f.play("one"); f.observe(118, "playing", 120); f.session.command({ type: "stop" });
  expect(f.store.progress("household", source)).toMatchObject({ watched: false, position: 118 });
});


test("completed Ant early native EOF preserves resume and queue until a retry reaches the end", () => {
  const source = `recording:${crypto.randomUUID()}`;
  const f = fixture({ resolveSource: entry => entry.source === source ? { source: "http://127.0.0.1/complete.m3u8", eventStart: true, canComplete: ended => ended } : { source: entry.source } });
  f.enqueue("recording", source); f.enqueue("after"); f.play("recording");
  f.observe(24, "playing", 120);
  f.observe(24, "ended", 120);
  expect(f.session.state.player).toMatchObject({ status: "error", error: expect.stringContaining("Play it again") });
  expect(f.session.state.currentEntryId).toBe("recording");
  expect(f.store.progress("household", source)).toMatchObject({ watched: false, position: 24 });
  f.observe(24, "ended", 120);
  expect(f.session.state.currentEntryId).toBe("recording");
  f.play("recording");
  expect(f.commands.findLast(command => command.type === "load")).toMatchObject({ startPosition: 24 });
  f.observe(119, "playing", 120); f.observe(120, "ended", 120);
  expect(f.store.progress("household", source)).toMatchObject({ watched: true, position: 0 });
  expect(f.session.state.currentEntryId).toBe("after");
});
