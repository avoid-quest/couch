import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState, ProfilePlaybackPreferences } from "../shared/protocol";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const defaults: ProfilePlaybackPreferences = { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 };
const italian: ProfilePlaybackPreferences = { audioLanguage: "ita", subtitleLanguage: "eng", subtitles: "auto", speed: 1.25 };
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const databasePath = () => { const path = mkdtempSync(join(tmpdir(), "couch-preferences-")); temporary.push(path); return join(path, "session.sqlite"); };

function connected(store = openStore(":memory:")) {
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" } });
  session.command({ type: "play", entryId: "one" });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", speed: 1, audioDelay: 0, subtitleDelay: 0 });
  return { store, commands, session, playbackId };
}

test("profile language, subtitle mode and speed persist separately from device delay and volume without restart autoplay", () => {
  const path = databasePath();
  const first = connected(openStore(path));
  const guest = first.session.createProfile("Guest");
  first.session.command({ type: "preferences", profileId: "household", preferences: italian });
  first.session.command({ type: "speed", playbackId: first.playbackId, speed: 1.5 });
  first.session.command({ type: "audioDelay", playbackId: first.playbackId, delay: -0.2 });
  first.session.command({ type: "volume", volume: 42 });
  first.session.command({ type: "subtitleDelay", playbackId: first.playbackId, delay: 2 });
  expect(first.session.state.player).toMatchObject({ speed: 1, audioDelay: 0, subtitleDelay: 0 });
  first.session.command({ type: "stop" });
  first.session.observe(idle);
  first.session.selectProfile(guest.id);
  expect(first.session.state.preferences).toEqual({ profile: defaults, device: { audioDelay: -0.2 } });
  first.session.command({ type: "preferences", profileId: guest.id, preferences: { ...defaults, subtitles: "off" } });
  first.session.close();
  first.store.close();

  const reopened = openStore(path);
  const commands: PlaybackCommand[] = [];
  const session = createSession(reopened, command => commands.push(command), () => {});
  expect(session.state.activeProfile).toEqual(guest);
  expect(session.state.preferences).toEqual({ profile: { ...defaults, subtitles: "off" }, device: { audioDelay: -0.2 } });
  expect(session.state.currentEntryId).toBeNull();
  expect(session.state.player.playbackId).toBeNull();
  expect(session.state.queue).toHaveLength(1);
  session.observe(idle);
  expect(commands).toEqual([{ type: "volume", volume: 42 }]);
  session.selectProfile("household");
  expect(session.state.preferences).toEqual({ profile: { ...italian, speed: 1.5 }, device: { audioDelay: -0.2 } });
  expect(commands.filter(command => command.type === "load")).toEqual([]);
  session.command({ type: "play", entryId: "one", fromStart: true });
  expect(commands.at(-1)).toMatchObject({ type: "load", preferences: { ...italian, speed: 1.5, audioDelay: -0.2 } });
  expect(commands.at(-1)).not.toHaveProperty("subtitleDelay");
  expect(commands.at(-1)).not.toHaveProperty("startPosition");
  reopened.close();
});

test("preferences migration preserves an existing queue, volume, profile, progress and paired controller", () => {
  const path = databasePath();
  const initial = openStore(path);
  const token = initial.pair();
  const guest = initial.createProfile("Guest");
  initial.selectProfile(guest.id);
  initial.saveQueue([{ id: "saved", title: "Saved", source: "library:saved" }]);
  initial.saveVolume(31);
  initial.saveProgress(guest.id, { mediaId: "library:saved", title: "Saved", libraryItemId: "saved", position: 35, duration: 200, watched: false, lastPlayedAt: 1000 });
  initial.close();
  const legacy = new Database(path);
  legacy.run("DROP TABLE watching_preferences; DROP TABLE playback_device;");
  legacy.close();
  const migrated = openStore(path);
  expect(migrated.isPaired(token)).toBe(true);
  expect(migrated.queue).toEqual([{ id: "saved", title: "Saved", source: "library:saved" }]);
  expect(migrated.volume).toBe(31);
  expect(migrated.activeProfile()).toEqual(guest);
  expect(migrated.progress(guest.id, "library:saved")?.position).toBe(35);
  expect(migrated.playbackPreferences(guest.id)).toEqual({ profile: defaults, device: { audioDelay: 0 } });
  migrated.close();
});

test("preference broadcasts follow committed writes and observations never overwrite preferences", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let publications = 0;
  const session = createSession(store, command => commands.push(command), state => {
    expect(state.preferences).toEqual(store.playbackPreferences(state.activeProfile.id));
    publications++;
  });
  session.command({ type: "preferences", profileId: "household", preferences: italian });
  expect(publications).toBe(1);
  expect(commands).toEqual([]);
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" } });
  session.command({ type: "play", entryId: "one" });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", speed: 2, audioDelay: 3, subtitleDelay: 4 });
  expect(store.playbackPreferences("household")).toEqual({ profile: italian, device: { audioDelay: 0 } });
  const before = publications;
  session.command({ type: "speed", playbackId, speed: 1.75 });
  session.command({ type: "audioDelay", playbackId, delay: 0.5 });
  expect(publications).toBe(before + 2);
  expect(session.state.player).toMatchObject({ speed: 2, audioDelay: 3 });
  expect(commands.slice(-2)).toEqual([{ type: "speed", playbackId, speed: 1.75 }, { type: "audioDelay", playbackId, delay: 0.5 }]);
  store.close();
});

test("stale preference controls neither persist nor publish and storage failure sends no controls", () => {
  const { store, session, commands, playbackId } = connected();
  const before = session.state;
  const sent = commands.length;
  expect(() => session.command({ type: "preferences", profileId: "former-profile", preferences: italian })).toThrow("profile changed");
  expect(() => session.command({ type: "speed", playbackId: "stale", speed: 2 })).toThrow("changed");
  expect(() => session.command({ type: "audioDelay", playbackId: "stale", delay: 1 })).toThrow("changed");
  expect(session.state).toEqual(before);
  expect(store.playbackPreferences("household")).toEqual({ profile: defaults, device: { audioDelay: 0 } });
  store.close();
  expect(() => session.command({ type: "preferences", profileId: "household", preferences: italian })).toThrow();
  expect(() => session.command({ type: "speed", playbackId, speed: 2 })).toThrow();
  expect(() => session.command({ type: "audioDelay", playbackId, delay: 1 })).toThrow();
  expect(session.state).toEqual(before);
  expect(commands).toHaveLength(sent);
});

test("resolved subtitles and latest preferences stay on the private load and canceled resolutions cannot load", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let pending = Promise.withResolvers<MediaSource>();
  const session = createSession(store, command => commands.push(command), () => {}, { resolveSource: () => pending.promise });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "jellyfin:one" } });
  session.command({ type: "play", entryId: "one" });
  session.command({ type: "preferences", profileId: "household", preferences: italian });
  const media = { source: "https://private.example/video", headers: { Authorization: "secret" }, subtitles: [{ source: "/private/host/subtitles.srt", title: "English", language: "eng" }] };
  pending.resolve(media);
  await Bun.sleep(0);
  expect(commands.at(-1)).toMatchObject({ type: "load", ...media, preferences: { ...italian, audioDelay: 0 } });
  expect(JSON.stringify(session.state)).not.toContain("private");
  expect(JSON.stringify(session.state)).not.toContain("secret");
  pending = Promise.withResolvers<MediaSource>();
  session.command({ type: "play", entryId: "one" });
  session.command({ type: "stop" });
  pending.resolve(media);
  await Bun.sleep(0);
  expect(commands.filter(command => command.type === "load")).toHaveLength(1);
  expect(commands.at(-1)).toEqual({ type: "stop" });
  store.close();
});

test("adding an external subtitle requires current loaded playback and awaits native track observation", () => {
  const { store, session, commands, playbackId } = connected();
  const subtitle = { source: "/private/host/subtitles.srt", title: "Phone subtitle", language: "eng" };
  expect(() => session.addSubtitle("stale", subtitle)).toThrow("changed");
  const before = session.state;
  session.addSubtitle(playbackId, subtitle);
  expect(commands.at(-1)).toEqual({ type: "addSubtitle", playbackId, ...subtitle });
  expect(session.state).toEqual(before);
  session.observe({ ...idle, playbackId, status: "paused", tracks: [{ id: "mpv-subtitle-3", index: 3, kind: "subtitle", label: subtitle.title, language: "eng", selected: true }] });
  session.addSubtitle(playbackId, subtitle);
  expect(session.state.player.tracks?.[0]?.selected).toBe(true);
  session.command({ type: "play", entryId: "one" });
  expect(session.state.player.tracks).toEqual([]);
  expect(commands.at(-1)).not.toHaveProperty("subtitles");
  expect(() => session.addSubtitle(playbackId, subtitle)).toThrow("changed");
  expect(() => session.addSubtitle(session.state.player.playbackId!, subtitle)).toThrow("finish loading");
  session.command({ type: "stop" });
  expect(() => session.addSubtitle(playbackId, subtitle)).toThrow("changed");
  store.close();
});
