import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { openStore } from "../src/server/store";
import { parseCommand, parsePlayer } from "../src/server/validation";
import { liveFixture, until } from "./live-input.fixture";

const rejectedUpload = (url: string, origin: string) => new Promise<number>((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { Origin: origin } });
  socket.once("open", () => { socket.terminate(); reject(new Error("Unapproved uploader was admitted.")); });
  socket.once("unexpected-response", (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode!); });
  socket.on("error", () => {});
});

test("capture upload is paired, secret-bound and owned by the exact publishing window", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    assert.equal(f.publisher.state.playbacks?.length, 0);
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, false);
    assert.equal(JSON.stringify(f.receiver.state).includes(f.uploadToken), false);
    assert.equal(await rejectedUpload(f.uploadUrl("screen", "2".repeat(64)), f.hub.origin), 403);
    assert.equal(await rejectedUpload(f.uploadUrl("screen", f.uploadToken, 1), f.hub.origin), 403);
    assert.equal(await rejectedUpload(f.uploadUrl("screen", f.uploadToken).replace(/token=[^&]+/, "token=wrong"), f.hub.origin), 401);
    assert.equal(await rejectedUpload(f.uploadUrl("screen", f.uploadToken), "https://unrelated.invalid"), 403);
    const sameDevice = await f.connect(0);
    assert.equal((await sameDevice.command({ type: "endLive", sourceId: "screen" })).ok, false);
    assert.equal((await f.receiver.command({ type: "endLive", sourceId: "screen" })).ok, false);
    f.publisher.socket.terminate();
    await until(() => !f.receiver.state.liveSources?.length);
    assert.equal(await rejectedUpload(f.uploadUrl("screen", f.uploadToken), f.hub.origin), 403);
  } finally { await f.close(); }
});

test("grouped live pictures use normal HLS URLs whose grants end with their transport", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true });
    await until(() => !!f.receiver.load()?.follow);
    const load = f.receiver.load()!;
    assert.equal(load.hls, true);
    assert.equal("livePeerId" in load, false);
    assert.equal((await fetch(load.source)).status, 200);
    assert.equal((await fetch(new URL("segment-000000000.ts", load.source))).status, 200);
    assert.equal((await fetch(load.source.replace(/\/[^/]+\/stream\.m3u8$/, "/invalid/stream.m3u8"))).status, 404);
    assert.equal((await fetch(new URL("unrelated.txt", load.source))).status, 404);
    await f.publisher.command({ type: "stop", playbackId: load.playbackId });
    assert.equal((await fetch(load.source)).status, 404);
    assert.equal(f.publisher.state.liveSources?.length, 1, "Stop playback leaves capture running");
  } finally { await f.close(); }
});

test("live playback uses ordinary controls and queue without persisting its ephemeral entry", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("mic", "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const load = f.receiver.load()!;
    assert.equal((await f.publisher.command({ type: "pause", playbackId: load.playbackId, paused: true })).ok, true);
    const preferences = f.publisher.state.preferences;
    assert.equal((await f.publisher.command({ type: "audioDelay", playbackId: load.playbackId, delay: 0.08 })).ok, false);
    assert.equal((await f.publisher.command({ type: "speed", playbackId: load.playbackId, speed: 2 })).ok, false);
    assert.deepEqual(f.publisher.state.preferences, preferences, "unsupported Direct RTC controls must not change saved preferences");
    const result = await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` } });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), [f.publisher.state.currentEntryId, "normal"]);
    const saved = openStore(f.databasePath, true);
    try { assert.deepEqual(saved.playbackIds().flatMap(id => saved.playback(id).queue).map(entry => entry.id), ["normal"]); }
    finally { saved.close(); }
    assert.equal((await f.api("/api/playlists", { name: "Next", scope: "upNext" })).status, 201);
    await f.publisher.command({ type: "endLive", sourceId: "mic" });
    await until(() => !f.publisher.state.liveSources?.length);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["normal"]);
    assert.equal(f.publisher.state.currentEntryId, null);
    assert.ok(f.receiver.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("a live input can queue next without interrupting the current item and plays through the normal Next action", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "enqueue", entry: { id: "before", title: "Before", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    await f.publisher.command({ type: "enqueue", entry: { id: "after", title: "After", source: `${f.hub.origin}/api/health` } });
    await f.publish("screen");
    const original = f.receiver.load()!, group = f.publisher.state.playback;
    const result = await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false, placement: "next" });
    assert.equal(result.ok, true, result.error);
    const queued = f.publisher.state.queue.find(entry => entry.liveSourceId === "screen");
    assert.ok(queued);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["before", queued.id, "after"]);
    assert.equal(f.publisher.state.currentEntryId, "before");
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.receiver.load(), original, "queueing must not replace the current transport");
    assert.equal((await f.publisher.command({ type: "next", playbackId: original.playbackId })).ok, true);
    await until(() => !!f.receiver.load() && "livePeerId" in f.receiver.load()!);
    assert.equal(f.publisher.state.currentEntryId, queued.id);
    assert.equal(f.publisher.state.playback, group);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["before", queued.id, "after"]);
  } finally { await f.close(); }
});

test("ordinary Play replaces a live item in the same playback and preserves its output mix", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("system", "system-audio");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "system", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const other = await f.connect(2, "&audio=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50 });
    await f.publisher.command({ type: "allSpeakers", level: 35 });
    const playback = f.publisher.state.playback, outputs = f.publisher.state.outputs;
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    assert.equal(f.publisher.state.playback, playback);
    assert.deepEqual(f.publisher.state.outputs, outputs);
    assert.equal(f.publisher.state.mixTrim, 35);
    await f.publisher.command({ type: "endLive", sourceId: "system" });
    assert.equal(f.publisher.state.currentEntryId, "normal", "ending retired capture cannot stop ordinary media");
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["normal"]);
    assert.equal(f.publisher.state.playbacks?.find(item => item.id === playback)?.liveSourceId, undefined);
  } finally { await f.close(); }
});

test("grouped live pictures use the receiver's HTTPS origin and Only here never plays a capture on its publisher", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    assert.ok("livePeerId" in f.receiver.load()!);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    await f.speaker(1);
    const other = await f.connect(2, "&audio=1&video=1", true);
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => !!other.load());
    const original = f.receiver.load()!, grouped = other.load()!;
    assert.equal(new URL(grouped.source).origin, "https://receiver.example");
    assert.equal((await fetch(new URL(new URL(grouped.source).pathname, f.hub.origin))).status, 200);
    await until(() => f.publisher.state.player.playbackId === grouped.playbackId && f.publisher.state.player.status === "playing" && f.publisher.state.player.position > 0);
    const solo = await f.publisher.command({ type: "solo", deviceId: other.id });
    assert.equal(solo.ok, true, solo.error);
    await until(() => !!other.load() && "livePeerId" in other.load()!);
    assert.equal(other.load()!.follow, undefined);
    assert.equal((await fetch(original.source)).status, 404);
    other.report();
    await until(() => f.publisher.state.player.status === "playing");
    const self = await f.publisher.command({ type: "solo", deviceId: f.publisher.id });
    assert.equal(self.ok, false);
    assert.match(self.error!, /Publisher is sharing this source/);
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [other.id]);
  } finally { await f.close(); }
});

test("Only here rejects a system-audio input on the same capturing device", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("system", "system-audio");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "system", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    const result = await f.publisher.command({ type: "solo", deviceId: f.publisher.id });
    assert.equal(result.ok, false);
    assert.match(result.error!, /Publisher is sharing this source/);
    assert.equal(f.publisher.state.outputs?.[0]?.deviceId, f.receiver.id);
  } finally { await f.close(); }
});

test("a system-audio input uses the selected normal mix without its publisher, which keeps controlling it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    f.publisher.report();
    await until(() => f.publisher.state.player.status === "playing");
    await f.publisher.command({ type: "output", deviceId: f.publisher.id, level: 0 });
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 50 });
    const group = f.publisher.state.playback;
    await f.publish("system", "system-audio");
    const play = await f.publisher.command({ type: "playLive", sourceId: "system" });
    assert.equal(play.ok, true, play.error);
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.queue.find(entry => entry.id === f.publisher.state.currentEntryId)?.liveSourceId, "system");
    assert.deepEqual(f.publisher.state.outputs?.map(({ deviceId, sound }) => ({ deviceId, sound })), [{ deviceId: f.receiver.id, sound: true }]);
  } finally { await f.close(); }
});

test("source or upload disconnect ends every receiver and releases capture", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const upload = await f.publish("mic", "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    upload.terminate();
    await until(() => !f.receiver.state.liveSources?.length && !f.receiver.state.playbacks?.length);
    assert.ok(f.receiver.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("audio-only inputs retain the selected pictures for the next video", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("system", "system-audio");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "system", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true });
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.picture), [true, true]);
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal video", source: `${f.hub.origin}/api/health` }, playNow: true });
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.picture), [true, true]);
    await until(() => other.load()?.source === `${f.hub.origin}/api/health`);
  } finally { await f.close(); }
});

test("ending capture invalidates removed-input Undo without disturbing unrelated playback Undo", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` } });
    const entryId = f.publisher.state.currentEntryId!;
    await f.publisher.command({ type: "remove", entryId });
    const token = f.publisher.state.queueRemoval?.token;
    assert.ok(token);
    await f.publisher.command({ type: "endLive", sourceId: "screen" });
    assert.equal((await f.publisher.command({ type: "restoreRemoved", token })).ok, false);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["normal"]);
    await f.publish("unrelated");
    await f.publisher.command({ type: "play", entryId: "normal" });
    const playback = f.publisher.state.playback;
    await f.publisher.command({ type: "stop" });
    await f.publisher.command({ type: "endLive", sourceId: "unrelated" });
    assert.equal(f.publisher.state.playback, playback);
    assert.equal((await f.publisher.command({ type: "play", entryId: "normal" })).ok, true);
  } finally { await f.close(); }
});

test("replaying an ephemeral entry retains the saved queue's previous cursor", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  const store = openStore(f.databasePath, true);
  try {
    const queue = [
      { id: "before", title: "Before", source: "https://example.com/before" },
      { id: "live", title: "Input", source: "live:input", live: true, liveSourceId: "input" },
      { id: "after", title: "After", source: "https://example.com/after" },
    ];
    const saved = store.playback("cursor-test");
    saved.saveQueue(queue, "live");
    saved.saveQueueCursor("live");
    assert.equal(saved.queueCursorEntryId(), "before");
    assert.deepEqual(store.playback("cursor-test").queue.map(entry => entry.id), ["before", "after"]);
  } finally { store.close(); await f.close(); }
});

test("ending a retired input preserves Stop Undo for the later item in the same queue", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true });
    const playback = f.publisher.state.playback;
    await f.publisher.command({ type: "stop" });
    await f.publisher.command({ type: "endLive", sourceId: "screen" });
    assert.equal(f.publisher.state.playback, playback);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["normal"]);
    assert.equal((await f.publisher.command({ type: "play", entryId: "normal" })).ok, true);
  } finally { await f.close(); }
});

test("Play validates the selected mix before replacing it with a picture-only input", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: false });
    await f.publish("picture", "screen", false);
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "picture" })).ok, false);
    assert.equal(f.publisher.state.currentEntryId, "normal");
    assert.deepEqual(f.publisher.state.outputs?.map(output => ({ picture: output.picture, sound: output.sound })), [{ picture: false, sound: true }]);
  } finally { await f.close(); }
});

test("live inputs play at real time while the next ordinary item keeps its profile speed", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "preferences", profileId: f.publisher.state.activeProfile.id, preferences: { speed: 2 } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    assert.equal(f.receiver.load()!.preferences?.speed, 1);
    assert.equal(f.publisher.state.preferences?.profile.speed, 2);
    await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true });
    await until(() => f.receiver.load()?.source === `${f.hub.origin}/api/health`);
    assert.equal(f.receiver.load()!.preferences?.speed, 2);
  } finally { await f.close(); }
});

test("controller input cannot forge a live reference or expose malformed upload credentials", () => {
  const command = (action: unknown) => JSON.stringify({ type: "command", requestId: "1", action });
  assert.throws(() => parseCommand(command({ type: "enqueue", entry: { id: "forged", title: "Forged", source: "https://example.com/media", liveSourceId: "screen" } })));
  for (const uploadToken of [undefined, "", "short", "z".repeat(64)]) assert.throws(() => parseCommand(command({ type: "publishLive", sourceId: "screen", uploadToken, kind: "screen", audio: true, video: true })));
});

test("player reports preserve an unavailable audio delay without accepting malformed supplied delays", () => {
  const state = { playbackId: "rtc", status: "playing", buffering: false, position: 0, duration: null, volume: 100, seekable: false, error: null, speed: 1 };
  const report = (audioDelay?: unknown) => JSON.stringify({ type: "player", state: { ...state, audioDelay } });
  const unsupported = parsePlayer(report());
  assert.ok(unsupported);
  assert.equal(unsupported.audioDelay, undefined);
  assert.equal(parsePlayer(report(0))?.audioDelay, 0);
  assert.equal(parsePlayer(report(0.08))?.audioDelay, 0.08);
  assert.equal(parsePlayer(report("later")), null);
  assert.equal(parsePlayer(report(Infinity)), null);
});
