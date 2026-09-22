import { expect, spyOn, test } from "bun:test";
import { createSession, type MediaSource } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(resolve?: (id: string, signal: AbortSignal, preparing: boolean) => MediaSource | Promise<MediaSource>) {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const transitions: string[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, {
    resolveSource: (entry, _id, signal, _fromStart, _goLive, preparing) => resolve?.(entry.id, signal, !!preparing) ?? { source: entry.source, audioOnly: true, headers: { Authorization: "private-token" } },
    activatePrepared: id => transitions.push(id),
  });
  session.observe(idle);
  for (const id of ["first", "second", "third"]) session.command({ type: "enqueue", entry: { id, title: id, source: `library:${id}` } });
  session.command({ type: "play", entryId: "first", fromStart: true });
  const firstId = session.state.player.playbackId!;
  session.observe({ ...idle, playbackId: firstId, status: "playing", position: 2, duration: 3 });
  return { store, session, commands, firstId, transitions, close() { session.close(); store.close(); } };
}

test("one host-only successor advances identity and checkpoints the previous track once", async () => {
  const f = fixture();
  try {
    await tick();
    const command = f.commands.find(command => command.type === "prepare" && command.next);
    expect(command?.type).toBe("prepare");
    if (command?.type !== "prepare" || !command.next) throw new Error("Missing prepared successor");
    expect(command.playbackId).toBe(f.firstId);
    expect(command.next.headers).toEqual({ Authorization: "private-token" });
    expect(JSON.stringify(f.session.state)).not.toContain("private-token");
    const next = { ...idle, playbackId: command.next.playbackId, status: "playing" as const, position: 0.1, duration: 3 };
    f.session.observe(next);
    f.session.observe(next);
    expect(f.session.state.currentEntryId).toBe("second");
    expect(f.session.state.queueCursorEntryId).toBe("second");
    expect(f.transitions).toEqual([command.next.playbackId]);
    expect(f.store.progress("household", "library:first")).toMatchObject({ watched: true, position: 0 });
    expect(f.commands.filter(command => command.type === "load")).toHaveLength(1);
    f.session.observe({ ...idle, playbackId: f.firstId, status: "ended", position: 3 });
    expect(f.session.state.currentEntryId).toBe("second");
  } finally { f.close(); }
});

test("reordering and removing invalidate the native successor before selecting another", async () => {
  const f = fixture();
  try {
    await tick();
    f.session.command({ type: "move", entryId: "third", beforeEntryId: "second" });
    expect(f.commands.at(-1)).toEqual({ type: "prepare", playbackId: f.firstId });
    await tick();
    const command = f.commands.at(-1);
    expect(command?.type === "prepare" && command.next?.source).toBe("library:third");
    f.session.command({ type: "remove", entryId: "third" });
    expect(f.commands.at(-1)).toEqual({ type: "prepare", playbackId: f.firstId });
    await tick();
    f.session.command({ type: "stop" });
    expect(f.commands.slice(-2)).toEqual([{ type: "prepare", playbackId: f.firstId }, { type: "stop" }]);
  } finally { f.close(); }
});

test("a slow obsolete source cannot prepare or restart after queue replacement", async () => {
  const pending = Promise.withResolvers<MediaSource>();
  let signal: AbortSignal | undefined;
  const f = fixture((_id, current, preparing) => {
    if (preparing) { signal = current; return pending.promise; }
    return { source: "file:///first.flac", audioOnly: true };
  });
  try {
    await tick();
    f.session.loadQueue([{ id: "replacement", title: "Replacement", source: "library:replacement" }], "replace");
    expect(signal?.aborted).toBe(true);
    pending.resolve({ source: "file:///obsolete.flac", audioOnly: true });
    await tick();
    expect(f.commands.some(command => command.type === "prepare" && command.next)).toBe(false);
    expect(f.session.state.currentEntryId).toBeNull();
    const restarted = createSession(f.store, command => f.commands.push(command), () => {});
    restarted.observe(idle);
    expect(restarted.state.currentEntryId).toBeNull();
    expect(restarted.state.player.status).toBe("idle");
    restarted.close();
  } finally { f.close(); }
});

test("a newer pending Play cancels preparation and native observations cannot rearm it", async () => {
  const f = fixture();
  try {
    await tick();
    f.session.reservePlay();
    expect(f.commands.at(-1)).toEqual({ type: "prepare", playbackId: f.firstId });
    const count = f.commands.length;
    f.session.observe({ ...idle, playbackId: f.firstId, status: "playing", position: 2.5, duration: 3 });
    await tick();
    expect(f.commands).toHaveLength(count);
  } finally { f.close(); }
});

test("failed preparation preserves the song and ordinary next-source error controls", async () => {
  const f = fixture(id => {
    if (id === "second") throw new Error("The mounted audio file is unavailable.");
    return { source: "file:///first.flac", audioOnly: true };
  });
  try {
    await tick();
    expect(f.session.state.player.status).toBe("playing");
    f.session.observe({ ...idle, playbackId: f.firstId, status: "ended", position: 3, duration: 3 });
    expect(f.session.state.currentEntryId).toBe("second");
    expect(f.session.state.player).toMatchObject({ status: "error", error: "The mounted audio file is unavailable." });
    f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! });
    expect(f.session.state.currentEntryId).toBe("third");
  } finally { f.close(); }
});

test("audio loss pauses the actual native session while adopting an already started successor", async () => {
  const f = fixture();
  try {
    await tick();
    const prepared = f.commands.find(command => command.type === "prepare" && command.next);
    if (prepared?.type !== "prepare" || !prepared.next) throw new Error("Missing successor");
    f.session.observe({ ...f.session.state.player, seekable: true });
    f.session.audioLost("HDMI disconnected");
    expect(f.commands.at(-1)).toEqual({ type: "audioPause" });
    f.session.observe({ ...idle, playbackId: prepared.next.playbackId, status: "paused", seekable: true, duration: 3 });
    expect(f.session.state.currentEntryId).toBe("second");
    expect(f.session.state.player.status).toBe("paused");
    expect(f.session.state.player.error).toBe("HDMI disconnected");
    await tick();
    expect(f.commands.filter(command => command.type === "prepare" && command.next)).toHaveLength(1);
    expect(f.transitions).toEqual([prepared.next.playbackId]);
  } finally { f.close(); }
});

test("audio loss aborts unresolved successor preparation", async () => {
  const pending = Promise.withResolvers<MediaSource>();
  const f = fixture((_id, _signal, preparing) => preparing ? pending.promise : { source: "file:///first.flac", audioOnly: true });
  try {
    await tick();
    f.session.observe({ ...f.session.state.player, seekable: true });
    f.session.audioLost("HDMI disconnected");
    pending.resolve({ source: "file:///second.flac", audioOnly: true });
    await tick();
    expect(f.commands.some(command => command.type === "prepare" && command.next)).toBe(false);
    expect(f.session.state.player.status).toBe("paused");
  } finally { f.close(); }
});

test("a queue-position write failure still adopts the track already started by the native player", async () => {
  const f = fixture();
  const save = spyOn(f.store, "saveQueueCursor").mockImplementation(() => { throw new Error("Disk full"); });
  try {
    await tick();
    const command = f.commands.find(command => command.type === "prepare" && command.next);
    if (command?.type !== "prepare" || !command.next) throw new Error("Missing prepared successor");
    f.session.observe({ ...idle, playbackId: command.next.playbackId, status: "playing", position: 0.1, duration: 3 });
    expect(f.session.state).toMatchObject({ currentEntryId: "second", queueCursorEntryId: "second", player: { playbackId: command.next.playbackId, status: "playing" } });
    expect(f.session.state.queueError).toContain("Could not save the queue position");
    save.mockRestore();
    f.session.command({ type: "stop" });
    f.session.command({ type: "play", entryId: "second" });
    expect(f.session.state.queueError).toBeNull();
  } finally { save.mockRestore(); f.close(); }
});

test("failed predecessor completions survive consecutive prepared transitions and recover", async () => {
  const f = fixture();
  const originalSave = f.store.saveProgress.bind(f.store);
  let unavailable = true;
  const save = spyOn(f.store, "saveProgress").mockImplementation((...args) => {
    if (unavailable) throw new Error("Disk full");
    originalSave(...args);
  });
  try {
    await tick();
    const second = f.commands.find(command => command.type === "prepare" && command.next);
    if (second?.type !== "prepare" || !second.next) throw new Error("Missing second track");
    const secondId = second.next.playbackId;
    expect(() => f.session.observe({ ...idle, playbackId: secondId, status: "playing", position: 0.1, duration: 3 })).not.toThrow();
    await tick();
    const third = f.commands.findLast(command => command.type === "prepare" && command.next);
    if (third?.type !== "prepare" || !third.next) throw new Error("Missing third track");
    const thirdId = third.next.playbackId;
    expect(() => f.session.observe({ ...idle, playbackId: thirdId, status: "playing", position: 0.1, duration: 3 })).not.toThrow();
    expect(f.store.progress("household", "library:first")).toMatchObject({ watched: false, position: 2 });
    expect(f.store.progress("household", "library:second")).toBeNull();
    expect(f.session.state).toMatchObject({ currentEntryId: "third", progressError: "Could not save viewing progress. Check the TV's storage." });
    unavailable = false;
    f.session.checkpoint();
    expect(f.store.progress("household", "library:first")).toMatchObject({ watched: true, position: 0 });
    expect(f.store.progress("household", "library:second")).toMatchObject({ watched: true, position: 0 });
    expect(f.session.state.progressError).toBeNull();
  } finally { save.mockRestore(); f.close(); }
});

test("manual history changes discard a failed predecessor checkpoint", async () => {
  const f = fixture();
  const originalSave = f.store.saveProgress.bind(f.store);
  let unavailable = true;
  const save = spyOn(f.store, "saveProgress").mockImplementation((...args) => {
    if (unavailable) throw new Error("Disk full");
    originalSave(...args);
  });
  try {
    await tick();
    const next = f.commands.find(command => command.type === "prepare" && command.next);
    if (next?.type !== "prepare" || !next.next) throw new Error("Missing successor");
    f.session.observe({ ...idle, playbackId: next.next.playbackId, status: "playing", position: 0.1, duration: 3 });
    unavailable = false;
    f.session.editProgress("library:first", { watched: false }, { title: "first", libraryItemId: "first" });
    f.session.checkpoint();
    expect(f.store.progress("household", "library:first")).toMatchObject({ watched: false, position: 2 });
  } finally { save.mockRestore(); f.close(); }
});

test("removing history discards a failed predecessor checkpoint", async () => {
  const f = fixture();
  const originalSave = f.store.saveProgress.bind(f.store);
  let unavailable = true;
  const save = spyOn(f.store, "saveProgress").mockImplementation((...args) => {
    if (unavailable) throw new Error("Disk full");
    originalSave(...args);
  });
  try {
    await tick();
    const next = f.commands.find(command => command.type === "prepare" && command.next);
    if (next?.type !== "prepare" || !next.next) throw new Error("Missing successor");
    f.session.observe({ ...idle, playbackId: next.next.playbackId, status: "playing", position: 0.1, duration: 3 });
    unavailable = false;
    f.session.removeHistory("library:first");
    f.session.checkpoint();
    expect(f.store.progress("household", "library:first")).toBeNull();
  } finally { save.mockRestore(); f.close(); }
});

test("a prepared successor keeps its shared history owner and existing watched mark", async () => {
  const f = fixture();
  try {
    const older = f.store.createProfile("Older history");
    const mediaId = "library:second";
    f.store.saveProgress(older.id, { mediaId, libraryItemId: "second", title: "second", position: 0, duration: 3, watched: true, lastPlayedAt: 100 });
    await tick();
    const prepared = f.commands.find(command => command.type === "prepare" && command.next);
    if (prepared?.type !== "prepare" || !prepared.next) throw new Error("Missing prepared successor");
    f.session.observe({ ...idle, playbackId: prepared.next.playbackId, status: "playing", position: 0.1, duration: 3, seekable: true });
    expect(f.store.sharedProgress(mediaId)).toMatchObject({ watched: true, position: 0.1 });
    expect(f.store.progress(older.id, mediaId)).toMatchObject({ watched: true, position: 0.1 });
    expect(f.store.progress("household", mediaId)).toBeNull();
    expect(f.session.state.activeProfile.id).toBe("household");
    expect(f.transitions).toEqual([prepared.next.playbackId]);
  } finally { f.close(); }
});
