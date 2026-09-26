import { afterEach, expect, spyOn, test } from "bun:test";
import type { PlaybackCommand, PlayerState, QueueEntry } from "../shared/protocol";
import { createSession } from "./session";
import { openStore } from "./store";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const entry = (id: string): QueueEntry => ({ id, title: id, source: `library:${id}` });
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture(options: Parameters<typeof createSession>[3] = {}) {
  const store = openStore(":memory:"), commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, options);
  session.observe(idle);
  cleanup.push(() => { session.close(); store.close(); });
  const observe = (status: PlayerState["status"], position = 100) => session.observe({ ...idle, playbackId: session.state.player.playbackId, status, position, duration: 100, seekable: true });
  const next = () => session.command({ type: "next", playbackId: session.state.player.playbackId! });
  return { store, session, commands, observe, next };
}

test("known continuation stays separate, drains manual queue first, and stops at its end", () => {
  const f = fixture();
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B"), entry("C")] } });
  expect(f.session.state.autoplay).toEqual({ enabled: true, contextTitle: "Album", next: entry("B") });
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A"]);
  f.session.command({ type: "enqueue", entry: entry("manual") });
  f.observe("ended");
  expect(f.session.state.currentEntryId).toBe("manual");
  expect(f.session.state.autoplay?.next?.id).toBe("B");
  f.next();
  expect(f.session.state.currentEntryId).toBe("B");
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A", "manual", "B"]);
  f.observe("ended");
  expect(f.session.state.currentEntryId).toBe("C");
  f.observe("ended");
  expect(f.session.state.player.status).toBe("ended");
  expect(f.session.state.autoplay?.next).toBeNull();
});

test("disabled Autoplay retains its preview but never advances automatically", () => {
  const f = fixture();
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B")] } });
  f.session.command({ type: "preferences", profileId: "household", preferences: { autoplay: false } });
  f.observe("ended");
  expect(f.session.state.currentEntryId).toBe("A");
  expect(f.session.state.autoplay).toEqual({ enabled: false, contextTitle: "Album", next: entry("B") });
  expect(f.store.playbackPreferences("household").profile.autoplay).toBe(false);
});

test.each(["stop", "play"])("late context resolution after %s cannot add or replace anything", async action => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: item => item.id === "A" ? pending.promise : null });
  f.session.playNewEntries([entry("A")]);
  if (action === "stop") f.session.command({ type: "stop" });
  else f.session.playNewEntries([entry("other")]);
  pending.resolve({ title: "Old album", entries: [entry("B")] });
  await Bun.sleep(0);
  expect(f.session.state.autoplay?.next).toBeNull();
  expect(f.session.state.queue.some(item => item.id === "B")).toBe(false);
});

test("EOF waits for the current context lookup and rechecks manual queue priority", async () => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: () => pending.promise });
  f.session.playNewEntries([entry("A")]);
  f.observe("ended");
  f.session.command({ type: "enqueue", entry: entry("manual") });
  pending.resolve({ title: "Album", entries: [entry("B")] });
  await Bun.sleep(0);
  expect(f.session.state.currentEntryId).toBe("manual");
  expect(f.session.state.autoplay?.next?.id).toBe("B");
});

test("early EOF and playback errors do not start Autoplay", () => {
  const f = fixture();
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B")] } });
  f.observe("ended", 20);
  expect(f.session.state.currentEntryId).toBe("A");
  f.observe("error");
  expect(f.session.state.currentEntryId).toBe("A");
});

test("Next waits for unresolved context and Stop cancels the pending handoff", async () => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: () => pending.promise });
  f.session.playNewEntries([entry("A")]);
  f.next();
  expect(f.session.state.autoplay?.pending).toBe(true);
  expect(f.session.state.currentEntryId).toBe("A");
  f.session.command({ type: "stop" });
  pending.resolve({ title: "Album", entries: [entry("B")] });
  await Bun.sleep(0);
  expect(f.session.state.currentEntryId).toBeNull();
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A"]);
  expect(f.store.playbackContinuation()).toBeNull();
});

test("failed context persistence rolls back replacement Play, progress, queue and current playback", () => {
  const f = fixture();
  const context = { title: "Album", entries: [entry("B")] };
  f.session.playNewEntries([entry("A")], { continuation: context });
  f.observe("playing", 95);
  const before = f.session.state, sent = f.commands.length;
  const failure = spyOn(f.store, "savePlaybackContinuation").mockImplementation(() => { throw new Error("Full disk"); });
  try {
    expect(() => f.session.playNewEntries([entry("other")], { continuation: null })).toThrow("Couldn't save your place in Up next");
    expect(f.session.state.queue).toEqual(before.queue);
    expect(f.session.state.player).toEqual(before.player);
    expect(f.session.state.autoplay).toEqual(before.autoplay);
    expect(f.store.queueCursorEntryId()).toBe("A");
    expect(f.store.playbackContinuation()).toEqual(context);
    expect(f.store.progress("household", "library:A")).toMatchObject({ position: 95, watched: false });
    expect(f.commands).toHaveLength(sent);
  } finally { failure.mockRestore(); }
  f.next();
  expect(f.session.state.currentEntryId).toBe("B");
});

test("failed automatic adoption leaves the successor outside the queue and retries from the same context", () => {
  let refuseAudio = false;
  const f = fixture({ prepareAudio: () => { if (refuseAudio) throw new Error("Audio route unavailable"); return "test-output"; } });
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B")] } });
  refuseAudio = true;
  expect(() => f.next()).toThrow("Audio route unavailable");
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A"]);
  expect(f.session.state.autoplay?.next?.id).toBe("B");
  refuseAudio = false;
  f.next();
  expect(f.session.state.currentEntryId).toBe("B");
  expect(f.session.state.autoplay?.next).toBeNull();
});

test("gapless Autoplay promotion commits only its current occurrence and cannot advance twice", async () => {
  const f = fixture({ resolveSource: item => ({ source: item.source, audioOnly: true }) });
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B"), entry("C")] } });
  const firstId = f.session.state.player.playbackId;
  f.observe("playing", 99);
  await Bun.sleep(0);
  const prepared = f.commands.find(command => command.type === "prepare" && command.next);
  if (prepared?.type !== "prepare" || !prepared.next) throw new Error("Expected native successor preparation");
  expect(prepared.next.source).toBe("library:B");
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A"]);
  const playing: PlayerState = { ...idle, playbackId: prepared.next.playbackId, status: "playing", position: 1, duration: 100 };
  f.session.observe(playing);
  f.session.observe(playing);
  f.session.observe({ ...idle, playbackId: firstId, status: "ended", position: 100, duration: 100 });
  expect(f.session.state.currentEntryId).toBe("B");
  expect(f.session.state.queue.map(item => item.id)).toEqual(["A", "B"]);
  expect(f.session.state.autoplay?.next?.id).toBe("C");
  expect(f.store.playbackContinuation()?.entries.map(item => item.id)).toEqual(["C"]);
  expect(f.commands.filter(command => command.type === "load")).toHaveLength(1);
});

test("a manual queue addition supersedes a prepared automatic successor", async () => {
  const f = fixture({ resolveSource: item => ({ source: item.source, audioOnly: true }) });
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B")] } });
  f.observe("playing", 99);
  await Bun.sleep(0);
  const old = f.commands.find(command => command.type === "prepare" && command.next);
  if (old?.type !== "prepare" || !old.next) throw new Error("Expected native successor preparation");
  f.session.command({ type: "enqueue", entry: entry("manual") });
  f.session.observe({ ...idle, playbackId: old.next.playbackId, status: "playing" });
  expect(f.session.state.currentEntryId).toBe("A");
  await Bun.sleep(0);
  const prepared = f.commands.findLast(command => command.type === "prepare" && command.next);
  expect(prepared).toMatchObject({ type: "prepare", next: { source: "library:manual" } });
  expect(f.session.state.autoplay?.next?.id).toBe("B");
});

test("manual playback consumes only the immediate matching continuation and retains deliberate repeats", () => {
  const f = fixture();
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B"), entry("C"), entry("D")] } });
  for (const [id, source] of [["manual-D", "D"], ["manual-B", "B"], ["repeat-B", "B"]]) f.session.command({ type: "enqueue", entry: { ...entry(id!), source: `library:${source}` } });
  f.next();
  expect(f.session.state.currentEntryId).toBe("manual-D");
  expect(f.session.state.autoplay?.next?.id).toBe("B");
  f.next();
  expect(f.session.state.currentEntryId).toBe("manual-B");
  expect(f.session.state.autoplay?.next?.id).toBe("C");
  f.next();
  expect(f.session.state.currentEntryId).toBe("repeat-B");
  expect(f.session.state.autoplay?.next?.id).toBe("C");
  f.next();
  expect(f.session.state.currentEntryId).toBe("C");
  expect(f.session.state.autoplay?.next?.id).toBe("D");
});

test("late context reconciles every manual transition in order without skipping unrelated matches", async () => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: () => pending.promise });
  f.session.playNewEntries([entry("A")]);
  for (const [id, source] of [["manual-D", "D"], ["manual-B", "B"], ["repeat-B", "B"], ["manual-C", "C"]]) {
    f.session.command({ type: "enqueue", entry: { ...entry(id!), source: `library:${source}` } });
    f.next();
  }
  pending.resolve({ title: "Album", entries: [entry("B"), entry("C"), entry("D")] });
  await Bun.sleep(0);
  expect(f.session.state.currentEntryId).toBe("manual-C");
  expect(f.session.state.autoplay?.next?.id).toBe("D");
  expect(f.store.playbackContinuation()?.entries.map(item => item.id)).toEqual(["D"]);
});

test.each([false, true])("pending Next rechecks authority and retains its actor (revoked: %s)", async revoked => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: () => pending.promise });
  const actor = { deviceId: "phone", name: "Phone" };
  let allowed = true;
  const authorize = () => { if (!allowed) throw new Error("Remote revoked"); };
  f.session.playNewEntries([entry("A")]);
  f.session.command({ type: "next", playbackId: f.session.state.player.playbackId! }, authorize, actor);
  allowed = !revoked;
  pending.resolve({ title: "Album", entries: [entry("B")] });
  await Bun.sleep(0);
  expect(f.session.state.currentEntryId).toBe(revoked ? "A" : "B");
  if (!revoked) expect(f.session.state.playedBy).toEqual(actor);
});

test.each(["profile", "remove profile", "audio lost"])("%s cancels a pending EOF handoff", async action => {
  const pending = Promise.withResolvers<{ title: string; entries: QueueEntry[] } | null>();
  const f = fixture({ resolveContinuation: () => pending.promise });
  const profile = f.session.createProfile("Other");
  if (action === "remove profile") f.session.selectProfile(profile.id);
  f.session.playNewEntries([entry("A")]);
  f.observe("ended");
  if (action === "profile") f.session.selectProfile(profile.id);
  else if (action === "remove profile") f.session.removeProfile(profile.id, profile.name);
  else f.session.audioLost("Audio route lost");
  pending.resolve({ title: "Album", entries: [entry("B")] });
  await Bun.sleep(0);
  expect(f.session.state.currentEntryId).toBe("A");
  expect(f.session.state.queue.some(item => item.id === "B")).toBe(false);
});

test("Stop silences playback and clears automatic continuation even when its storage write fails", () => {
  const f = fixture();
  f.session.playNewEntries([entry("A")], { continuation: { title: "Album", entries: [entry("B")] } });
  f.observe("playing", 50);
  const failure = spyOn(f.store, "savePlaybackContinuation").mockImplementation(() => { throw new Error("Full disk"); });
  try {
    expect(() => f.session.command({ type: "stop" })).not.toThrow();
    expect(f.commands.at(-1)).toEqual({ type: "stop" });
    expect(f.session.state.currentEntryId).toBeNull();
    expect(f.session.state.autoplay?.next).toBeNull();
    expect(f.session.state.queueError).toContain("Couldn't save Autoplay");
  } finally { failure.mockRestore(); }
});
