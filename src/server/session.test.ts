import { expect, spyOn, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import type { PlaybackCommand, PlaybackClock, PlayerState, SessionState } from "../shared/protocol";

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
  expect(() => session.command({ type: "restoreRemoved", token })).toThrow("Up next or playback changed");
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
  session.notice(actor, "Kitchen queued First track");
  expect(JSON.parse(published[0]!)?.activity).toMatchObject({ actor, text: "Kitchen queued First track" });
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
  expect(session.state.versions).toBeUndefined();
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
  expect(() => session.playIfCurrent(pending, "late")).toThrow("Another action canceled playback");
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
  expect(() => session.playIfCurrent(pending, "one")).toThrow("Another action canceled playback");
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
  if (transition === "shutdown") expect(enqueue).toThrow("Updating");
  else enqueue();
  expect(() => session.playIfCurrent(pending, "late")).toThrow("Another action canceled playback");
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
    expect(() => session.command({ type: "volume", volume: 1 })).toThrow("Updating");
    expect(() => session.createProfile("Late")).toThrow("Updating");
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
    expect(() => session.quiesce()).toThrow("Couldn't save your progress");
    expect(() => session.command({ type: "stop" })).toThrow("Updating");
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


test("only clocks are compact; native and household changes always publish full state", () => {
  const store = openStore(":memory:");
  const publications: Array<{ clock?: PlaybackClock; state: unknown }> = [];
  const session = createSession(store, () => {}, (state, clock) => publications.push({ clock, state: structuredClone(state) }), { now: () => 1_000 });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" }, playNow: true });
    session.observe({ ...idle, playbackId: session.state.player.playbackId, status: "playing", seekable: true, duration: 100 });
    const full = (change: () => void) => {
      publications.length = 0; change();
      expect(publications.length).toBeGreaterThan(0);
      expect(publications.every(value => !value.clock)).toBe(true);
    };
    session.observe({ ...session.state.player, position: 1 });
    expect(publications.at(-1)?.clock).toMatchObject({ position: 1, duration: 100 });
    for (const changes of [
      { duration: null, buffering: true }, { seekable: false }, { volume: 22 },
      { tracks: [{ id: "a", index: 1, kind: "audio" as const, label: "English", language: "eng", selected: true }] },
      { chapters: [{ title: "Chapter", position: 12 }] }, { speed: 1.5 },
      { audioDelay: 0.1 }, { subtitleDelay: 0.2 }, { replayGain: "track" as const },
      { subtitleError: "Subtitle unavailable" }, { nowPlaying: { title: "Song" } }, { status: "paused" as const },
      { error: "Playback problem" },
    ]) full(() => session.observe({ ...session.state.player, ...changes }));
    full(() => session.command({ type: "enqueue", entry: { id: "two", title: "Two", source: "https://media.example/two" } }));
    full(() => session.command({ type: "preferences", profileId: "household", preferences: { speed: 1.25 } }));
    full(() => session.invalidate("library", "controllers"));
    full(() => session.notice({ deviceId: "phone", name: "Phone" }, "paused playback"));
    // Activity is transient; its removal must not leave it in modern snapshots.
    full(() => session.observe({ ...session.state.player, position: 2 }));
    full(() => session.command({ type: "play", entryId: "two" }));
    full(() => session.command({ type: "stop" }));
  } finally { session.close(); store.close(); }
});

test.each(["radio:one", "iptv:one"])("%s suppresses clock publications while retaining native volume changes", source => {
  const store = openStore(":memory:");
  let publications = 0;
  const session = createSession(store, () => {}, () => publications++, { now: () => 1_000 });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source, live: true }, playNow: true });
    const player = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const };
    session.observe(player);
    const baseline = publications;
    for (let position = 1; position <= 40; position++) session.observe({ ...player, position, duration: position * 2 });
    expect(publications).toBe(baseline);
    session.observe({ ...player, position: 41, volume: 32 });
    expect(publications).toBe(baseline + 1);
  } finally { session.close(); store.close(); }
});


test("progress checkpoints, write errors and nested observation changes retain full publication", () => {
  const store = openStore(":memory:");
  let now = 1_000, nested = false;
  const publications: Array<{ state: SessionState; clock?: PlaybackClock }> = [];
  const session = createSession(store, () => {}, (state, clock) => publications.push({ state: structuredClone(state), clock }), {
    now: () => now, observe: () => { if (nested) session.invalidate("library"); },
  });
  const save = store.saveProgress;
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://media.example/one" }, playNow: true });
    const player = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const, duration: 100, seekable: true };
    session.observe(player);
    publications.length = 0; now += 10_000;
    session.observe({ ...player, position: 1 });
    expect(publications).toHaveLength(1);
    expect(publications[0]?.clock).toBeUndefined();
    expect(publications[0]?.state.versions?.progress).toBe(2);
    publications.length = 0; now += 10_000;
    store.saveProgress = () => { throw new Error("Disk full"); };
    session.observe({ ...player, position: 2 });
    expect(publications).toHaveLength(1);
    expect(publications[0]?.clock).toBeUndefined();
    expect(publications[0]?.state.progressError).toContain("Couldn't save");
    store.saveProgress = save;
    publications.length = 0; nested = true;
    session.observe({ ...player, position: 3 });
    expect(publications.every(value => !value.clock)).toBe(true);
    expect(publications.at(-1)?.state.versions?.library).toBe(1);
  } finally { nested = false; store.saveProgress = save; session.close(); store.close(); }
});

test("live clocks ignore native volume when system audio owns it", () => {
  const store = openStore(":memory:");
  let publications = 0;
  const session = createSession(store, () => {}, () => publications++, { systemAudio: true });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "radio:one", kind: "radio" }, playNow: true });
    const player = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const };
    session.observe(player);
    const count = publications;
    session.observe({ ...player, position: 1, duration: 2, volume: 100 });
    expect(publications).toBe(count);
    expect(session.state.player.volume).toBe(80);
    session.observe({ ...player, position: 2, duration: 4, volume: 100, buffering: true });
    expect(publications).toBe(count + 1);
  } finally { session.close(); store.close(); }
});


test("catalogue enrichment does not replace the selected occurrence of a repeated playlist item", () => {
  const store = openStore(":memory:");
  const session = createSession(store, () => {}, () => {});
  const entry = { id: "one", title: "Repeated video", source: "web:https://www.youtube.com/watch?v=BaW_jenozKc", collection: { title: "Playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", index: 1 } };
  try {
    session.command({ type: "enqueue", entry });
    session.enrichEntry(entry.id, entry.source, { description: "Video synopsis", collection: { ...entry.collection, index: 0 } }, true);
    expect(session.state.queue[0]).toMatchObject({ description: "Video synopsis", collection: entry.collection });
  } finally { session.close(); store.close(); }
});
