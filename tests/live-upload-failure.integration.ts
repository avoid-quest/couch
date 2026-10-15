import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveUploadFailed } from "../src/server/validation";
import { liveFixture, until } from "./live-input.fixture";

type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Client = Fixture["publisher"];
const uploadRequested = (client: Client) => client.messages.findLast(message => message.type === "livePeers")?.upload === true;
const loads = (client: Client) => client.messages.filter(message => message.type === "player" && message.command.type === "load").length;
const error = "This browser cannot record a live input for buffered playback.";
const fail = (client: Client, sourceId = "screen") => client.socket.send(JSON.stringify({ type: "liveUploadFailed", sourceId, error }));
// This publishing window never opens a media socket until a test explicitly enables uploads.
async function start(f: Fixture) {
  const owner = await f.connect(0);
  assert.equal((await owner.command({ type: "publishLive", sourceId: "screen", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  assert.equal((await owner.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load()?.livePeerId);
  f.receiver.report();
  await until(() => owner.state.player.status === "playing");
  return owner;
}
async function addOther(f: Fixture, owner: Client) {
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal((await owner.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
  await until(() => !!other.load()?.livePeerId);
  return other;
}
async function fallback(f: Fixture, owner: Client) {
  f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
  await until(() => uploadRequested(owner));
  assert.equal(f.uploads.size, 0, "the publisher has no media socket to close");
}
// Await a command on the same connection to prove all preceding notifications were processed.
const barrier = (client: Client) => client.command({ type: "sharing", sharing: { audio: false, video: false } });

test("upload failure validation bounds and redacts errors and discards unvalidated siblings", () => {
  const message = { type: "liveUploadFailed", sourceId: "screen", error: "Cannot record https://example.test/private?token=secret\nagain\u2028 " + "x".repeat(400), extra: "discard" };
  assert.deepEqual(parseLiveUploadFailed(JSON.stringify(message)), { type: "liveUploadFailed", sourceId: "screen", error: ("Cannot record example.test " + "x".repeat(400)).slice(0, 300) });
  for (const invalid of [null, [], {}, { ...message, type: "liveFailed" }, ...[undefined, "", "bad/source", "x".repeat(81), 5].map(sourceId => ({ ...message, sourceId })), ...[undefined, null, 7].map(error => ({ ...message, error }))]) {
    assert.equal(parseLiveUploadFailed(JSON.stringify(invalid)), null);
  }
  assert.equal(parseLiveUploadFailed("invalid JSON"), null);
});

test("a buffered upload failure before its socket exists fails its receiver promptly and preserves the source", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const owner = await start(f);
    await fallback(f, owner);
    fail(owner);
    await until(() => owner.state.player.status === "error" && !uploadRequested(owner));
    assert.equal(owner.state.player.error, error);
    assert.equal(owner.state.player.buffering, false);
    assert.equal(owner.state.liveSources?.[0]?.id, "screen");
    assert.equal(f.receiver.state.liveSources?.[0]?.id, "screen");
  } finally { await f.close(); }
});

test("a pre-socket buffered failure leaves a healthy direct receiver playing, and Play explicitly retries", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const owner = await start(f), other = await addOther(f, owner);
    const peer = other.load()!.livePeerId, before = { loads: loads(other), messages: other.messages.length };
    await fallback(f, owner);
    fail(owner);
    await until(() => owner.state.outputs?.find(output => output.deviceId === f.receiver.id)?.error === error && !uploadRequested(owner));
    assert.equal(owner.state.player.status, "playing");
    assert.equal(owner.state.liveSources?.[0]?.id, "screen");
    assert.equal(loads(other), before.loads);
    assert.equal(other.load()!.livePeerId, peer);
    assert.equal(other.messages.slice(before.messages).some(message => message.type === "player" && message.command.type === "stop"), false);
    const requested = owner.messages.filter(message => message.type === "livePeers" && message.upload).length;
    fail(owner); // An already-failed upload cannot retry itself through its failure callback.
    await barrier(owner);
    await barrier(owner);
    assert.equal(owner.messages.filter(message => message.type === "livePeers" && message.upload).length, requested);
    f.answerUploads(owner);
    assert.equal((await owner.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.hls && uploadRequested(owner));
    assert.equal((await fetch(f.receiver.load()!.source)).status, 200);
    assert.equal(loads(other), before.loads);
    assert.equal(other.load()!.livePeerId, peer);
    assert.equal(owner.state.outputs?.find(output => output.deviceId === f.receiver.id)?.error, undefined);
  } finally { await f.close(); }
});

test("a pre-socket upload failure promptly rejects pending In sync playback without ending capture", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const owner = await start(f);
    await addOther(f, owner);
    assert.equal((await owner.command({ type: "inSync", inSync: true })).ok, true);
    await until(() => uploadRequested(owner));
    assert.equal(f.uploads.size, 0);
    fail(owner);
    await until(() => owner.state.player.status === "error" && !uploadRequested(owner));
    assert.equal(owner.state.player.error, error);
    assert.equal(owner.state.player.buffering, false);
    assert.equal(owner.state.liveSources?.[0]?.id, "screen");
  } finally { await f.close(); }
});

test("only the exact publisher can fail a requested upload; ended and unrequested source notifications are ignored", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const owner = await start(f);
    fail(owner); // There is no requested upload yet.
    await barrier(owner);
    assert.equal(owner.state.player.status, "playing");
    await fallback(f, owner);
    for (const device of [0, 2]) {
      const intruder = await f.connect(device);
      const closed = new Promise<number>(resolve => intruder.socket.once("close", code => resolve(code)));
      fail(intruder);
      assert.equal(await closed, 1008, "another tab of the same Device has no publisher permission");
      assert.equal(uploadRequested(owner), true);
      assert.equal(owner.state.liveSources?.[0]?.id, "screen");
    }
    assert.equal((await owner.command({ type: "endLive", sourceId: "screen" })).ok, true);
    assert.equal((await owner.command({ type: "publishLive", sourceId: "replacement", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
    assert.equal((await owner.command({ type: "playLive", sourceId: "replacement", deviceId: f.receiver.id })).ok, true);
    await until(() => f.receiver.load()?.liveSourceId === "replacement");
    f.receiver.report();
    await until(() => owner.state.player.status === "playing");
    await fallback(f, owner);
    fail(owner, "screen");
    await barrier(owner);
    assert.equal(uploadRequested(owner), true, "an ended source cannot fail its replacement's pending upload");
    assert.equal(owner.state.liveSources?.[0]?.id, "replacement");
    assert.notEqual(owner.state.player.status, "error");
    fail(owner, "replacement");
    await until(() => owner.state.player.status === "error" && !uploadRequested(owner));
  } finally { await f.close(); }
});
