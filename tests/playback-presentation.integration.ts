import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, type MediaSource } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { PlaybackCommand, SessionState } from "../src/shared/protocol";
import type { WebMediaSource } from "../src/server/web-media";

test("only explicit starts request a new picture presentation", async () => {
  const store = openStore(":memory:");
  let state: SessionState;
  const session = createSession({ ...store, ...store.playback("screen") }, () => {}, next => { state = structuredClone(next); }, {
    resolveSource: entry => ({ source: entry.source.replace(/^web:/, "") }),
  });
  const actor = { deviceId: "phone", name: "Phone" };
  const entry = (id: string) => ({ id, title: id, source: `web:https://media.example/${id}.mp4` });
  try {
    session.command({ type: "enqueue", entry: entry("one"), playNow: true }, undefined, actor);
    const first = state!.presentationId;
    assert.ok(first);
    session.command({ type: "enqueue", entry: entry("two"), playNow: false }, undefined, actor);
    session.command({ type: "next", playbackId: state!.player.playbackId! }, undefined, actor);
    assert.equal(state!.currentEntryId, "two");
    assert.equal(state!.presentationId, null, "Next must not pull a screen out of browsing");
    session.command({ type: "play", entryId: "one" }, undefined, actor);
    assert.ok(state!.presentationId);
    assert.notEqual(state!.presentationId, first, "explicit replay opens its picture again");
    session.command({ type: "enqueue", entry: entry("three"), playNow: false }, undefined, actor);
    session.observe({ ...state!.player, status: "playing", position: 0, duration: 100, seekable: true });
    const explicit = state!.presentationId;
    await session.command({ type: "videoQuality", playbackId: state!.player.playbackId!, quality: "720p" }, undefined, actor);
    assert.equal(state!.presentationId, explicit, "quality reload keeps the same presentation");
    session.observe({ ...state!.player, status: "ended", position: 100, duration: 100, seekable: true });
    assert.equal(state!.currentEntryId, "three");
    assert.equal(state!.presentationId, null, "automatic advance must not pull a screen out of browsing");
  } finally { session.close(); store.close(); }
});

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const replacement: WebMediaSource = {
  source: "https://media.example/fresh.mp3?token=private", audioSource: "https://media.example/audio.mp3?token=private",
  publicNetwork: true, headers: { authorization: "private" }, metadata: { title: "Replacement metadata", duration: 240 },
  expiry: { at: Date.now() + 60_000, recover: async () => null },
};

function recoveringSession(prepareRecoveredSource: (media: WebMediaSource, playbackId: string, signal: AbortSignal) => Promise<MediaSource>) {
  const store = openStore(":memory:");
  const recovery = Promise.withResolvers<WebMediaSource | null>();
  const commands: PlaybackCommand[] = [];
  let state: SessionState, recoverySignal: AbortSignal | undefined;
  const session = createSession({ ...store, ...store.playback("recovery") }, command => commands.push(structuredClone(command)), next => { state = structuredClone(next); }, {
    resolveSource: () => ({ source: "http://127.0.0.1:3800/api/relay/original", expiry: { at: 0, recover: signal => { recoverySignal = signal; return recovery.promise; } } }),
    prepareRecoveredSource,
  });
  session.command({ type: "enqueue", entry: { id: "track", title: "Track", source: "web:https://artist.bandcamp.com/track/example" }, playNow: true });
  session.observe({ ...state!.player, status: "paused", position: 37, duration: 240, seekable: true, speed: 1.25 });
  const originalId = state!.player.playbackId!, presentation = state!.presentationId;
  session.observe({ ...state!.player, status: "error", error: "HTTP 410" });
  return { session, recovery, commands, originalId, presentation, get state() { return state!; }, get recoverySignal() { return recoverySignal; },
    close() { session.close(); store.close(); } };
}

test("expiry recovery prepares public media for the new transport and sends only its protected sources", async () => {
  let prepared: { media: WebMediaSource; playbackId: string; signal: AbortSignal } | undefined;
  const f = recoveringSession(async (media, playbackId, signal) => {
    prepared = { media, playbackId, signal };
    return { ...media, source: `http://127.0.0.1:3800/api/relay/${playbackId}/video`, audioSource: `http://127.0.0.1:3800/api/relay/${playbackId}/audio` };
  });
  try {
    f.recovery.resolve(replacement);
    await flush();
    assert.ok(prepared);
    assert.equal(prepared.media, replacement);
    assert.equal(prepared.media.publicNetwork, true);
    assert.notEqual(prepared.playbackId, f.originalId);
    assert.equal(prepared.playbackId, f.state.player.playbackId);
    assert.equal(prepared.signal, f.recoverySignal);
    assert.equal(prepared.signal.aborted, false);
    const loads = f.commands.filter(command => command.type === "load");
    assert.equal(loads.length, 2);
    const loaded = loads[1]!;
    assert.equal(loaded.source, `http://127.0.0.1:3800/api/relay/${prepared.playbackId}/video`);
    assert.equal(loaded.audioSource, `http://127.0.0.1:3800/api/relay/${prepared.playbackId}/audio`);
    assert.equal(loaded.playbackId, prepared.playbackId);
    assert.equal(loaded.startPosition, 37);
    assert.equal(loaded.paused, true);
    assert.equal(loaded.preferences?.speed, 1.25);
    for (const field of ["headers", "metadata", "expiry", "publicNetwork"]) assert.equal(field in loaded, false);
    assert.equal(f.state.presentationId, f.presentation);
  } finally { f.close(); }
});

test("Stop during source recovery prevents late media from entering protected preparation", async () => {
  let preparations = 0;
  const f = recoveringSession(async media => { preparations++; return media; });
  try {
    await flush();
    assert.ok(f.recoverySignal);
    f.session.command({ type: "stop" });
    assert.equal(f.recoverySignal.aborted, true);
    const commands = f.commands.length;
    const stopped = structuredClone(f.state.player);
    f.recovery.resolve(replacement);
    await flush();
    assert.equal(preparations, 0);
    assert.equal(f.commands.length, commands);
    assert.deepEqual(f.state.player, stopped);
    assert.equal(f.state.currentEntryId, null);
  } finally { f.close(); }
});

test("Stop aborts protected recovery preparation and rejects its late load", async () => {
  const preparation = Promise.withResolvers<MediaSource>();
  let preparationSignal: AbortSignal | undefined;
  const f = recoveringSession(async (_media, _playbackId, signal) => { preparationSignal = signal; return preparation.promise; });
  try {
    f.recovery.resolve(replacement);
    await flush();
    assert.ok(preparationSignal);
    f.session.command({ type: "stop" });
    assert.equal(preparationSignal.aborted, true);
    const commands = f.commands.length;
    const stopped = structuredClone(f.state.player);
    preparation.resolve({ source: "http://127.0.0.1:3800/api/relay/late" });
    await flush();
    assert.equal(f.commands.length, commands);
    assert.deepEqual(f.state.player, stopped);
    assert.equal(f.state.currentEntryId, null);
  } finally { f.close(); }
});

test("refused recovery preparation fails without exposing the fresh public URL", async () => {
  const f = recoveringSession(async () => { throw new Error("Destination refused."); });
  try {
    f.recovery.resolve(replacement);
    await flush();
    assert.equal(f.commands.filter(command => command.type === "load").length, 1);
    assert.equal(f.state.player.status, "error");
    assert.equal(f.state.player.error, "Destination refused.");
  } finally { f.close(); }
});
