import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Identity } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-admission-")), cwd = process.cwd();
  const previous = { COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, COUCH_PORT: process.env.COUCH_PORT };
  process.chdir(directory);
  process.env.COUCH_DATA_DIR = directory;
  process.env.COUCH_PORT = "0";
  const f = await liveFixture();
  t.after(async () => {
    try { await f.close(); } finally {
      process.chdir(cwd);
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const pair = (code = f.hub.pairingCode, id = Identity.generate().peerId) => fetch(`${f.hub.origin}/api/pair`, {
    method: "POST", headers: { Origin: f.hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code, id }),
  });
  return { ...f, pair };
}

async function group(t: TestContext) {
  const f = await fixture(t), other = await f.connect(2, "&audio=1&video=1");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  await f.publish("event", "microphone");
  for (const receiver of [f.receiver, other]) assert.equal((await receiver.command({ type: "playLive", sourceId: "event" })).ok, true);
  await until(() => [f.receiver, other].every(receiver => !!receiver.load()?.livePeerId && receiver.state.outputs?.length === 2));
  // Freeze only the budget clock, after setup, so traffic cannot straddle a second.
  const now = Date.now() + 1100;
  t.mock.method(Date, "now", () => now);
  return { ...f, other };
}

const signal = (peerId: string, description = false, padding = 0) => ({ type: "liveSignal", peerId, signal: description
  ? { description: { type: "offer", sdp: "fixture" } }
  : { candidate: { candidate: "fixture" } }, padding: "x".repeat(padding) });
const send = (client: { socket: { send(message: string): void } }, message: unknown) => client.socket.send(JSON.stringify(message));
const closed = (socket: { once(event: "close", callback: (code: number, reason: Buffer) => void): unknown }) => new Promise<{ code: number; reason: string }>(resolve => socket.once("close", (code, reason) => resolve({ code, reason: String(reason) })));

test("128 valid admissions and one retry per identity preserve token rotation and failed-guess limits", { timeout: 15_000 }, async t => {
  const f = await fixture(t), id = Identity.generate().peerId;
  const first = await (await f.pair(undefined, id)).json();
  const retry = await f.pair(undefined, id);
  assert.equal(retry.status, 200);
  const second = await retry.json();
  assert.notEqual(first.token, second.token);
  assert.equal((await fetch(`${f.hub.origin}/api/devices/me`, { headers: { Authorization: `Bearer ${first.token}` } })).status, 401);
  assert.equal((await f.pair(undefined, id)).status, 429, "a third success for one identity cannot consume the audience budget");
  const valid = await Promise.all(Array.from({ length: 126 }, () => f.pair()));
  assert.ok(valid.every(response => response.status === 200), "128 successful admissions remain available");
  assert.equal((await f.pair()).status, 429);
  for (let i = 0; i < 20; i++) assert.equal((await f.pair("wrong")).status, 401);
  assert.equal((await f.pair("wrong")).status, 429);
});

test("authenticated signaling has its own allowance and leaves all 60 ordinary commands available", { timeout: 10_000 }, async t => {
  const f = await group(t), before = [f.receiver.messages.length, f.other.messages.length];
  for (const receiver of [f.receiver, f.other]) for (let i = 0; i < 32; i++) send(f.publisher, signal(receiver.load()!.livePeerId!));
  await until(() => {
    assert.equal(f.publisher.socket.readyState, 1, "signaling cannot spend the command allowance");
    return [f.receiver, f.other].every((receiver, index) => receiver.messages.slice(before[index]).filter(message => message.type === "liveSignal").length === 32);
  });
  for (let i = 0; i < 60; i++) assert.equal((await f.publisher.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
  const ending = closed(f.publisher.socket);
  send(f.publisher, { type: "command", requestId: "excess", action: { type: "sharing", sharing: { audio: true, video: false } } });
  assert.deepEqual(await ending, { code: 1008, reason: "Too many commands." });
});

for (const description of [false, true]) test(`signaling bounds ${description ? "descriptions" : "candidates"} per peer`, { timeout: 10_000 }, async t => {
  const f = await group(t), ending = closed(f.publisher.socket), limit = description ? 4 : 64;
  for (let i = 0; i <= limit; i++) send(f.publisher, signal(f.receiver.load()!.livePeerId!, description));
  assert.deepEqual(await ending, { code: 1008, reason: "Too much live signaling." });
  assert.equal(f.other.socket.readyState, 1);
});

for (const kind of ["peers", "messages", "bytes"] as const) test(`signaling bounds per-socket ${kind}, including retired grants`, { timeout: 15_000 }, async t => {
  const f = await fixture(t), now = Date.now() + 1100;
  t.mock.method(Date, "now", () => now);
  const ending = closed(f.publisher.socket), count = kind === "peers" ? 257 : kind === "messages" ? 8193 : 171;
  for (let i = 0; i < count; i++) send(f.publisher, signal(`retired-${kind === "peers" ? i : Math.floor(i / 64)}`, false, kind === "bytes" ? 50 * 1024 : 0));
  assert.deepEqual(await ending, { code: 1008, reason: "Too much live signaling." });
  assert.equal(f.receiver.socket.readyState, 1);
});

test("concurrent incorrect codes still stop at the existing twenty-failure peer limit", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const attempts = await Promise.all(Array.from({ length: 40 }, () => f.pair("wrong")));
  assert.equal(attempts.filter(response => response.status === 401).length, 20);
  assert.equal(attempts.filter(response => response.status === 429).length, 20);
  assert.equal((await f.pair()).status, 429);
});

test("forged live grants reject while retired grants stay harmless", { timeout: 10_000 }, async t => {
  const f = await group(t), ending = closed(f.receiver.socket);
  send(f.receiver, signal(f.other.load()!.livePeerId!));
  assert.deepEqual(await ending, { code: 1008, reason: "No permission for that live peer." });
  send(f.publisher, signal("retired-peer"));
  assert.equal((await f.publisher.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
});

test("signaling budgets refresh after one second and invalid envelopes still reject", { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  let now = Date.now() + 1100;
  t.mock.method(Date, "now", () => now);
  for (let turn = 0; turn < 2; turn++) {
    for (let i = 0; i < 4; i++) send(f.publisher, signal("retired", true));
    assert.equal((await f.publisher.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    now += 1000;
  }
  const ending = closed(f.publisher.socket);
  send(f.publisher, { type: "liveSignal", peerId: "retired", signal: { description: { type: "offer", sdp: 123 } } });
  assert.equal((await ending).code, 1008);
});

test("pairing identity retries refresh after a minute without extending old tokens", { timeout: 10_000 }, async t => {
  const f = await fixture(t), id = Identity.generate().peerId;
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const first = await (await f.pair(undefined, id)).json();
  assert.equal((await f.pair(undefined, id)).status, 200);
  assert.equal((await f.pair(undefined, id)).status, 429);
  now += 60_000;
  assert.equal((await f.pair(undefined, id)).status, 200);
  assert.equal((await fetch(`${f.hub.origin}/api/devices/me`, { headers: { Authorization: `Bearer ${first.token}` } })).status, 401);
});
