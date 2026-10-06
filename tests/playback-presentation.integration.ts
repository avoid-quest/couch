import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { SessionState } from "../src/shared/protocol";

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
