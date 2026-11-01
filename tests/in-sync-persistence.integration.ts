import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../src/server/sqlite";
import { openStore } from "../src/server/store";
import { liveFixture, until } from "./live-input.fixture";

test("older Playback rows default In sync to false", () => {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "old-sync-")), path = join(directory, "couch.sqlite");
  try {
    const db = new Database(path);
    db.exec("CREATE TABLE playback (id TEXT PRIMARY KEY, queue TEXT NOT NULL, cursor TEXT, continuation TEXT); INSERT INTO playback VALUES ('older', '[]', NULL, NULL)");
    db.close();
    const store = openStore(path);
    try { assert.equal(store.playback("older").inSync(), false); }
    finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("In sync survives a Core restart without restoring publication or output authority", { timeout: 15_000 }, async t => {
  const f = await liveFixture(); t.after(async () => { assert.deepEqual(await f.close(), { children: [], workers: [] }); });
  const receiver = f.receiver;
  assert.equal((await receiver.command({ type: "enqueue", entry: { id: "retained", title: "Retained queue", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
  await until(() => !!receiver.load()); receiver.report({ status: "paused" });
  await until(() => receiver.state.player.status === "paused");
  assert.equal((await receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } })).ok, true);
  assert.equal((await receiver.command({ type: "inSync", inSync: true })).ok, true);
  const playbackId = receiver.state.playback;
  await f.publish("before-restart");
  await f.restart();
  const restored = await f.connect(1), publisher = await f.connect(0), other = await f.connect(2, "&audio=1&video=1");
  const playback = restored.state.playbacks?.find(item => item.id === playbackId);
  assert.ok(playback, "the retained queue restores the same Playback");
  assert.equal(playback.inSync, true, "the accepted preference survives the restart");
  assert.deepEqual(playback.outputs, [], "output assignments remain runtime-only");
  assert.deepEqual(restored.state.liveSources, [], "publication and admission are not restored");
  assert.equal((await restored.command({ type: "output", deviceId: restored.id, level: 80 })).ok, true);
  assert.equal((await restored.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
  f.answerUploads(publisher);
  assert.equal((await publisher.command({ type: "publishLive", sourceId: "new-capture", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
  assert.equal((await restored.command({ type: "playLive", sourceId: "new-capture" })).ok, true);
  await until(() => restored.state.playbacks?.find(item => item.id === playbackId)?.liveSourceId === "new-capture");
  const admitted = restored.state.playbacks!.find(item => item.id === playbackId)!;
  assert.equal(admitted.delivery, "scheduled", "a newly admitted relaxed capture follows the saved In sync preference");
  assert.equal(admitted.outputs.length, 2);
  assert.equal((await restored.command({ type: "inSync", inSync: false })).ok, true);
  await until(() => restored.state.playbacks?.find(item => item.id === playbackId)?.delivery === "webrtc");
  await f.restart();
  const disabled = await f.connect(1);
  assert.equal(disabled.state.playbacks?.find(item => item.id === playbackId)?.inSync, undefined, "turning the preference off persists too");
});
