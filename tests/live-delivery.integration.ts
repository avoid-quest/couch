import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
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
// A receiver that couldn't connect directly plays Core's buffered stream from its own link, alone.
const relayed = (load: Load, receiver: Receiver) => {
  assert.equal(load.hls, true, "A relayed receiver plays the buffered stream");
  assert.equal("livePeerId" in load, false);
  assert.equal(load.follow, undefined, "it follows no group clock");
  assert.ok(load.source.includes(`/${receiver.id}/`), "its link names the receiver");
};
const volume = (receiver: Receiver) => receiver.messages.flatMap(message => message.type === "player" && message.command.type === "volume" ? [message.command.volume] : []).at(-1);
const uploadRequested = (f: Fixture) => f.publisher.messages.findLast(message => message.type === "livePeers")?.upload === true;
async function addOther(f: Fixture) {
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
  await until(() => !!other.load());
  return other;
}
async function start(f: Fixture) {
  await f.publish("screen");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load());
  rtc(f.receiver.load()!);
  f.receiver.report();
  await until(() => f.publisher.state.player.status === "playing");
}

test("Direct RTC starts without an encoder or upload", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    assert.equal(f.publisher.messages.some(message => message.type === "livePeers" && message.upload), false, "Core never asks for the recording");
    assert.equal(f.uploads.size, 0);
  } finally { await f.close(); }
});

test("a second receiver gets its own RTC peer at its own level, without a group, a reload of the first or an encoder", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const first = rtc(f.receiver.load()!), group = f.publisher.state.playback!, before = loads(f.receiver).length;
    const other = await addOther(f);
    assert.notEqual(rtc(other.load()!), first);
    assert.equal(loads(f.receiver).length, before, "the first receiver keeps playing its peer");
    assert.equal(f.publisher.state.playback, group);
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [f.receiver.id, other.id]);
    await until(() => f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.length === 2);
    assert.equal(uploadRequested(f), false);
    assert.equal(f.receiver.messages.some(message => message.type === "sendspin" && message.listen), false, "no Sendspin group forms");
    assert.equal(f.publisher.state.outputs?.some(output => output.delayActive), false);
    // Each receiver plays at its own level, and both follow the controls.
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 20 })).ok, true);
    await until(() => volume(other) === 20);
    assert.notEqual(volume(f.receiver), 20);
    assert.equal((await f.publisher.command({ type: "pause", playbackId: f.receiver.load()!.playbackId, paused: true })).ok, true);
    for (const receiver of [f.receiver, other]) await until(() => receiver.messages.some(message => message.type === "player" && message.command.type === "pause" && message.command.paused));
    // A new tab of the second receiver takes over its peer; the first is untouched.
    const tab = await f.connect(2, "&audio=1&video=1");
    await until(() => !!tab.load());
    rtc(tab.load()!);
    assert.equal(loads(f.receiver).length, before);
  } finally { await f.close(); }
});

test("In sync moves the receivers to the synchronized group and back to RTC, encoding only meanwhile", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    await f.speaker(1);
    const other = await addOther(f);
    const before = [loads(f.receiver).length, loads(other).length];
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    await until(() => loads(f.receiver).length > before[0]! && loads(other).length > before[1]!);
    for (const receiver of [f.receiver, other]) synced(receiver.load()!, group);
    assert.equal(f.publisher.state.playbacks?.find(playback => playback.id === group)?.inSync, true);
    assert.ok(uploadRequested(f), "Core asks for the recording only now");
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === true);
    assert.equal(f.publisher.state.currentEntryId, entry);
    const back = [loads(f.receiver).length, loads(other).length];
    assert.equal((await f.publisher.command({ type: "inSync", inSync: false })).ok, true);
    await until(() => loads(f.receiver).length > back[0]! && loads(other).length > back[1]!);
    for (const receiver of [f.receiver, other]) rtc(receiver.load()!);
    await until(() => !uploadRequested(f) && !f.uploads.size);
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === false);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "delivery changes must not end capture");
  } finally { await f.close(); }
});

test("Only here from an In sync group restores RTC without replacing the queue", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const firstPeer = rtc(f.receiver.load()!);
    await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    await f.publisher.command({ type: "allSpeakers", level: 35 });
    const group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId, queue = f.publisher.state.queue;
    await f.speaker(1);
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    const other = await addOther(f);
    await until(() => !!f.receiver.load()?.follow);
    for (const receiver of [f.receiver, other]) synced(receiver.load()!, group);
    f.receiver.report();
    await until(() => f.heard(1) > 0 && f.publisher.state.player.status === "playing");
    const beforeSolo = loads(f.receiver).length;
    const solo = await f.publisher.command({ type: "solo", deviceId: f.receiver.id });
    assert.equal(solo.ok, true, solo.error);
    await until(() => loads(f.receiver).length > beforeSolo);
    assert.notEqual(rtc(f.receiver.load()!), firstPeer, "returning to RTC must grant a fresh peer");
    await until(() => f.receiver.messages.findLast(message => message.type === "sendspin")?.listen === false);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.deepEqual(f.publisher.state.queue, queue);
    assert.equal(f.publisher.state.mixTrim, 35);
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [f.receiver.id]);
    assert.ok(other.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("removing an additional output keeps RTC, and a later In sync rejoin reloads both synchronized pictures", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const group = f.publisher.state.playback!, peer = rtc(f.receiver.load()!);
    const other = await addOther(f);
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 0, picture: false })).ok, true);
    await until(() => other.messages.some(message => message.type === "player" && message.command.type === "stop"));
    assert.equal(rtc(f.receiver.load()!), peer);
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    const beforeRejoin = [loads(f.receiver).length, loads(other).length];
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => loads(f.receiver).length > beforeRejoin[0]! && loads(other).length > beforeRejoin[1]!);
    for (const receiver of [f.receiver, other]) synced(receiver.load()!, group);
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
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => !!f.receiver.load()?.follow && !!other.load());
    for (const receiver of [f.receiver, other]) { synced(receiver.load()!, group); preserves(receiver.load()!); }
  } finally { await f.close(); }
});

test("a receiver that can't connect directly plays Couch's buffered stream alone, while the other keeps its peer", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const peerId = rtc(f.receiver.load()!), group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    const other = await addOther(f);
    const otherPeer = rtc(other.load()!), before = [loads(f.receiver).length, loads(other).length];
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId, error: "No network path for live inputs." }));
    await until(() => loads(f.receiver).length > before[0]!);
    relayed(f.receiver.load()!, f.receiver);
    assert.equal((await fetch(f.receiver.load()!.source)).status, 200);
    assert.equal(loads(other).length, before[1], "the healthy receiver keeps playing");
    assert.equal(rtc(other.load()!), otherPeer);
    assert.ok(uploadRequested(f));
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.buffered === true);
    assert.equal(f.publisher.state.outputs?.find(output => output.deviceId === other.id)?.buffered, undefined);
    assert.deepEqual(f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.map(peer => peer.peerId), [otherPeer]);
    assert.equal(f.receiver.messages.some(message => message.type === "sendspin" && message.listen), false, "no group forms");
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, entry);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "relaying must not end capture");
  } finally { await f.close(); }
});

test("a receiver that goes offline leaves the other playing its own peer, and gets a fresh one back", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const other = await addOther(f);
    const otherPeer = rtc(other.load()!), before = [loads(other).length, other.messages.length];
    f.receiver.socket.terminate();
    await until(() => f.publisher.state.devices?.find(device => device.id === f.receiver.id)?.online === false);
    await until(() => f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.length === 1);
    assert.deepEqual(f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.map(peer => peer.peerId), [otherPeer]);
    assert.equal(loads(other).length, before[0], "the online receiver keeps its peer");
    assert.equal(other.messages.slice(before[1]).some(message => message.type === "player" && message.command.type === "stop"), false);
    other.report();
    assert.equal(f.publisher.state.player.status, "playing");
    const back = await f.connect(1, "&audio=1&video=1");
    await until(() => !!back.load());
    assert.notEqual(rtc(back.load()!), otherPeer);
    assert.equal(rtc(other.load()!), otherPeer);
  } finally { await f.close(); }
});

test("a second receiver's newest tab that closes hands its peer back to its older tab", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const other = await addOther(f);
    const tab = await f.connect(2, "&audio=1&video=1");
    await until(() => !!tab.load());
    const first = [loads(f.receiver).length, loads(other).length];
    tab.socket.terminate();
    await until(() => loads(other).length > first[1]!);
    const peer = rtc(other.load()!);
    await until(() => f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.some(item => item.peerId === peer) === true);
    assert.equal(loads(f.receiver).length, first[0], "the first receiver is untouched");
  } finally { await f.close(); }
});

// FFmpeg for buffered delivery, replaced after the fixture starts: Core looks it up when it first buffers.
const ffmpeg = (f: Fixture, script: string) => {
  const directory = join(dirname(f.databasePath), "replaced");
  mkdirSync(directory);
  writeFileSync(join(directory, "ffmpeg"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.PATH = `${directory}${delimiter}${process.env.PATH}`;
  return directory;
};

test("a fallback that becomes ready after a pause loads paused", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const gate = join(dirname(f.databasePath), "gate");
    ffmpeg(f, `case " $* " in *" -version "*) while [ ! -e '${gate}' ]; do sleep 0.02; done;; esac\nexec '${join(dirname(f.databasePath), "ffmpeg")}' "$@"`);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.publisher.state.outputs?.[0]?.buffered);
    assert.equal((await f.publisher.command({ type: "pause", playbackId: f.receiver.load()!.playbackId, paused: true })).ok, true);
    f.receiver.report({ status: "paused" });
    await until(() => f.publisher.state.player.status === "paused");
    writeFileSync(gate, "");
    await until(() => !!f.receiver.load()?.hls);
    relayed(f.receiver.load()!, f.receiver);
    assert.equal(f.receiver.load()!.paused, true, "it loads as the playback is now");
  } finally { await f.close(); }
});

test("a buffered stream that fails stops its receiver and says why, while the other keeps its peer and Core doesn't retry", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const other = await addOther(f);
    const otherPeer = rtc(other.load()!), before = [f.receiver.messages.length, loads(other).length];
    ffmpeg(f, `case " $* " in *" -version "*) echo "ffmpeg version 7.0";; *) exit 1;; esac`);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.error);
    assert.ok(f.receiver.messages.slice(before[0]).some(message => message.type === "player" && message.command.type === "stop"), "the relayed receiver stops waiting");
    assert.equal(f.publisher.state.outputs?.find(output => output.deviceId === other.id)?.error, undefined);
    assert.equal(loads(other).length, before[1], "the healthy receiver keeps playing");
    assert.deepEqual(f.publisher.messages.findLast(message => message.type === "livePeers")?.peers.map(peer => peer.peerId), [otherPeer]);
    assert.equal(uploadRequested(f), false);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "capture continues");
    // Its level reaches the healthy receiver without starting the encoder again for this item.
    const requests = f.publisher.messages.filter(message => message.type === "livePeers" && message.upload).length;
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 30 })).ok, true);
    await until(() => volume(other) === 30);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(f.publisher.messages.filter(message => message.type === "livePeers" && message.upload).length, requests);
    assert.equal(f.receiver.messages.slice(before[0]).some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { await f.close(); }
});

test("a buffered stream that fails on the only receiver shows its error", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    const broken = ffmpeg(f, `case " $* " in *" -version "*) echo "ffmpeg version 7.0";; *) exit 1;; esac`);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => f.publisher.state.player.status === "error");
    assert.ok(f.publisher.state.player.error);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "capture continues");
    // Playing it again tries the buffered stream again.
    rmSync(broken, { recursive: true });
    const before = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => loads(f.receiver).length > before && !!f.receiver.load()?.hls);
    relayed(f.receiver.load()!, f.receiver);
  } finally { await f.close(); }
});

test("a relayed receiver plays the next ordinary item directly, the encoder stops, and the source is relayed again", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.hls);
    const source = `${f.hub.origin}/api/health`;
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.source === source);
    assert.equal(f.receiver.load()!.follow, undefined, "an ordinary item plays directly");
    await until(() => !uploadRequested(f) && !f.uploads.size);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    const before = loads(f.receiver).length;
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => loads(f.receiver).length > before && !!f.receiver.load()?.hls);
    relayed(f.receiver.load()!, f.receiver);
  } finally { await f.close(); }
});

test("a relayed receiver's newest tab takes over its stream and plays the next ordinary item", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.hls);
    const source = `${f.hub.origin}/api/health`;
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "next", title: "Next", source } })).ok, true);
    const tab = await f.connect(1, "&audio=1&video=1");
    f.receiver.socket.terminate();
    await until(() => !!tab.load()?.hls);
    relayed(tab.load()!, tab);
    tab.report();
    await until(() => f.publisher.state.player.status === "playing");
    assert.equal((await f.publisher.command({ type: "play", entryId: "next" })).ok, true);
    await until(() => tab.load()?.source === source);
    assert.equal(tab.load()!.follow, undefined);
  } finally { await f.close(); }
});

test("Only here grants a fresh peer to a device that can connect, and relays to one that couldn't", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await start(f);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: rtc(f.receiver.load()!), error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.hls);
    // Only here moves an item once it has started.
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
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
    relayed(f.receiver.load()!, f.receiver);
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
    await until(() => !!f.receiver.load()?.hls);
    relayed(f.receiver.load()!, f.receiver);
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
