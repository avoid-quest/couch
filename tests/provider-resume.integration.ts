import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/server/validation";
import { createSession } from "../src/server/session";
import { playbackMediaId } from "../src/server/progress";
import { openStore } from "../src/server/store";
import type { PlaybackCommand, QueueEntry, SessionState } from "../src/shared/protocol";

const url = "https://www.youtube.com/watch?v=abcdefghijk";
const collection = { title: "Selected list", url: "https://www.youtube.com/playlist?list=PLselected123", index: 2 };
const action = { type: "enqueueProvider", provider: "youtube", url, shape: "atom", title: "Video", playNow: true, quality: "720p", collection, deviceId: "tv" };
const parse = (fields: Record<string, unknown> = {}) => parseCommand(JSON.stringify({ type: "command", requestId: "resume", action: { ...action, ...fields } }));

test("provider playback retains explicit resume/start intent with occurrence, quality and destination", () => {
  for (const fromStart of [false, true]) {
    const command = parse({ fromStart });
    assert.equal(command.type, "command");
    assert.deepEqual(command.action, { ...action, fromStart });
  }
  assert.deepEqual(parse().action, action, "ordinary Play must not gain restart intent");
});

test("provider restart intent requires a boolean on immediate playback", () => {
  for (const fields of [{ fromStart: "true" }, { fromStart: 1 }, { fromStart: null }, { fromStart: true, playNow: false }, { fromStart: false, playNow: undefined }]) {
    assert.throws(() => parse(fields), /Invalid command/);
  }
});

// Session is the resume-position authority. Use its real store, media identity
// and intake, replacing only stream resolution; no Core/helpers or network.
for (const fromStart of [false, true]) test(`selected occurrence ${fromStart ? "starts over" : "resumes the same media"} in Session`, async () => {
  const store = openStore(":memory:"), commands: PlaybackCommand[] = [];
  const previous: QueueEntry = { id: "previous", source: `web:${url}`, title: "Video", collection: { ...collection, index: 0 } };
  const mediaId = playbackMediaId(previous)!;
  store.saveProgress(store.activeProfile().id, { mediaId, title: previous.title, position: 45, duration: 100, watched: false, lastPlayedAt: 1 }, previous);
  let state: SessionState | undefined;
  const session = createSession({ ...store, ...store.playback("selected") }, command => commands.push(command), next => { state = structuredClone(next); }, {
    resolveSource: entry => ({ source: entry.source.slice(4) }),
  });
  try {
    const command = parse({ fromStart });
    assert.equal(command.action.type, "enqueueProvider");
    if (command.action.type !== "enqueueProvider") throw new Error("Expected provider intake");
    const selected = command.action;
    session.playNewEntries([{ id: "selected", title: selected.title!, source: `web:${selected.url}`, collection: selected.collection, quality: selected.quality }], { fromStart: selected.fromStart });
    await new Promise<void>(resolve => setImmediate(resolve));
    const load = commands.find(command => command.type === "load");
    assert.ok(load, "Session must issue a player load");
    assert.equal(load.startPosition ?? 0, fromStart ? 0 : 45);
    assert.deepEqual(state?.queue.find(entry => entry.id === state!.currentEntryId)?.collection, collection);
    assert.equal(playbackMediaId(state!.queue.at(-1)!), mediaId, "selected occurrence must retain canonical media identity");
  } finally { session.close(); store.close(); }
});
