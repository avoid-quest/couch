import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaybackCommand } from "../src/shared/protocol";
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
  assert.deepEqual(load.follow, { group, pts: true, timeline: { kind: "source-pts", generation: load.playbackId, mapping: "hls" } });
};
// A receiver that couldn't connect directly plays Core's buffered stream from its own link, alone.
const relayed = (load: Load, receiver: Receiver) => {
  assert.equal(load.hls, true, "A relayed receiver plays the buffered stream");
  assert.equal("livePeerId" in load, false);
  assert.equal(load.follow, undefined, "it follows no group clock");
  assert.ok(load.source.includes(`/${receiver.id}/`), "its link names the receiver");
};
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
    assert.deepEqual(other.load()!.follow, { group, pts: false, timeline: { kind: "position", generation: other.load()!.playbackId, mapping: "media" } });
    assert.equal(f.receiver.messages.slice(afterReplacement).some(message => "peerId" in message && message.peerId === peerId), false, "retired peer signaling must not reach the receiver");
    await f.publisher.command({ type: "endLive", sourceId: "screen" });
    assert.equal(f.publisher.state.playback, group);
    assert.equal(f.publisher.state.currentEntryId, "next");
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), ["next"]);
  } finally { await f.close(); }
});

test("a receiver that can't connect directly plays Couch's buffered stream alone, while the other keeps its peer", { timeout: 15_000 }, async t => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const f = await liveFixture();
  try {
    await start(f);
    const peerId = rtc(f.receiver.load()!), group = f.publisher.state.playback!, entry = f.publisher.state.currentEntryId;
    const other = await addOther(f);
    const otherPeer = rtc(other.load()!), before = [loads(f.receiver).length, loads(other).length];
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId, error: "No network path for live inputs. https://relay.example/session?token=private-fixture" }));
    await until(() => loads(f.receiver).length > before[0]!);
    relayed(f.receiver.load()!, f.receiver);
    assert.equal((await fetch(f.receiver.load()!.source)).status, 200);
    assert.equal(lines.some(line => line.includes("player error")), false, "trying the buffered route isn't a playback failure");
    assert.ok(lines.some(line => line.includes("live fallback") && line.includes("No network path for live inputs.")), "keep the direct failure as fallback diagnostics");
    assert.equal(lines.some(line => line.includes("private-fixture")), false, "fallback diagnostics still redact source URLs");
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
