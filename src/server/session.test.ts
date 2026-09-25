import { expect, spyOn, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };

test("removed server-owned queue entries restore with their metadata and only once", () => {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  const entries = ["library:item", "jellyfin:server:item", "radio:station", "iptv:channel"].map((source, index) => ({
    id: `item-${index}`, title: "A".repeat(250), source, artworkId: "cover", duration: 123, live: source.startsWith("radio:") || source.startsWith("iptv:"),
  }));
  for (const entry of entries) session.command({ type: "enqueue", entry });
  for (const entry of entries) {
    expect(() => parseCommand(JSON.stringify({ type: "command", requestId: "request", action: { type: "enqueue", entry } }), true)).toThrow();
    session.command({ type: "remove", entryId: entry.id });
    const token = session.state.queueRemoval?.token;
    expect(token).toBeString();
    const action = parseCommand(JSON.stringify({ type: "command", requestId: "request", action: { type: "restoreRemoved", token } }), false).action;
    session.command(action);
    expect(session.state.queue).toEqual(entries);
    expect(() => session.command(action)).toThrow("Undo expired");
  }
  store.close();
});

test("removed entry restore rejects a changed queue without consuming its token", () => {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  const entry = { id: "one", title: "One", source: "library:one", artworkId: "cover" };
  session.command({ type: "enqueue", entry });
  session.command({ type: "remove", entryId: "one" });
  const token = session.state.queueRemoval!.token;
  session.command({ type: "enqueue", entry: { id: "two", title: "Two", source: "https://example.com/two" } });
  expect(() => session.command({ type: "restoreRemoved", token })).toThrow("shared queue or playback changed");
  expect(session.state.queue).toHaveLength(1);
  session.command({ type: "remove", entryId: "two" });
  session.command({ type: "restoreRemoved", token });
  expect(session.state.queue).toEqual([entry]);
  store.close();
});

test("removed entry restore token expires after six seconds", () => {
  const clock = spyOn(Date, "now");
  const store = openStore(":memory:");
  try {
    const session = createSession(store, () => {}, () => {});
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "library:one" } });
    session.command({ type: "remove", entryId: "one" });
    const token = session.state.queueRemoval!.token;
    clock.mockReturnValue(Date.now() + 6_000);
    expect(() => session.command({ type: "restoreRemoved", token })).toThrow("Undo expired");
    expect(session.state.queue).toEqual([]);
  } finally {
    clock.mockRestore();
    store.close();
  }
});

test("activity notices publish once without lingering in session snapshots", () => {
  const store = openStore(":memory:");
  const published: string[] = [];
  const session = createSession(store, () => {}, state => published.push(JSON.stringify(state)));
  const actor = { deviceId: "remote", name: "Kitchen" };
  session.notice(actor, "Kitchen added First track");
  expect(JSON.parse(published[0]!)?.activity).toMatchObject({ actor, text: "Kitchen added First track" });
  expect(session.state.activity).toBeUndefined();
  session.invalidate("library");
  expect(JSON.parse(published[1]!)?.activity).toBeUndefined();
  store.close();
});

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
  expect(session.state.preferences).toEqual({ profile: { replayGain: "off", audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1 }, device: { audioDelay: 0 } });
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
  const enqueue = () => session.command({ type: "enqueue", entry: { id: "late", title: "Late", source: "https://media.example/late" } });
  if (transition === "shutdown") expect(enqueue).toThrow("update");
  else enqueue();
  expect(() => session.playIfCurrent(pending, "late")).toThrow("Playback was canceled");
  expect(commands.filter(command => command.type === "load")).toEqual([]);
  store.close();
});

test("maintenance saves the last observation and suppresses later EOF, controls and native callbacks", () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let observations = 0;
  const session = createSession(store, command => commands.push(command), () => {}, { now: () => 1_000, observe: () => observations++ });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "file:///one.mp4" }, playNow: true });
    session.command({ type: "enqueue", entry: { id: "two", title: "Two", source: "file:///two.mp4" } });
    const player = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const, duration: 100, position: 12 };
    session.observe(player);
    session.observe({ ...player, position: 17 });
    session.quiesce();
    const saved = store.history("household");
    expect(saved[0]?.position).toBe(17);
    const previous = [commands.length, observations];
    session.observe({ ...player, status: "ended", position: 100 });
    session.observe({ ...idle, status: "unavailable" });
    expect([commands.length, observations]).toEqual(previous);
    expect(() => session.command({ type: "volume", volume: 1 })).toThrow("update");
    expect(() => session.createProfile("Late")).toThrow("update");
  } finally { session.close(); store.close(); }
});

test("maintenance propagates a failed progress checkpoint and keeps callbacks stopped", () => {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {}, { now: () => 1_000 });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "file:///one.mp4" }, playNow: true });
    const player = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const, duration: 100, position: 12 };
    session.observe(player);
    session.observe({ ...player, position: 17 });
    const save = store.saveProgress;
    store.saveProgress = () => { throw new Error("disk full"); };
    expect(() => session.quiesce()).toThrow("Could not save viewing progress");
    expect(() => session.command({ type: "stop" })).toThrow("update");
    session.observe({ ...player, position: 99 });
    store.saveProgress = save;
    session.quiesce();
    expect(store.history("household")[0]?.position).toBe(17);
  } finally { session.close(); store.close(); }
});

test("a source resolution finishing after maintenance cannot persist metadata or load media", async () => {
  const store = openStore(":memory:");
  const source = Promise.withResolvers<MediaSource>();
  const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, { resolveSource: () => source.promise });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://example.com/one" }, playNow: true });
    session.quiesce();
    let writes = 0;
    store.saveQueue = () => { writes++; };
    source.resolve({ source: "https://example.com/resolved", metadata: { duration: 123 } });
    await source.promise;
    await Promise.resolve();
    expect(commands.filter(command => command.type === "load")).toEqual([]);
    expect(writes).toBe(0);
  } finally { session.close(); store.close(); }
});

test("programme enrichment reaches the shared snapshot separately from native tags and clears on station changes", async () => {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  session.observe(idle);
  for (const id of ["one", "two"]) session.command({ type: "enqueue", entry: { id, title: id, source: `radio:${id}`, kind: "radio" } });
  session.command({ type: "play", entryId: "one" });
  await Bun.sleep(0);
  const playbackId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId, status: "playing", nowPlaying: { title: "Native track" } });
  const programme = { playbackId, stationId: "one", provider: "radio.avoid.quest" as const, title: "Programme", artworkUrl: "https://images.example/show.jpg", sampledAt: 1000, expiresAt: 901000 };
  session.updateRadioProgramme(playbackId, programme);
  expect(session.state.radioProgramme).toEqual(programme);
  expect(session.state.player.nowPlaying?.title).toBe("Native track");
  expect(session.state.queue[0]?.title).toBe("one");
  session.command({ type: "play", entryId: "two" });
  expect(session.state.radioProgramme).toBeNull();
  session.updateRadioProgramme(playbackId, programme);
  expect(session.state.radioProgramme).toBeNull();
  session.command({ type: "stop" });
  session.close(); store.close();
});

test("live radio ticks that only advance duration and position skip the full-state broadcast", () => {
  const store = openStore(":memory:");
  let publications = 0;
  const session = createSession(store, () => {}, () => publications++);
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "radio:one", kind: "radio" } });
    session.command({ type: "play", entryId: "one" });
    const player = { ...idle, playbackId: session.state.player.playbackId!, status: "playing" as const };
    session.observe(player);
    const tracks = [{ id: "mpv-audio-1", index: 1, kind: "audio" as const, label: "", language: "", selected: true }];
    session.observe({ ...player, tracks: [...tracks] });
    const baseline = publications;
    session.observe({ ...player, position: 1, duration: 30, tracks: [...tracks] });
    session.observe({ ...player, position: 2, duration: 60, tracks: [...tracks] });
    expect(publications).toBe(baseline);
    expect(session.state.player).toMatchObject({ position: 2, duration: 60 });
    session.observe({ ...player, position: 3, duration: 90, seekable: true });
    expect(publications).toBe(baseline + 1);
  } finally { session.close(); store.close(); }
});
