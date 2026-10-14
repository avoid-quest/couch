import { test } from "node:test";
import assert from "node:assert/strict";
import type { MediaTrack, PlaybackCommand } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Receiver = Fixture["receiver"];
type Load = Extract<PlaybackCommand, { type: "load" }>;
const loads = (receiver: Receiver) => receiver.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
const rtc = (load: Load, sourceId = "screen") => {
  assert.ok("livePeerId" in load && typeof load.livePeerId === "string", "Direct live playback must load RTC");
  assert.ok("liveSourceId" in load && load.liveSourceId === sourceId);
  assert.equal(load.follow, undefined);
  return load.livePeerId;
};
const synced = (load: Load, group: string) => {
  assert.equal(load.hls, true, "Synced live playback must reload the normal HLS picture");
  assert.equal("livePeerId" in load, false);
  assert.deepEqual(load.follow, { group, pts: true });
};
async function start(f: Fixture) {
  await f.publish("screen");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load());
  rtc(f.receiver.load()!);
  f.receiver.report();
  await until(() => f.publisher.state.player.status === "playing");
}

test("Direct RTC starts without waiting for the buffered HLS rendition", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    // Publish the capture, but do not upload MediaRecorder bytes or prepare a segment.
    assert.equal((await f.publisher.command({ type: "publishLive", sourceId: "screen", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    rtc(f.receiver.load()!);
  } finally { await f.close(); }
});

test("Direct RTC becomes normal synchronized playback and Solo restores RTC without replacing the queue", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const firstPeer = rtc(f.receiver.load()!);
    await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    await f.publisher.command({ type: "allSpeakers", level: 35 });
    const group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    const queue = f.publisher.state.queue;
    await f.speaker(1);
    const other = await f.connect(2, "&audio=1&video=1");
    const beforeGroup = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => loads(f.receiver).length > beforeGroup && !!other.load());
    for (const receiver of [f.receiver, other]) synced(receiver.load()!, group);
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.deepEqual(f.publisher.state.queue, queue);
    assert.equal(f.publisher.state.mixTrim, 35);
    await until(() => f.publisher.state.player.status === "playing");
    const beforeSolo = loads(f.receiver).length;
    const solo = await f.publisher.command({ type: "solo", deviceId: f.receiver.id });
    assert.equal(solo.ok, true, solo.error);
    await until(() => loads(f.receiver).length > beforeSolo);
    assert.notEqual(rtc(f.receiver.load()!), firstPeer, "returning to RTC must grant a fresh peer");
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === false);
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.deepEqual(f.publisher.state.queue, queue);
    assert.equal(f.publisher.state.mixTrim, 35);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "delivery changes must not end capture");
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [f.receiver.id]);
    assert.ok(other.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("removing the last additional output restores RTC and a late rejoin reloads both synchronized pictures", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true });
    await until(() => !!other.load());
    const beforeLeave = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 0, picture: false })).ok, true);
    await until(() => loads(f.receiver).length > beforeLeave);
    rtc(f.receiver.load()!);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    const beforeRejoin = [loads(f.receiver).length, loads(other).length];
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => loads(f.receiver).length > beforeRejoin[0]! && loads(other).length > beforeRejoin[1]!);
    for (const receiver of [f.receiver, other]) synced(receiver.load()!, group);
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen");
  } finally { await f.close(); }
});

test("replacing Direct RTC retires its peer and later outputs receive only the current ordinary item", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const peerId = rtc(f.receiver.load()!);
    const group = f.publisher.state.playback!;
    const source = `${f.hub.origin}/api/health`;
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.source === source);
    assert.equal("livePeerId" in f.receiver.load()!, false);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    const afterReplacement = f.receiver.messages.length;
    f.publisher.socket.send(JSON.stringify({ type: "liveSignal", peerId, signal: { candidate: null } }));
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true });
    await until(() => !!other.load());
    assert.equal(other.load()!.source, source);
    assert.equal("livePeerId" in other.load()!, false);
    assert.deepEqual(other.load()!.follow, { group, pts: false });
    assert.equal(f.receiver.messages.slice(afterReplacement).some(message => "peerId" in message && message.peerId === peerId), false, "retired peer signaling must not reach the receiver");
    await f.publisher.command({ type: "endLive", sourceId: "screen" });
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, "next");
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["next"]);
  } finally { await f.close(); }
});

test("RTC peer rotation and grouped delivery preserve pause and selected external subtitles", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const original = f.receiver.load()!, firstPeer = rtc(original), group = f.publisher.state.playback!;
    assert.equal((await f.subtitle(original.playbackId)).status, 200);
    await until(() => f.receiver.messages.some(message => message.type === "player" && message.command.type === "addSubtitle"));
    const added = f.receiver.messages.findLast(message => message.type === "player" && message.command.type === "addSubtitle");
    assert.ok(added?.type === "player" && added.command.type === "addSubtitle");
    const subtitleSource = added.command.source;
    await f.publisher.command({ type: "track", playbackId: original.playbackId, kind: "subtitle", index: 0 });
    await f.publisher.command({ type: "subtitleDelay", playbackId: original.playbackId, delay: 0.35 });
    await f.publisher.command({ type: "pause", playbackId: original.playbackId, paused: true });
    const tracks: MediaTrack[] = [
      { id: "video", index: 0, kind: "video", label: "Video", language: "", selected: true },
      { id: "external-0", index: 0, kind: "subtitle", label: "captions.vtt", language: "", selected: true },
    ];
    // The real renderer reports the completed track and pause commands.
    f.receiver.report({ status: "paused", tracks, subtitleDelay: 0.35 });
    await until(() => f.publisher.state.player.status === "paused" && f.publisher.state.player.subtitleDelay === 0.35);
    const beforeRotation = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    await until(() => loads(f.receiver).length > beforeRotation);
    assert.notEqual(rtc(f.receiver.load()!), firstPeer);
    const preserves = (load: Load) => {
      assert.equal(load.paused, true);
      assert.equal(load.subtitleTrack, 0);
      assert.equal(load.subtitleDelay, 0.35);
      assert.equal(load.subtitles?.[0]?.source, subtitleSource);
    };
    preserves(f.receiver.load()!);
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => !!f.receiver.load()?.follow && !!other.load());
    for (const receiver of [f.receiver, other]) { synced(receiver.load()!, group); preserves(receiver.load()!); }
  } finally { await f.close(); }
});

test("a receiver that can't connect directly plays the source through Couch, keeping its playback and capture", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    await f.speaker(1);
    const peerId = rtc(f.receiver.load()!), group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    const before = loads(f.receiver).length;
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId, error: "No network path for live inputs." }));
    await until(() => loads(f.receiver).length > before);
    synced(f.receiver.load()!, group);
    assert.ok(f.receiver.load()!.source.includes(`/${f.receiver.id}/`), "the picture comes from the receiver's own link");
    assert.equal((await fetch(f.receiver.load()!.source)).status, 200);
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === true);
    f.receiver.report();
    await until(() => f.heard(1) > 0);
    assert.ok(f.publisher.messages.some(message => message.type === "livePeers" && !message.peers.length), "the publisher closes the failed peer");
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "falling back must not end capture");
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [f.receiver.id]);
  } finally { await f.close(); }
});

test("a relayed receiver plays the next ordinary item directly and the source relayed again", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    await f.speaker(1);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.follow);
    const source = `${f.hub.origin}/api/health`;
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.source === source);
    assert.equal(f.receiver.load()!.follow, undefined, "an ordinary item plays directly");
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === false);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    const before = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => loads(f.receiver).length > before && !!f.receiver.load()?.hls);
    synced(f.receiver.load()!, f.publisher.state.playback!);
  } finally { await f.close(); }
});

test("Only here grants a fresh peer to a device that can connect, and relays to one that couldn't", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    await f.speaker(1);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.follow);
    // Only here moves an item once it has started.
    f.receiver.report();
    await until(() => f.heard(1) > 0 && f.publisher.state.player.status === "playing");
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "solo", deviceId: other.id })).ok, true);
    await until(() => !!other.load());
    rtc(other.load()!);
    other.report();
    await until(() => f.publisher.state.player.status === "playing");
    const before = loads(f.receiver).length;
    const back = await f.publisher.command({ type: "solo", deviceId: f.receiver.id });
    assert.equal(back.ok, true, back.error);
    await until(() => loads(f.receiver).length > before);
    synced(f.receiver.load()!, f.publisher.state.playback!);
  } finally { await f.close(); }
});

test("a peer's own publisher can report it failed, and no other connection can", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const peerId = rtc(f.receiver.load()!);
    const window = await f.connect(0); // Same paired identity, a different publishing window.
    const closed = new Promise<number>(resolve => window.socket.once("close", code => resolve(code)));
    window.socket.send(JSON.stringify({ type: "liveFailed", peerId, error: "Spoofed." }));
    assert.equal(await closed, 1008);
    assert.equal(rtc(f.receiver.load()!), peerId);
    f.publisher.socket.send(JSON.stringify({ type: "liveFailed", peerId, error: "No codec in common." }));
    await until(() => !!f.receiver.load()?.follow);
  } finally { await f.close(); }
});

test("RTC signaling admits only the exact granted connections", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const peerId = rtc(f.receiver.load()!);
    const other = await f.connect(0); // Same paired identity, a different publishing window.
    const closed = new Promise<number>(resolve => other.socket.once("close", code => resolve(code)));
    other.socket.send(JSON.stringify({ type: "liveSignal", peerId, signal: { candidate: null } }));
    assert.equal(await closed, 1008);
    assert.equal(f.receiver.messages.some(message => message.type === "liveSignal" && message.peerId === peerId), false);
    f.publisher.socket.send(JSON.stringify({ type: "liveSignal", peerId, signal: { candidate: null } }));
    await until(() => f.receiver.messages.some(message => message.type === "liveSignal" && message.peerId === peerId));
    assert.equal(rtc(f.receiver.load()!), peerId, "rejecting another connection must preserve the authorized peer");
  } finally { await f.close(); }
});
