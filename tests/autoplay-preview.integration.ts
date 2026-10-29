import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { SessionState } from "../src/shared/protocol";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const entry = (id: string) => ({ id, title: id, source: `web:https://media.example/${id}.mp4` });

test("Up next previews the entries Autoplay picked without republishing unchanged picks", async () => {
  const store = openStore(":memory:");
  let state: SessionState | undefined;
  let snapshots = 0;
  const session = createSession({ ...store, ...store.playback("autoplay") }, () => {}, (next, clock) => { state = structuredClone(next); if (!clock) snapshots++; }, {
    resolveSource: item => ({ source: item.source.replace(/^web:/, "") }),
    resolveContinuation: () => ({ title: "Series", entries: Array.from({ length: 12 }, (_, index) => entry(`episode-${index + 1}`)) }),
  });
  try {
    session.command({ type: "enqueue", entry: entry("pilot"), playNow: true });
    await flush();
    assert.equal(state!.autoplay?.contextTitle, "Series");
    assert.equal(state!.autoplay?.pending, undefined);
    assert.deepEqual(state!.autoplay?.upcoming.map(item => item.id), Array.from({ length: 10 }, (_, index) => `episode-${index + 1}`));

    session.observe({ ...state!.player, status: "playing", position: 1, duration: 100, seekable: true });
    const settled = snapshots;
    session.observe({ ...state!.player, position: 2 });
    session.observe({ ...state!.player, position: 3 });
    assert.equal(snapshots, settled, "unchanged Autoplay picks must not send whole snapshots");

    session.command({ type: "next", playbackId: state!.player.playbackId! });
    assert.equal(state!.queue.at(-1)?.source, entry("episode-1").source);
    assert.deepEqual(state!.autoplay?.upcoming.map(item => item.id), Array.from({ length: 10 }, (_, index) => `episode-${index + 2}`));
  } finally { session.close(); store.close(); }
});

test("playing an Autoplay pick keeps queued items and continues after the chosen pick", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("autoplay");
  const loads: string[] = [];
  const session = createSession({ ...store, ...playback }, command => { if (command.type === "load") loads.push(command.source); }, () => {}, {
    resolveSource: item => ({ source: item.source.replace(/^web:/, "") }),
    resolveContinuation: () => ({ title: "Series", entries: [entry("one"), entry("two"), entry("three")] }),
  });
  try {
    session.command({ type: "enqueue", entry: entry("pilot"), playNow: true });
    await flush();
    session.command({ type: "enqueue", entry: entry("manually-queued") });
    const before = session.state;
    assert.throws(() => session.command({ type: "play", entryId: "two" }, () => { throw new Error("Not authorized"); }), /Not authorized/);
    assert.deepEqual(session.state, before);
    session.command({ type: "preferences", profileId: session.state.activeProfile.id, preferences: { autoplay: false } });
    assert.throws(() => session.command({ type: "play", entryId: "two" }), /no longer exists/);
    session.command({ type: "preferences", profileId: session.state.activeProfile.id, preferences: { autoplay: true } });
    session.command({ type: "play", entryId: "two" });
    assert.equal(session.state.currentEntryId, "two");
    assert.deepEqual(session.state.queue.map(item => item.id), ["pilot", "two", "manually-queued"]);
    assert.deepEqual(session.state.autoplay?.upcoming.map(item => item.id), ["three"]);
    assert.deepEqual(playback.playbackContinuation()?.entries.map(item => item.id), ["three"]);
    assert.equal(loads.at(-1), "https://media.example/two.mp4");

    // Manual entries still play before the rest of the collection.
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    assert.equal(session.state.currentEntryId, "manually-queued");
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    assert.equal(session.state.currentEntryId, "three");
    assert.equal(loads.at(-1), "https://media.example/three.mp4");
    assert.equal(session.state.queue.filter(item => item.id === "two").length, 1);
    assert.throws(() => session.command({ type: "play", entryId: "one" }), /no longer exists/);
  } finally { session.close(); store.close(); }
});

test("playing an Autoplay pick cannot evict a waiting entry from a full queue", async () => {
  const store = openStore(":memory:");
  const session = createSession({ ...store, ...store.playback("autoplay") }, () => {}, () => {}, {
    resolveSource: item => ({ source: item.source }),
    resolveContinuation: () => ({ title: "Series", entries: [entry("suggestion")] }),
  });
  try {
    session.command({ type: "enqueue", entry: entry("pilot"), playNow: true });
    await flush();
    session.loadQueue(Array.from({ length: 499 }, (_, index) => entry(`waiting-${index}`)), "append");
    const before = session.state;
    assert.throws(() => session.command({ type: "play", entryId: "suggestion" }), /Up next is full/);
    assert.deepEqual(session.state, before);
  } finally { session.close(); store.close(); }
});

test("playing an Autoplay pick makes room in a full queue by retiring only played history", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("autoplay");
  const session = createSession({ ...store, ...playback }, () => {}, () => {}, {
    resolveSource: item => ({ source: item.source }),
    resolveContinuation: () => ({ title: "Series", entries: [entry("suggestion"), entry("following")] }),
  });
  try {
    session.loadQueue(Array.from({ length: 500 }, (_, index) => entry(`episode-${index}`)), "replace");
    const queue = session.state.queue;
    session.command({ type: "play", entryId: queue[0]!.id });
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    await flush();
    session.command({ type: "play", entryId: "suggestion" });
    assert.equal(session.state.currentEntryId, "suggestion");
    assert.equal(session.state.queue.length, 500);
    assert.deepEqual(session.state.queue.map(item => item.id), [queue[1]!.id, "suggestion", ...queue.slice(2).map(item => item.id)]);
    assert.deepEqual(store.playback("autoplay").queue.map(item => item.id), session.state.queue.map(item => item.id));
    assert.deepEqual(session.state.autoplay?.upcoming.map(item => item.id), ["following"]);
  } finally { session.close(); store.close(); }
});
