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
