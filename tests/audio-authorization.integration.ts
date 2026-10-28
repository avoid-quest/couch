import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { AudioCodec, beginClientHandshake, Identity, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

test("revocation closes an authorized audio connection during its Noise handshake", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await f.close(); });
  await once(socket, "open");
  const handshake = beginClientHandshake({ identity: identity.key, suite: "25519_AESGCM_SHA256" });
  const frames: string[] = [];
  socket.on("message", (data, binary) => { if (!binary) frames.push(String(data)); });
  socket.send(handshake.clientInit);
  await until(() => frames.length === 2);
  handshake.onServerInit(frames[0]!);
  const next = await handshake.onMessage1(frames[1]!);
  const removal = await fetch(`${f.hub.origin}/api/devices/${identity.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } });
  assert.equal(removal.status, 200);
  const accepted: string[] = [];
  socket.on("message", (data, binary) => {
    if (binary) {
      const frame = next.result.transport.decode(Buffer.from(data as Buffer));
      if (frame?.kind === "text") accepted.push(JSON.parse(frame.data).type);
    }
  });
  if (socket.readyState === WebSocket.OPEN) socket.send(next.send);
  await until(() => socket.readyState === WebSocket.CLOSED || accepted.length > 0);
  assert.deepEqual(accepted, [], "a revoked connection must not finish the handshake and receive server/hello");
  assert.equal(socket.readyState, WebSocket.CLOSED);
});

test("turning network sharing off closes an established paired audio session", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const player = new SendspinClient(identity.id, "Receiver", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [],
  } });
  t.after(async () => { await player.disconnect(); await f.close(); });
  await player.connect(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  assert.equal(player.isConnected, true);
  assert.equal((await f.api("/api/settings/sharing", { enabled: false })).status, 200);
  await until(() => !player.isConnected);
});

test("identity rebinding retires the old control connection and its publication", { timeout: 10_000 }, async t => {
  const f = await liveFixture();
  const identity = f.identities[0]!;
  const audio = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  audio.on("error", () => {});
  t.after(async () => { audio.terminate(); await f.close(); });
  await once(audio, "open");
  await f.publish("old-publication", "microphone");
  f.identities[0]!.id = Identity.generate().peerId;
  const replacement = await f.connect(0);
  await until(() => replacement.state.devices?.some(device => device.id === replacement.id) === true);
  assert.equal((await f.api("/api/devices/me").then(response => response.json())).device.id, replacement.id);
  await until(() => f.publisher.socket.readyState === WebSocket.CLOSED);
  await until(() => audio.readyState === WebSocket.CLOSED);
  assert.equal(replacement.state.liveSources?.some(source => source.id === "old-publication"), false);
});

test("one paired device cannot accumulate unlimited audio connections", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!, sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await f.close(); });
  const connect = () => new Promise<boolean>(resolve => {
    const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
    sockets.push(socket);
    socket.once("open", () => resolve(true));
    socket.on("error", () => resolve(false));
    socket.once("unexpected-response", (request, response) => { response.resume(); request.destroy(); resolve(false); });
  });
  for (let i = 0; i < 8; i++) assert.equal(await connect(), true);
  assert.equal(await connect(), false, "a ninth connection must be refused before allocating another worker transport");
  const closed = once(sockets[0]!, "close"); sockets[0]!.terminate(); await closed;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await connect(), true, "closing a connection returns its slot");
});

test("one paired device cannot multiply control connections and capture publications without limit", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!, sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await f.close(); });
  const connect = () => new Promise<number>(resolve => {
    const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}`, { origin: f.hub.origin });
    sockets.push(socket);
    socket.once("open", () => resolve(101));
    socket.on("error", () => resolve(0));
    socket.once("unexpected-response", (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode!); });
  });
  // The fixture already has one connection for this device.
  for (let i = 1; i < 8; i++) assert.equal(await connect(), 101);
  assert.equal(await connect(), 429);
});

test("an unfinished Noise handshake cannot hold an audio connection indefinitely", { timeout: 15_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await f.close(); });
  await once(socket, "open");
  const greeting = once(socket, "message");
  socket.send(beginClientHandshake({ identity: identity.key, suite: "25519_AESGCM_SHA256" }).clientInit);
  await greeting;
  const closed = await Promise.race([once(socket, "close").then(() => true), new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 11_000); timer.unref();
  })]);
  assert.equal(closed, true, "the deadline must cover the complete handshake, not just its first frame");
});

test("pairing a device again closes audio and publications authorized with its old token", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[0]!;
  const player = new SendspinClient(identity.id, "Publisher", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [],
  } });
  t.after(async () => { await player.disconnect(); await f.close(); });
  await player.connect(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  await f.publish("old-token-publication", "microphone");
  const paired = await fetch(`${f.hub.origin}/api/pair`, { method: "POST", headers: { Origin: f.hub.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: f.hub.pairingCode, id: identity.id, name: "Publisher" }) });
  assert.equal(paired.status, 200);
  assert.equal((await f.api("/api/devices/me")).status, 401, "the old bearer token is already invalid");
  await until(() => !player.isConnected);
  await until(() => f.publisher.socket.readyState === WebSocket.CLOSED);
  await until(() => !f.receiver.state.liveSources?.some(source => source.id === "old-token-publication"));
});
