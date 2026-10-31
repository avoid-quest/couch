import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { channel } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { openStore } from "../src/server/store";
import { parseCommand, parsePlayer } from "../src/server/validation";
import type { ServerMessage } from "../src/shared/protocol";
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
    assert.equal((await (await f.api("/api/connection")).json()).player, "idle");
    await f.publish("screen");
    assert.equal(f.publisher.state.playbacks?.length, 0);
    assert.equal((await (await f.api("/api/connection")).json()).player, "playing", "native update guards must see a publisher even without receivers");
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
    assert.equal((await (await f.api("/api/connection")).json()).player, "idle");
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
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
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

// A live link's playlist status, its newest segment and that segment's status.
const newest = async (link: string) => {
  const response = await fetch(link), segment = (response.ok ? await response.text() : "").match(/segment-\d{9}\.ts/g)?.at(-1);
  return { playlist: response.status, segment, status: segment ? (await fetch(new URL(segment, link))).status : 0 };
};
// The newest segment once the capture has written one after `segment`.
const after = async (link: string, segment = "") => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const current = await newest(link);
    if (current.segment && current.segment > segment) return current;
    if (Date.now() > deadline) throw new Error("The capture wrote no new segment.");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const loadCount = (client: { messages: ServerMessage[] }) => client.messages.filter(message => message.type === "player" && message.command.type === "load").length;
const coreLink = /\/api\/live\/media\/[^"]*\/core\//;

test("each screen's live link names its Device and stops serving it once unpaired, while the others play on", { timeout: 20_000 }, async () => {
  const f = await liveFixture({ local: true });
  // Core's own decoder reads its link through the same endpoint, from this machine.
  const core: number[] = [], responses = channel("http.server.response.finish");
  const observe = (message: unknown) => {
    const { request, response } = message as { request: IncomingMessage; response: ServerResponse };
    if (coreLink.test(request.url ?? "")) core.push(response.statusCode);
  };
  responses.subscribe(observe);
  let feeding: ReturnType<typeof setInterval> | undefined;
  try {
    await f.publish("screen");
    feeding = setInterval(() => { const upload = f.uploads.get("screen"); if (upload?.readyState === WebSocket.OPEN) upload.send(Buffer.from("fixture capture")); }, 100);
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const other = await f.connect(2, "&audio=1&video=1"), removed = await f.connect(3, "&audio=1&video=1");
    await f.speaker(1);
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: removed.id })).ok, true);
    await until(() => !!removed.load());
    // Direct receives over WebRTC: its load carries no HLS link.
    const direct = removed.load()!;
    assert.ok(direct.livePeerId);
    assert.equal(direct.source, "");
    assert.equal(direct.hls, undefined);
    removed.report();
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    for (const client of [f.receiver, other]) assert.equal((await f.publisher.command({ type: "output", deviceId: client.id, level: 50, picture: true })).ok, true);
    const screens = [removed, f.receiver, other];
    await until(() => screens.every(client => client.load()?.hls === true && !!client.load()?.follow));
    for (const client of screens) client.report();
    await until(() => f.heard(1) > 0);
    const links = screens.map(client => client.load()!.source), [saved, receiving, watching] = links as [string, string, string];
    assert.equal(new Set(links).size, 3, "each screen has its own link");
    screens.forEach((client, index) => assert.ok(links[index]!.includes(`/${client.id}/`)));
    for (const link of links) assert.deepEqual(await newest(link).then(({ playlist, status }) => [playlist, status]), [200, 200]);
    assert.ok(core.length && core.every(status => status === 200), "Core's decoder reads its own link");
    // A link's Device and signature go together, and Core's name opens nothing for a Device.
    assert.equal((await fetch(saved.replace(`/${removed.id}/`, `/${f.receiver.id}/`))).status, 404);
    assert.equal((await fetch(receiving.replace(`/${f.receiver.id}/`, "/core/"))).status, 404);
    const before = await newest(saved), loads = screens.slice(1).map(loadCount), { playbackId } = f.receiver.state.player;

    const removal = await fetch(`${f.hub.origin}/api/devices/${removed.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}`, Origin: f.hub.origin } });
    assert.equal(removal.status, 200);
    await until(() => !f.receiver.state.outputs?.some(output => output.deviceId === removed.id));
    // Its saved link serves neither the playlist nor a segment written since; the others' links still do.
    const fresh = await after(receiving, before.segment);
    assert.equal((await fetch(saved)).status, 404);
    assert.equal((await fetch(new URL(fresh.segment!, saved))).status, 404);
    assert.equal(fresh.status, 200);
    assert.equal((await after(watching, before.segment)).status, 200);
    const heard = f.heard(1);
    await until(() => f.heard(1) > heard);
    assert.deepEqual(screens.slice(1).map(loadCount), loads, "the others play on without a new load");
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    for (const client of [f.publisher, f.receiver, other, removed]) assert.equal(coreLink.test(JSON.stringify(client.messages)), false, "Core's link never reaches a Device");

    clearInterval(feeding);
    assert.equal((await f.publisher.command({ type: "endLive", sourceId: "screen" })).ok, true);
    assert.equal((await fetch(receiving)).status, 404);
  } finally { responses.unsubscribe(observe); clearInterval(feeding); await f.close(); }
});

test("a screen's live link ends with its picture or its output, lasts through a pause and a new tab, and ends when the item is replaced", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  let feeding: ReturnType<typeof setInterval> | undefined;
  try {
    await f.publish("screen");
    feeding = setInterval(() => { const upload = f.uploads.get("screen"); if (upload?.readyState === WebSocket.OPEN) upload.send(Buffer.from("fixture capture")); }, 100);
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const other = await f.connect(2, "&audio=1&video=1"), host = await f.connect(-1);
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    for (const client of [other, host]) assert.equal((await f.publisher.command({ type: "output", deviceId: client.id, level: 50, picture: true })).ok, true);
    const screens = [f.receiver, other, host];
    await until(() => screens.every(client => client.load()?.hls === true && !!client.load()?.follow));
    const [receiving, watching, hosting] = screens.map(client => client.load()!.source) as [string, string, string];
    for (const link of [receiving, watching, hosting]) assert.equal((await newest(link)).status, 200);
    const { playbackId } = f.receiver.state.player;
    assert.ok(playbackId, "the playing screen has a current playback");

    // Picture off, sound kept: that screen's link ends; the others play on.
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, picture: false })).ok, true);
    await until(() => !!f.receiver.state.outputs?.some(output => output.deviceId === other.id && !output.picture));
    let fresh = await after(receiving);
    assert.equal((await fetch(watching)).status, 404);
    assert.equal((await fetch(new URL(fresh.segment!, watching))).status, 404);
    assert.equal((await newest(hosting)).status, 200);

    // Out of Where it plays: the same.
    assert.equal((await f.publisher.command({ type: "output", deviceId: host.id, level: 0, picture: false })).ok, true);
    await until(() => !f.receiver.state.outputs?.some(output => output.deviceId === host.id));
    fresh = await after(receiving, fresh.segment);
    assert.equal((await fetch(hosting)).status, 404);
    assert.equal(fresh.status, 200);
    assert.equal(f.receiver.state.player.playbackId, playbackId);

    // Paused, and in a new tab, a screen keeps its own link.
    assert.equal((await f.publisher.command({ type: "pause", playbackId, paused: true })).ok, true);
    assert.equal((await newest(receiving)).status, 200);
    const tab = await f.connect(1, "&audio=1&video=1");
    await until(() => tab.load()?.hls === true);
    assert.equal(tab.load()!.source, receiving);
    assert.equal((await newest(receiving)).status, 200);

    // Another item replaces the load, and the link with it.
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => f.receiver.state.player.playbackId !== playbackId);
    assert.equal((await fetch(receiving)).status, 404);
  } finally { clearInterval(feeding); await f.close(); }
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
    assert.equal(result.ok, true, result.error ?? "");
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
    assert.equal(result.ok, true, result.error ?? "");
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

test("grouped live pictures use the receiver's HTTPS origin and Move here never plays a capture on its publisher", { timeout: 15_000 }, async () => {
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
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    const other = await f.connect(2, "&audio=1&video=1", true);
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => !!other.load());
    const original = f.receiver.load()!, grouped = other.load()!;
    assert.equal(new URL(grouped.source).origin, "https://receiver.example");
    assert.equal((await fetch(new URL(new URL(grouped.source).pathname, f.hub.origin))).status, 200);
    await until(() => f.publisher.state.player.playbackId === grouped.playbackId && f.publisher.state.player.status === "playing" && f.publisher.state.player.position > 0);
    const solo = await f.publisher.command({ type: "solo", deviceId: other.id });
    assert.equal(solo.ok, true, solo.error ?? "");
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

test("Move here rejects a system-audio input on the same capturing device", { timeout: 15_000 }, async () => {
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
    assert.equal(play.ok, true, play.error ?? "");
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.queue.find(entry => entry.id === f.publisher.state.currentEntryId)?.liveSourceId, "system");
    assert.deepEqual(f.publisher.state.outputs?.map(({ deviceId, sound }) => ({ deviceId, sound })), [{ deviceId: f.receiver.id, sound: true }]);
  } finally { await f.close(); }
});

test("a failed buffered upload ends only buffered delivery, and publisher disconnect ends every receiver", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("mic", "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
    await until(() => f.uploads.get("mic")?.readyState === WebSocket.OPEN);
    f.uploads.get("mic")!.terminate();
    await until(() => f.publisher.messages.findLast(message => message.type === "livePeers")?.upload === false);
    assert.equal(f.receiver.state.liveSources?.length, 1, "capture continues");
    f.publisher.socket.terminate();
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
