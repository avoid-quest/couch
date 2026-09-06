import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState, ReplayGainMode } from "../shared/protocol";
import { playbackDefault } from "../shared/playback-default";
import { createSession, type MediaSource } from "./session";
import { openStore, type Store } from "./store";
import { parseCommand } from "./validation";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const stores: Store[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture(path = ":memory:", resolveSource?: () => MediaSource | Promise<MediaSource>) {
  const store = openStore(path); stores.push(store);
  const commands: PlaybackCommand[] = [];
  let publications = 0;
  const session = createSession(store, command => commands.push(command), state => {
    // Every shared preference publication must already be durable.
    expect(store.playbackPreferences(state.activeProfile.id)).toEqual(state.preferences!);
    publications++;
  }, { resolveSource });
  session.observe(idle);
  if (!session.state.queue.some(entry => entry.id === "music")) session.command({ type: "enqueue", entry: { id: "music", title: "Music", source: "https://media.example/music.flac" } });
  return { store, session, commands, publications: () => publications };
}
function playing(f: ReturnType<typeof fixture>, mode: ReplayGainMode = "off") {
  f.session.command({ type: "play", entryId: "music" });
  const playbackId = f.session.state.player.playbackId!;
  f.session.observe({ ...idle, playbackId, status: "playing", replayGain: mode, speed: 1.25, audioDelay: 0.4 });
  return playbackId;
}

test("ReplayGain validation accepts exact modes and strips client-supplied native data", () => {
  const parse = (action: unknown) => parseCommand(JSON.stringify({ type: "command", requestId: "request", action }), false).action;
  for (const mode of ["off", "track", "album"] as const) {
    expect(parse({ type: "preferences", profileId: "household", preferences: { replayGain: mode, gain: 99, source: "private" } })).toEqual({ type: "preferences", profileId: "household", preferences: { replayGain: mode } });
    expect(parse({ type: "replayGain", playbackId: "music", mode, peak: 0, source: "private" })).toEqual({ type: "replayGain", playbackId: "music", mode });
  }
  expect(parse({ type: "savePlaybackDefault", profileId: "household", playbackId: "music", setting: "replayGain", mode: "track" })).toEqual({ type: "savePlaybackDefault", profileId: "household", playbackId: "music", setting: "replayGain" });
  for (const mode of [null, 0, true, [], ["track"], {}, "", "TRACK", "no", "album,track"]) {
    expect(() => parse({ type: "preferences", profileId: "household", preferences: { replayGain: mode } })).toThrow();
    expect(() => parse({ type: "replayGain", playbackId: "music", mode })).toThrow();
  }
  expect(() => parse({ type: "savePlaybackDefault", profileId: "household", playbackId: "music", setting: ["replayGain"] })).toThrow();
});

test("current ReplayGain waits for native observation and explicit saving owns only the profile default", () => {
  const f = fixture();
  const id = playing(f, "off");
  const before = structuredClone(f.session.state);
  const writes = f.publications();
  f.session.command({ type: "replayGain", playbackId: id, mode: "album" });
  expect(f.commands.at(-1)).toEqual({ type: "replayGain", playbackId: id, mode: "album" });
  expect(f.session.state).toEqual(before);
  expect(f.publications()).toBe(writes);
  // Saving before observation stores Off, not the requested Album mode.
  f.session.command({ type: "savePlaybackDefault", profileId: "household", playbackId: id, setting: "replayGain" });
  expect(f.store.playbackPreferences("household").profile.replayGain).toBe("off");
  f.session.observe({ ...f.session.state.player, status: "paused", replayGain: "album" });
  const sent = f.commands.length;
  f.session.command({ type: "savePlaybackDefault", profileId: "household", playbackId: id, setting: "replayGain" });
  expect(f.commands).toHaveLength(sent);
  expect(f.session.state.preferences!.profile.replayGain).toBe("album");
  expect(f.session.state.player).toMatchObject({ replayGain: "album", speed: 1.25, audioDelay: 0.4, volume: 80 });
  f.session.command({ type: "preferences", profileId: "household", preferences: { replayGain: "track" } });
  expect(f.session.state.player.replayGain).toBe("album");
  expect(f.session.state.preferences!.device.audioDelay).toBe(0);
  f.session.command({ type: "play", entryId: "music" });
  expect(f.commands.at(-1)).toMatchObject({ type: "load", preferences: { replayGain: "track", audioDelay: 0 } });
  expect(f.session.state.player.replayGain).toBeUndefined();
});

test("saved gain is captured at Play and unresolved, replaced, stopped and nonmusic controls cannot apply", async () => {
  let pending = Promise.withResolvers<MediaSource>();
  const f = fixture(":memory:", () => pending.promise);
  f.session.command({ type: "preferences", profileId: "household", preferences: { replayGain: "album" } });
  f.session.command({ type: "play", entryId: "music" });
  const id = f.session.state.player.playbackId!;
  expect(() => f.session.command({ type: "replayGain", playbackId: id, mode: "track" })).toThrow("loading");
  f.session.command({ type: "preferences", profileId: "household", preferences: { replayGain: "off" } });
  pending.resolve({ source: "https://private.example/signed", headers: { Authorization: "private-token" } });
  await Bun.sleep(0);
  expect(f.commands.at(-1)).toMatchObject({ type: "load", playbackId: id, preferences: { replayGain: "album" } });
  expect(JSON.stringify(f.session.state)).not.toContain("private");
  f.session.observe({ ...idle, playbackId: id, status: "playing" });
  expect(() => f.session.command({ type: "replayGain", playbackId: id, mode: "track" })).toThrow("Radio and video");
  expect(playbackDefault(f.session.state.player, "replayGain")).toBeNull();
  pending = Promise.withResolvers<MediaSource>();
  f.session.command({ type: "play", entryId: "music" });
  const replaced = f.session.state.player.playbackId!;
  expect(() => f.session.command({ type: "replayGain", playbackId: id, mode: "track" })).toThrow("changed");
  f.session.command({ type: "stop" });
  pending.resolve({ source: "https://private.example/stale" });
  await Bun.sleep(0);
  expect(f.commands.filter(command => command.type === "load")).toHaveLength(1);
  expect(() => f.session.command({ type: "replayGain", playbackId: replaced, mode: "album" })).toThrow("changed");
  expect(f.session.state.player.replayGain).toBeUndefined();
});

test("old preferences keep exact values and profile gain survives restart without autoplay or role changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-replaygain-")); directories.push(directory);
  const path = join(directory, "state.sqlite");
  const f = fixture(path);
  const guest = f.store.createProfile("Guest");
  const legacy = { audioLanguage: "en", subtitleLanguage: "fre", subtitles: "off" as const, speed: 1.75 };
  const db = new Database(path);
  db.query("INSERT INTO watching_preferences VALUES (?, ?)").run(guest.id, JSON.stringify(legacy));
  f.store.saveAudioDelay(-0.25);
  expect(f.store.playbackPreferences(guest.id)).toEqual({ profile: { ...legacy, replayGain: "off" }, device: { audioDelay: -0.25 } });
  expect(db.query<{ preferences: string }, []>("SELECT preferences FROM watching_preferences WHERE profileId != 'household'").get()!.preferences).toBe(JSON.stringify(legacy));
  db.close();
  // Refresh session device state through the existing profile selection contract.
  f.session.selectProfile(guest.id);
  f.session.command({ type: "preferences", profileId: guest.id, preferences: { replayGain: "album" } });
  const id = playing(f, "album");
  expect(() => f.session.selectProfile("household")).toThrow();
  expect(() => f.session.command({ type: "preferences", profileId: "household", preferences: { replayGain: "track" } })).toThrow("profile changed");
  f.session.command({ type: "replayGain", playbackId: id, mode: "track" });
  f.session.command({ type: "stop" });
  f.session.observe(idle);
  f.store.close(); stores.splice(stores.indexOf(f.store), 1);
  const reopened = fixture(path);
  expect(reopened.session.state.activeProfile).toEqual(guest);
  expect(reopened.session.state.preferences).toEqual({ profile: { ...legacy, replayGain: "album" }, device: { audioDelay: -0.25 } });
  expect(reopened.session.state.currentEntryId).toBeNull();
  expect(reopened.commands.filter(command => command.type === "load")).toEqual([]);
  expect(reopened.store.administratorExists()).toBe(false);
});
