import { expect, test } from "bun:test";
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
