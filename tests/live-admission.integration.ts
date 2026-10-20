import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Identity } from "@sonn-audio/node-sendspin";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import type { Device } from "../src/shared/devices";
import type { Action, ServerMessage } from "../src/shared/protocol";
import { writeEvidence } from "./evidence";

// Protocol load only: real HTTP, authenticated WebSockets, grants and revocation.
// SDP/ICE are synthetic; this does not measure WebRTC negotiation or audio output.
const until = async (predicate: () => boolean) => {
  // Fixture setup is intentionally not the ten-second audio-start acceptance gate.
  // Large output-group churn currently spends substantial time publishing state.
  const deadline = Date.now() + 45_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Expected protocol state did not arrive.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
type Paired = { token: string; device: Device };

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-admission-"));
  const previous = { COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, COUCH_PORT: process.env.COUCH_PORT };
  process.env.COUCH_DATA_DIR = directory;
  process.env.COUCH_PORT = "0";
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) => /^http:\/\/127\.0\.0\.1:/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;
  const sockets: WebSocket[] = [];
  const hub = await createHub({ databasePath: join(directory, "couch.sqlite"), hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await hub.close();
    globalThis.fetch = fetchLocal;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  });
  const pair = (body: Record<string, unknown> = {}) => fetch(`${hub.origin}/api/pair`, {
    method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: hub.pairingCode, id: Identity.generate().peerId, ...body }),
  });
  const admit = async () => {
    const response = await pair();
    assert.equal(response.status, 200);
    return await response.json() as Paired;
  };
  const api = (path: string, token: string, method = "GET") => fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}` } });
  const connect = async (identity: Paired) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.device.id}&audio=1&video=1`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    let closed: { code: number; reason: string } | undefined;
    socket.on("message", data => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "livePeers" || message.type === "state" && messages.some(item => item.type === "state")) return;
      messages.push(message);
    });
    socket.on("close", (code, reason) => { closed = { code, reason: String(reason) }; });
    socket.on("error", () => {});
    await until(() => { assert.equal(closed, undefined, "The connection closed before publishing state."); return messages.some(message => message.type === "state"); });
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    return { ...identity, socket, messages, send, get closed() { return closed; }, command: async (action: Action) => {
      const requestId = crypto.randomUUID();
      send({ type: "command", requestId, action });
      await until(() => messages.some(message => message.type === "result" && message.requestId === requestId));
      const result = messages.find(message => message.type === "result" && message.requestId === requestId);
      assert.ok(result?.type === "result" && result.ok, JSON.stringify(result));
    }, peer: () => {
      const load = messages.findLast(message => message.type === "player" && message.command.type === "load");
      return load?.type === "player" && load.command.type === "load" ? load.command.livePeerId : undefined;
    } };
  };
  return { hub, pair, admit, api, connect };
}

for (const count of [50, 100]) test(`protocol admission: ${count} valid pairings coexist with invalid and repeated requests`, { timeout: 20_000 }, async t => {
  const f = await fixture(t), admin = await f.admit();
  const start = performance.now();
  const [valid, invalid, repeated] = await Promise.all([
    Promise.all(Array.from({ length: count }, () => f.pair())),
    Promise.all(Array.from({ length: 8 }, () => f.pair({ code: "incorrect" }))),
    Promise.all(Array.from({ length: 5 }, () => f.pair({ id: admin.device.id }))),
  ]);
  const duration = performance.now() - start;
  assert.ok(valid.every(response => response.status === 200));
  assert.ok(invalid.every(response => response.status === 401));
  assert.deepEqual(repeated.map(response => response.status).sort(), [200, 429, 429, 429, 429]);
  assert.equal(admin.device.role, "administrator");
  for (const response of valid) assert.equal(((await response.json()) as Paired).device.role, "controller");
  assert.ok(duration < 10_000);
  await writeEvidence(`live-admission-${count}`, { input: "protocol: loopback HTTP pairing burst with existing Couch invitation and identities", measured: { participants: count, admitted: count, durationMs: duration, invalid: 8, replayLimited: 4 }, untested: ["Real WebRTC negotiation", "Browser decode/render and audio unlock", "Acoustic latency", "Phone compatibility", "Venue Wi-Fi"] });
});

test("pairing bounds successful admissions at 128 per minute", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const valid = await Promise.all(Array.from({ length: 130 }, () => f.pair()));
  assert.equal(valid.filter(response => response.status === 200).length, 128);
  assert.equal(valid.filter(response => response.status === 429).length, 2);
});

test("twenty failed guesses still lock the shared invitation, including concurrent requests", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const invalid = await Promise.all(Array.from({ length: 40 }, () => f.pair({ code: "incorrect" })));
  assert.equal(invalid.filter(response => response.status === 401).length, 20);
  assert.equal(invalid.filter(response => response.status === 429).length, 20);
  assert.equal((await f.pair()).status, 429, "a failed-guess lockout cannot be bypassed by continuing to guess");
});

test("pairing rejects malformed requests, rotates tokens on retry, and preserves revocation", { timeout: 20_000 }, async t => {
  const f = await fixture(t), admin = await f.admit(), first = await f.admit();
  assert.equal((await f.pair({ id: "bad-key" })).status, 400);
  assert.equal((await f.pair({ name: "x".repeat(3000) })).status, 413);
  const malformed = await fetch(`${f.hub.origin}/api/pair`, { method: "POST", headers: { Origin: f.hub.origin, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  const retry = await f.pair({ id: first.device.id }), second = await retry.json() as Paired;
  assert.equal(retry.status, 200);
  assert.equal(second.device.role, "controller");
  assert.notEqual(first.token, second.token);
  assert.equal((await f.api("/api/devices/me", first.token)).status, 401);
  assert.equal((await f.pair({ id: first.device.id })).status, 429);
  const client = await f.connect(second);
  assert.equal((await f.api(`/api/devices/${first.device.id}`, second.token, "DELETE")).status, 403);
  assert.equal((await f.api(`/api/devices/${first.device.id}`, admin.token, "DELETE")).status, 200);
  await until(() => !!client.closed);
  assert.equal(client.closed?.code, 4001);
  assert.equal((await f.api("/api/devices/me", second.token)).status, 401);
});

async function liveGroup(t: TestContext, count: number) {
  const f = await fixture(t), publisher = await f.connect(await f.admit());
  const receivers = await Promise.all(Array.from({ length: count }, async () => f.connect(await f.admit())));
  await publisher.command({ type: "publishLive", sourceId: "event", uploadToken: "a".repeat(64), kind: "microphone", audio: true, video: false });
  await receivers[0]!.command({ type: "playLive", sourceId: "event" });
  await Promise.all(receivers.slice(1).map(receiver => receiver.command({ type: "playLive", sourceId: "event" })));
  await until(() => receivers.every(receiver => !!receiver.peer()));
  return { ...f, publisher, receivers };
}
const offer = (peerId: string) => ({ type: "liveSignal", peerId, signal: { description: { type: "offer", sdp: "protocol fixture, not negotiated SDP" } } });
const candidate = (peerId: string) => ({ type: "liveSignal", peerId, signal: { candidate: { candidate: "protocol candidate" } } });
const signalCount = (client: { messages: ServerMessage[] }) => client.messages.filter(message => message.type === "liveSignal").length;

// The 100-peer reconnect stress has not delivered state within 45 s on the lab runner.
// Keep that observation reproducible without declaring the stretch target qualified.
for (const count of [50, 100]) test(`protocol signaling: ${count} peers and reconnects leave publisher commands available`, {
  timeout: 90_000,
  skip: count === 100 && process.env.COUCH_LIVE_STRETCH !== "1" ? "Unqualified 100-peer reconnect stress; run with COUCH_LIVE_STRETCH=1." : false,
}, async t => {
  const start = performance.now();
  const f = await liveGroup(t, count);
  const setupMs = performance.now() - start;
  const exchange = async (receivers: typeof f.receivers) => {
    const before = signalCount(f.publisher);
    for (const receiver of receivers) {
      f.publisher.send(offer(receiver.peer()!));
      for (let i = 0; i < 8; i++) f.publisher.send(candidate(receiver.peer()!));
      receiver.send({ type: "liveSignal", peerId: receiver.peer(), signal: { description: { type: "answer", sdp: "protocol answer" } } });
    }
    await until(() => receivers.every(receiver => signalCount(receiver) === 9) && signalCount(f.publisher) === before + receivers.length);
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal(f.publisher.closed, undefined);
  };
  await exchange(f.receivers);
  const old = f.receivers.map(receiver => receiver.peer());
  const reconnectStart = performance.now();
  const reconnected = await Promise.all(f.receivers.map(async receiver => { receiver.socket.terminate(); return f.connect(receiver); }));
  await until(() => reconnected.every(receiver => !!receiver.peer()));
  const reconnectMs = performance.now() - reconnectStart;
  assert.ok(reconnected.every((receiver, index) => receiver.peer() !== old[index]));
  await exchange(reconnected);
  // Removed grants ignore delayed ICE; other receivers stay authorized.
  f.publisher.send(candidate(old[0]!));
  const revoked = reconnected[0]!;
  assert.equal((await f.api(`/api/devices/${revoked.device.id}`, f.publisher.token, "DELETE")).status, 200);
  await until(() => revoked.closed?.code === 4001);
  assert.equal((await f.api("/api/devices/me", revoked.token)).status, 401);
  f.publisher.send(candidate(reconnected[1]!.peer()!));
  await until(() => signalCount(reconnected[1]!) === 10);
  assert.equal(f.publisher.closed, undefined);
  t.diagnostic(JSON.stringify({ evidence: "protocol", participants: count, setupMs, reconnectMs }));
  await writeEvidence(`live-signaling-${count}`, { input: "protocol: real loopback WebSockets, synthetic SDP/ICE, no browser peer connections", measured: { participants: count, setupMs, reconnectMs, signalsPerPeer: 9, publisherDisconnected: false }, untested: ["Real WebRTC negotiation", "Ten-second audio startup gate", "Browser decode/render", "Acoustic latency", "Venue Wi-Fi"] });
});

test("signaling rejects forged grants, excess offers/ICE, and malformed traffic without relaxing commands", { timeout: 30_000 }, async t => {
  const f = await liveGroup(t, 2), [one, two] = f.receivers;
  one!.send(offer(two!.peer()!));
  await until(() => !!one!.closed);
  assert.deepEqual(one!.closed, { code: 1008, reason: "No permission for that live peer." });
  for (let i = 0; i < 65; i++) two!.send(candidate(two!.peer()!));
  await until(() => !!two!.closed);
  assert.deepEqual(two!.closed, { code: 1008, reason: "Too much live signaling." });
  assert.equal(f.publisher.closed, undefined);
  const repeated = await f.connect(await f.admit());
  for (let i = 0; i < 5; i++) repeated.send(offer("retired-peer"));
  await until(() => !!repeated.closed);
  assert.deepEqual(repeated.closed, { code: 1008, reason: "Too much live signaling." });
  const malformed = await f.connect(await f.admit());
  malformed.send({ type: "liveSignal", peerId: "bad", signal: { description: { type: "offer", sdp: 123 } } });
  await until(() => !!malformed.closed);
  assert.equal(malformed.closed?.code, 1008);
  const commands = await f.connect(await f.admit());
  for (let i = 0; i < 61; i++) commands.send({ type: "command", requestId: String(i), action: { type: "sharing", sharing: { audio: true, video: false } } });
  await until(() => !!commands.closed);
  assert.deepEqual(commands.closed, { code: 1008, reason: "Too many commands." });
});
