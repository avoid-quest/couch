// PROTOCOL / AUTHORIZATION evidence only. Browser timing belongs to the
// parent's native common-graph run, not these encrypted packet assertions.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, beginClientHandshake, serverNowUs, unpackBinaryHeader, type NoiseTransport } from "@sonn-audio/node-sendspin";
import { openStore } from "../src/server/store";
import { ingressMagic, startIngressLab } from "./audio-lab/ingress-server";

const origin = "http://127.0.0.1:31001";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { assert(Date.now() < deadline, "Protocol state timed out"); await sleep(5); }
}
async function fixture(t: TestContext, packetMs: 10 | 20 = 10) {
  const store = openStore(":memory:");
  const source = Identity.generate(), keys = [Identity.generate(), Identity.generate()];
  const token = store.pair(source.peerId, "Publisher");
  const receiverTokens = keys.map((key, index) => store.pair(key.peerId, `Receiver ${index}`));
  const lab = await startIngressLab({ store, publisherId: source.peerId, receiverIds: keys.map(key => key.peerId), allowedOrigin: origin, packetMs, leadMs: 40 });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await lab.close(); store.close(); });
  async function socket(path: string, browserOrigin = origin) {
    const ws = new WebSocket(lab.origin.replace("http:", "ws:") + path, { origin: browserOrigin });
    sockets.push(ws); await once(ws, "open"); return ws;
  }
  async function publisher(credential = token) {
    const ws = await socket("/__lab/pcm"), replies: any[] = [];
    ws.on("message", data => replies.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "auth", token: credential }));
    await until(() => replies.length > 0 || ws.readyState === WebSocket.CLOSED);
    return { ws, replies, generation: replies[0]?.generation as number };
  }
  async function receiver(key: Identity, identify = true) {
    const ws = await socket("/sendspin");
    // Official Noise implementation; just the protocol hello lives in this
    // fixture because the Node SendspinClient cannot set an Origin header.
    const handshake = beginClientHandshake({ identity: key, suite: "25519_AESGCM_SHA256" });
    let transport: NoiseTransport | undefined, failure: unknown;
    const frames: { timestamp: number; data: Buffer }[] = [], messages: any[] = [];
    const send = (message: unknown) => { for (const bytes of transport!.encodeText(JSON.stringify(message))) ws.send(bytes); };
    ws.on("message", (data, binary) => {
      void (async () => {
        if (!binary) {
          const message = JSON.parse(String(data));
          if (message.type === "server/init") handshake.onServerInit(String(data));
          else if (message.type === "noise/handshake") {
            const next = await handshake.onMessage1(String(data)); transport = next.result.transport;
            ws.send(next.send);
          }
          return;
        }
        const message = transport!.decode(Buffer.from(data as Buffer));
        if (!message) return;
        if (message.kind === "binary") {
          const header = unpackBinaryHeader(message.data);
          frames.push({ timestamp: header.timestampUs, data: Buffer.from(message.data.subarray(9)) });
        } else {
          const value = JSON.parse(message.data); messages.push(value);
          if (value.type === "server/hello" && identify) {
            send({ type: "client/hello", payload: {
              name: "Protocol fixture", supported_roles: [Roles.PLAYER], unpaired_access: { enabled: true },
              "player@v1_support": { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48_000, channels: 2, bit_depth: 16 }], buffer_capacity: 16_000, supported_commands: [] },
            } });
            send({ type: "client/state", payload: { available: true, player: { volume: 100, muted: false, required_lead_time_ms: 10, min_buffer_ms: 10 } } });
          }
        }
      })().catch(error => { failure = error; });
    });
    ws.send(handshake.clientInit);
    await until(() => !!failure || (identify ? lab.snapshot().receivers.some(receiver => receiver.id === key.peerId) : messages.some(message => message.type === "server/hello")));
    assert.ifError(failure);
    return { ws, frames, messages, send };
  }
  function frame(generation: number, sample = 0) {
    const data = Buffer.alloc(packetMs * 48 * 4 + 16, 0x12);
    data.writeUInt32LE(ingressMagic, 0); data.writeUInt32LE(generation, 4); data.writeDoubleLE(sample, 8);
    return data;
  }
  function start(ws: WebSocket, originUs = serverNowUs()) {
    ws.send(JSON.stringify({ type: "start", originUs, firstSample: 0, uncertaintyUs: 100 }));
    return originUs;
  }
  return { store, source, keys, receiverTokens, lab, socket, publisher, receiver, frame, start };
}

for (const packetMs of [10, 20] as const) test(`${packetMs} ms PCM reaches two encrypted admitted receivers; stop clears both`, { timeout: 6000 }, async t => {
  const f = await fixture(t, packetMs), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(), anchor = f.start(publisher.ws);
  const frame = f.frame(publisher.generation);
  publisher.ws.send(frame);
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  assert(f.lab.snapshot().receivers.every(receiver => receiver.encrypted));
  for (const receiver of receivers) {
    assert.deepEqual(receiver.frames[0]!.data, frame.subarray(16));
    assert.equal(receiver.frames[0]!.timestamp, Math.round(anchor + 40_000));
  }
  publisher.ws.send(JSON.stringify({ type: "stop" }));
  // A capture callback already queued behind stop must not restart playback.
  publisher.ws.send(f.frame(publisher.generation, packetMs * 48));
  await until(() => receivers.every(receiver => receiver.messages.some(message => message.type === "stream/clear") && receiver.messages.some(message => message.type === "stream/end")));
  assert.equal(f.lab.snapshot().timeline, null);
  assert.equal(f.lab.snapshot().publisherConnected, false);
  await sleep(25);
  assert(receivers.every(receiver => receiver.frames.length === 1), "No retained audio after source stop");
});

test("late frames drop without moving the group timeline; resumed current samples retain their timestamp", { timeout: 6000 }, async t => {
  const f = await fixture(t), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(), anchor = f.start(publisher.ws);
  publisher.ws.send(f.frame(publisher.generation));
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  await sleep(70);
  publisher.ws.send(f.frame(publisher.generation, 480));
  await until(() => f.lab.snapshot().metrics.lateFrames === 1);
  assert(receivers.every(receiver => receiver.frames.length === 1));
  const currentSample = Math.floor((serverNowUs() - anchor) / 10_000) * 480;
  publisher.ws.send(f.frame(publisher.generation, currentSample));
  await until(() => receivers.every(receiver => receiver.frames.length === 2));
  for (const receiver of receivers) assert.equal(receiver.frames[1]!.timestamp, Math.round(anchor + currentSample / 48_000 * 1e6 + 40_000));
  assert.equal(f.lab.snapshot().timeline!.originUs, anchor);
  assert(f.lab.snapshot().metrics.missingSamples > 0, "Skipped samples remain visible as loss");
});

test("live Couch store revocation stops publisher and clears both encrypted receivers", { timeout: 6000 }, async t => {
  const f = await fixture(t), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(); f.start(publisher.ws); publisher.ws.send(f.frame(publisher.generation));
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  f.store.revokeDevice(f.source.peerId);
  // Recheck the real token at dispatch, not just on the watchdog tick.
  publisher.ws.send(f.frame(publisher.generation, 480));
  await until(() => receivers.every(receiver => receiver.messages.some(message => message.type === "stream/end")));
  assert.match(f.lab.snapshot().metrics.stopReason, /publisher revoked/);
  const retry = await f.publisher(); assert.equal(retry.ws.readyState, WebSocket.CLOSED);
  assert(receivers.every(receiver => receiver.frames.length === 1));
});

test("revoking one receiver leaves the other on the original source clock", { timeout: 6000 }, async t => {
  const f = await fixture(t), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(), anchor = f.start(publisher.ws); publisher.ws.send(f.frame(publisher.generation));
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  f.store.revokeDevice(f.keys[0]!.peerId);
  await until(() => receivers[0]!.ws.readyState === WebSocket.CLOSED);
  const currentSample = Math.floor((serverNowUs() - anchor) / 10_000) * 480 + 480;
  await sleep(10);
  publisher.ws.send(f.frame(publisher.generation, currentSample));
  await until(() => receivers[1]!.frames.length === 2);
  assert.equal(receivers[0]!.frames.length, 1);
  assert.equal(receivers[1]!.frames[1]!.timestamp, Math.round(anchor + currentSample / 48_000 * 1e6 + 40_000));
});

test("missing or wrong publisher credentials, foreign browser origin and plaintext receivers are rejected", { timeout: 6000 }, async t => {
  const f = await fixture(t);
  for (const token of ["", "unpaired", f.receiverTokens[0]!]) {
    const publisher = await f.publisher(token);
    assert.equal(publisher.ws.readyState, WebSocket.CLOSED);
  }
  await assert.rejects(f.socket("/__lab/pcm", "http://foreign.example"), /403/);
  const receiver = await f.socket("/sendspin"), closed = once(receiver, "close");
  receiver.send(JSON.stringify({ type: "client/hello", payload: { client_id: f.keys[0]!.peerId } }));
  await closed;
  assert.equal(f.lab.snapshot().receivers.length, 0);
  assert.equal(f.lab.snapshot().metrics.acceptedFrames, 0);
});

test("pipelined plaintext init, hello and state cannot admit a receiver or expose PCM", { timeout: 6000 }, async t => {
  const f = await fixture(t), healthy = await f.receiver(f.keys[1]!);
  const attacker = await f.socket("/sendspin"), rawFrames: Buffer[] = [];
  attacker.on("message", (data, binary) => { if (binary) rawFrames.push(Buffer.from(data as Buffer)); });
  // Only the public allowlisted key is used. Coalesce the three WS frames into
  // one TCP write to exercise the SDK's asynchronous PSK resolution window.
  const tcp = (attacker as WebSocket & { _socket: Socket })._socket;
  tcp.cork();
  attacker.send(JSON.stringify({ type: "client/init", payload: { client_id: f.keys[0]!.peerId, version: 1, suite: "25519_AESGCM_SHA256" } }));
  attacker.send(JSON.stringify({ type: "client/hello", payload: {
    client_id: f.keys[0]!.peerId, version: 1, name: "Plaintext attacker", supported_roles: [Roles.PLAYER],
    player_support: { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48_000, channels: 2, bit_depth: 16 }], buffer_capacity: 16_000, supported_commands: [] },
  } }));
  attacker.send(JSON.stringify({ type: "client/state", payload: { available: true, player: { volume: 100, muted: false } } }));
  tcp.uncork();
  await until(() => attacker.readyState === WebSocket.CLOSED || f.lab.snapshot().receivers.some(receiver => receiver.id === f.keys[0]!.peerId));
  const publisher = await f.publisher(); f.start(publisher.ws);
  const frame = f.frame(publisher.generation); publisher.ws.send(frame);
  await until(() => healthy.frames.length === 1);
  assert.equal(rawFrames.length, 0, "Unauthenticated receiver must never receive raw PCM");
  assert.equal(attacker.readyState, WebSocket.CLOSED);
  assert.deepEqual(f.lab.snapshot().receivers.map(receiver => receiver.id), [f.keys[1]!.peerId]);
  assert.deepEqual(healthy.frames[0]!.data, frame.subarray(16));
});

test("receiver deadline covers Noise, encrypted hello and initial state; only identified receivers stay connected", { timeout: 6000 }, async t => {
  const f = await fixture(t), healthy = await f.receiver(f.keys[1]!);
  const pending = await f.socket("/sendspin"), messages: any[] = [];
  pending.on("message", data => messages.push(JSON.parse(String(data))));
  pending.send(beginClientHandshake({ identity: f.keys[0]!, suite: "25519_AESGCM_SHA256" }).clientInit);
  await until(() => messages.some(message => message.type === "noise/handshake"));
  const awaitingHello = await f.receiver(f.keys[0]!, false), awaitingState = await f.receiver(f.keys[0]!, false);
  awaitingState.send({ type: "client/hello", payload: {
    name: "Missing state", supported_roles: [Roles.PLAYER], unpaired_access: { enabled: true },
    "player@v1_support": { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48_000, channels: 2, bit_depth: 16 }], buffer_capacity: 16_000, supported_commands: [] },
  } });
  await until(() => awaitingState.messages.some(message => message.type === "group/update"));
  await sleep(3200);
  assert.equal(pending.readyState, WebSocket.CLOSED, "Unfinished Noise handshake must expire");
  assert.equal(awaitingHello.ws.readyState, WebSocket.CLOSED, "Encryption alone does not finish identification");
  assert.equal(awaitingState.ws.readyState, WebSocket.CLOSED, "Encrypted hello alone does not finish identification");
  assert.equal(healthy.ws.readyState, WebSocket.OPEN, "Completed identification cancels the deadline");
  assert.deepEqual(f.lab.snapshot().receivers.map(receiver => receiver.id), [f.keys[1]!.peerId]);
});

test("an encrypted receiver cannot identify as a different allowlisted public key", { timeout: 6000 }, async t => {
  const f = await fixture(t), attacker = await f.receiver(f.keys[0]!, false);
  const closed = once(attacker.ws, "close");
  attacker.send({ type: "client/hello", payload: {
    client_id: f.keys[1]!.peerId, name: "Forged receiver", supported_roles: [Roles.PLAYER], unpaired_access: { enabled: true },
    "player@v1_support": { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48_000, channels: 2, bit_depth: 16 }], buffer_capacity: 16_000, supported_commands: [] },
  } });
  attacker.send({ type: "client/state", payload: { available: true, player: { volume: 100, muted: false } } });
  await closed;
  assert.equal(f.lab.snapshot().receivers.length, 0);
  assert.equal(attacker.frames.length, 0);
  // A rejected attempt must not reserve the victim's identity.
  const receiver = await f.receiver(f.keys[1]!);
  assert.equal(receiver.ws.readyState, WebSocket.OPEN);
  assert(f.lab.snapshot().receivers[0]!.encrypted);
});

test("replayed counters and stale publication generations cannot inject audio", { timeout: 6000 }, async t => {
  const f = await fixture(t), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(); f.start(publisher.ws);
  const frame = f.frame(publisher.generation); publisher.ws.send(frame);
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  publisher.ws.send(frame);
  await until(() => !f.lab.snapshot().publisherConnected);
  const restarted = await f.publisher(); f.start(restarted.ws); restarted.ws.send(frame);
  await until(() => !f.lab.snapshot().publisherConnected);
  assert(receivers.every(receiver => receiver.frames.length === 1));
  assert.equal(f.lab.snapshot().metrics.rejected, 2);
});

test("bounded receiver socket pressure excludes only that receiver and preserves the healthy deadline", { timeout: 6000 }, async t => {
  const serverSockets: WebSocket[] = [];
  const upgrade = WebSocketServer.prototype.handleUpgrade;
  t.mock.method(WebSocketServer.prototype, "handleUpgrade", function(this: WebSocketServer, ...args: Parameters<typeof upgrade>) {
    const [request, socket, head, callback] = args;
    return upgrade.call(this, request, socket, head, (client, req) => {
      if (request.url === "/sendspin") serverSockets.push(client);
      callback(client, req);
    });
  });
  const f = await fixture(t), receivers = await Promise.all(f.keys.map(key => f.receiver(key)));
  const publisher = await f.publisher(), anchor = f.start(publisher.ws); publisher.ws.send(f.frame(publisher.generation));
  await until(() => receivers.every(receiver => receiver.frames.length === 1));
  // Explicit deterministic queue model at the socket boundary. It does not
  // claim to reproduce a real TCP outage or qualify browser audio under loss.
  Object.defineProperty(serverSockets[0]!, "bufferedAmount", { get: () => 20_000, configurable: true });
  const currentSample = Math.floor((serverNowUs() - anchor) / 10_000) * 480 + 480;
  await sleep(10);
  publisher.ws.send(f.frame(publisher.generation, currentSample));
  await until(() => receivers[1]!.frames.length === 2);
  assert.equal(f.lab.snapshot().metrics.excluded[f.keys[0]!.peerId], "receiver byte budget");
  assert.equal(f.lab.snapshot().timeline!.originUs, anchor);
  assert.equal(receivers[0]!.frames.length, 1);
  assert.equal(receivers[1]!.frames[1]!.timestamp, Math.round(anchor + currentSample / 48_000 * 1e6 + 40_000));
});
