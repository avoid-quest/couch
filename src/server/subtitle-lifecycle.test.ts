import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { createSession } from "./session";
import { openStore } from "./store";
import { createSubtitles } from "./subtitles";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const packet = (type: number, size = 0) => { const bytes = Buffer.alloc(13 + size); bytes.write("PG"); bytes[10] = type; bytes.writeUInt16BE(size, 11); return bytes; };
const pgs = Buffer.concat([packet(0x16, 11), packet(0x15, 4), packet(0x80)]);

function fixture() {
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(pgs) });
  cleanup.push(() => upstream.stop(true));
  const store = openStore(":memory:"); cleanup.push(() => store.close());
  const commands: PlaybackCommand[] = [], observed: PlayerState[] = [];
  const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  const paths = new Map<string, string>();
  const ready = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  const session = createSession(store, command => commands.push(command), () => {}, {
    async resolveSource(entry, playbackId, signal) {
      const origin = `http://127.0.0.1:${upstream.port}`;
      const media = await subtitles.prepare({ source: `${origin}/movie`, subtitles: [{ source: `${origin}/Stream.pgssub`, title: "PGS" }] }, playbackId, signal);
      paths.set(entry.id, media.subtitles![0]!.source);
      ready.get(entry.id)!.resolve();
      await gates.get(entry.id)?.promise;
      return media;
    },
    observe: player => { observed.push(player); subtitles.observe(player); },
    stopped: playbackId => subtitles.stopped(playbackId),
  });
  const subtitles = createSubtitles(() => session.state.player, (playbackId, subtitle) => session.addSubtitle(playbackId, subtitle));
  cleanup.push(() => { session.close(); subtitles.close(); });
  session.observe(idle);
  const play = async (id: string, held = false) => {
    ready.set(id, Promise.withResolvers<void>());
    if (held) gates.set(id, Promise.withResolvers<void>());
    session.command({ type: "enqueue", entry: { id, source: `jellyfin:${id}`, title: id } });
    session.command({ type: "play", entryId: id });
    await ready.get(id)!.promise; await Bun.sleep(0);
    return session.state.player.playbackId!;
  };
  return { session, commands, observed, gates, paths, play };
}

for (const acknowledgementFirst of [true, false]) test(`failed replacement releases retired PGS after native Stop, acknowledgement first=${acknowledgementFirst}`, async () => {
  const { session, paths, gates, play, observed } = fixture();
  const a = await play("A");
  session.observe({ ...idle, playbackId: a, status: "playing" });
  const b = await play("B", true);
  const oldFile = paths.get("A")!, pendingFile = paths.get("B")!;
  expect(existsSync(oldFile)).toBe(true);
  const observations = observed.length;
  if (acknowledgementFirst) session.observe(idle);
  gates.get("B")!.reject(new Error("Replacement failed before native load"));
  await Bun.sleep(0);
  if (!acknowledgementFirst) { expect(existsSync(oldFile)).toBe(true); session.observe(idle); }
  expect(existsSync(oldFile)).toBe(false);
  expect(existsSync(pendingFile)).toBe(acknowledgementFirst);
  expect(session.state.player).toMatchObject({ playbackId: b, status: "error", error: "Replacement failed before native load" });
  expect(observed.length).toBe(observations);
  // The failure sends a second Stop. Its acknowledgement retires B's never-loaded file too.
  session.observe(idle);
  expect(existsSync(pendingFile)).toBe(false);
  expect(session.state.player).toMatchObject({ playbackId: b, status: "error" });
});

test("late A Stop preserves prepared and loaded B files without publishing stale state or reporting it", async () => {
  const { session, commands, paths, gates, play, observed } = fixture();
  const a = await play("A"); session.observe({ ...idle, playbackId: a, status: "playing" });
  const b = await play("B", true);
  const observations = observed.length;
  session.observe(idle);
  expect(existsSync(paths.get("A")!)).toBe(false);
  expect(existsSync(paths.get("B")!)).toBe(true);
  expect(session.state.player).toMatchObject({ playbackId: b, status: "loading" });
  expect(observed.length).toBe(observations);
  gates.get("B")!.resolve(); await Bun.sleep(0);
  expect(commands.at(-1)).toMatchObject({ type: "load", playbackId: b });
  session.observe({ ...idle, playbackId: b, status: "playing" });
  session.observe(idle); session.observe({ ...idle, playbackId: a, status: "playing" });
  expect(session.state.player).toMatchObject({ playbackId: b, status: "playing" });
  expect(observed.length).toBe(observations + 1);
  expect(existsSync(paths.get("B")!)).toBe(true);
});
