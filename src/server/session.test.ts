import { expect, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };

test("failed database operations do not publish or accept queue, volume, profile, preferences or progress changes", () => {
  const store = openStore(":memory:");
  let publications = 0;
  const session = createSession(store, () => {}, () => publications++);
  store.close();
  expect(() => session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" } })).toThrow();
  expect(() => session.command({ type: "volume", volume: 25 })).toThrow();
  expect(() => session.command({ type: "preferences", profileId: "household", preferences: { audioLanguage: "ita", subtitleLanguage: "", subtitles: "off", speed: 1.25 } })).toThrow();
  expect(() => session.createProfile("Guest")).toThrow();
  expect(() => session.selectProfile("household")).toThrow();
  expect(() => session.editProgress("library:one", { watched: true }, { title: "One", libraryItemId: "one" })).toThrow();
  expect(session.state.queue).toEqual([]);
  expect(session.state.player.volume).toBe(80);
  expect(session.state.activeProfile).toEqual({ id: "household", name: "Household" });
  expect(session.state.preferences).toEqual({ profile: { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 }, device: { audioDelay: 0 } });
  expect(session.state.libraryVersion).toBeUndefined();
  expect(publications).toBe(0);
});

test("late provider resolutions cannot replace a newer item or restart stopped playback", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<MediaSource>>>();
  const session = createSession(store, command => commands.push(command), () => {}, {
    resolveSource(entry) {
      const result = Promise.withResolvers<MediaSource>();
      pending.set(entry.id, result);
      return result.promise;
    },
  });
  session.observe(idle);
  for (const id of ["one", "two"]) session.command({ type: "enqueue", entry: { id, title: id, source: `jellyfin:${id}`, automaticTitle: true } });
  session.command({ type: "play", entryId: "one" });
  session.command({ type: "play", entryId: "two" });
  pending.get("one")!.resolve({ source: "https://private.example/one", headers: { Authorization: "secret" }, metadata: { title: "Stale title" } });
  await Bun.sleep(0);
  expect(commands.filter(command => command.type === "load")).toEqual([]);
  expect(session.state.queue[0]!.title).toBe("one");
  pending.get("two")!.resolve({ source: "https://private.example/two", headers: { Authorization: "secret" }, metadata: { title: "Resolved title", thumbnail: "https://images.example/two.jpg", duration: 90 } });
  await Bun.sleep(0);
  expect(commands.at(-1)).toMatchObject({ type: "load", source: "https://private.example/two" });
  expect(commands.at(-1)).not.toHaveProperty("metadata");
  expect(session.state.queue[1]).toMatchObject({ title: "Resolved title", thumbnail: "https://images.example/two.jpg", duration: 90 });
  expect(JSON.stringify(session.state)).not.toContain("secret");
  expect(JSON.stringify(session.state)).not.toContain("private.example");
  session.command({ type: "play", entryId: "one" });
  session.command({ type: "stop" });
  pending.get("one")!.reject(new Error("Late resolution failed"));
  await Bun.sleep(0);
  expect(session.state.player.error).toBeNull();
  expect(commands.at(-1)).toEqual({ type: "stop" });
  expect(session.state.currentEntryId).toBeNull();
  store.close();
});

test("metadata enrichment preserves custom titles, ignores removed sources, and persists details", () => {
  const store = openStore(":memory:");
  let saved: unknown;
  let publications = 0;
  const session = createSession({ ...store, saveQueue: queue => { store.saveQueue(queue); saved = queue; } }, () => {}, () => publications++);
  session.command({ type: "enqueue", entry: { id: "one", title: "My title", source: "web:https://media.example/one", quality: "480p" } });
  session.enrichEntry("one", "web:https://media.example/one", { title: "Provider title", thumbnail: "https://images.example/one.jpg", live: true });
  expect(session.state.queue[0]).toMatchObject({ title: "My title", quality: "480p", live: true, thumbnail: "https://images.example/one.jpg" });
  expect(saved).toEqual(session.state.queue);
  const count = publications;
  session.enrichEntry("one", "web:https://media.example/replaced", { live: false });
  expect(publications).toBe(count);
  session.command({ type: "remove", entryId: "one" });
  session.enrichEntry("one", "web:https://media.example/one", { title: "Late result" });
  expect(session.state.queue).toEqual([]);
  store.close();
});

test("track selection uses the current observed catalog and waits for native confirmation", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" } });
  session.command({ type: "play", entryId: "one" });
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", speed: 1, tracks: [{ id: "mpv-audio-1", index: 2, kind: "audio", label: "English", language: "eng", selected: true }] });
  expect(() => session.command({ type: "track", playbackId, kind: "audio", index: 1 })).toThrow("not available");
  session.command({ type: "track", playbackId, kind: "audio", index: 2 });
  session.command({ type: "track", playbackId, kind: "subtitle", index: -1 });
  session.command({ type: "speed", playbackId, speed: 1.5 });
  expect(session.state.player.speed).toBe(1);
  expect(commands.at(-1)).toEqual({ type: "speed", playbackId, speed: 1.5 });
  expect(() => session.command({ type: "audioDelay", playbackId: "stale", delay: 1 })).toThrow("changed");
  store.close();
});

test("repeated EOF observations cannot autoplay a canceled catalog addition or cancel a fresh play request", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  const enqueue = (id: string) => session.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` } });
  session.observe(idle);
  enqueue("one");
  session.command({ type: "play", entryId: "one" });
  const pending = session.reservePlay();
  const ended: PlayerState = { ...idle, playbackId: session.state.player.playbackId, status: "ended" };
  session.observe(ended);
  enqueue("late");
  expect(() => session.playIfCurrent(pending, "late")).toThrow("Playback was canceled");
  session.observe(ended);
  expect(session.state.currentEntryId).toBe("one");
  expect(commands.filter(command => command.type === "load")).toHaveLength(1);
  const fresh = session.reservePlay();
  session.observe(ended);
  session.playIfCurrent(fresh, "late");
  expect(session.state.currentEntryId).toBe("late");
  expect(commands.filter(command => command.type === "load")).toHaveLength(2);
  store.close();
});

test("rejected stale controls preserve pending play intent, which is consumed once and forwards restart", () => {
  const store = openStore(":memory:");
  const fromStarts: boolean[] = [];
  const session = createSession(store, () => {}, () => {}, {
    resolveSource(entry, _playbackId, _signal, fromStart) { fromStarts.push(fromStart); return { source: entry.source }; },
  });
  session.observe(idle);
  session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" } });
  const pending = session.reservePlay();
  expect(() => session.command({ type: "play", entryId: "missing" })).toThrow("no longer exists");
  expect(() => session.command({ type: "next", playbackId: "stale" })).toThrow("changed");
  session.playIfCurrent(pending, "one", true);
  expect(fromStarts).toEqual([true]);
  expect(() => session.playIfCurrent(pending, "one")).toThrow("Playback was canceled");
  store.close();
});

test.each(["player loss", "profile change", "shutdown"])("%s cancels pending catalog playback", transition => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  session.observe(idle);
  const pending = session.reservePlay();
  if (transition === "player loss") { session.observe({ ...idle, status: "unavailable" }); session.observe(idle); }
  if (transition === "profile change") session.selectProfile(session.createProfile("Guest").id);
  if (transition === "shutdown") session.close();
  session.command({ type: "enqueue", entry: { id: "late", title: "Late", source: "https://media.example/late" } });
  expect(() => session.playIfCurrent(pending, "late")).toThrow("Playback was canceled");
  expect(commands.filter(command => command.type === "load")).toEqual([]);
  store.close();
});
