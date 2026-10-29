import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { test } from "node:test";
import { WebSocket } from "ws";
import { AudioCodec, beginClientHandshake, Identity, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

test("rebinding a paired ID refuses its old control and capture upload while host windows stay connected", { timeout: 10_000 }, async t => {
  const f = await liveFixture({ media: { ffmpeg: process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", recording: new Uint8Array() } }), identity = f.identities[0]!;
  t.after(() => f.close());
  const host = await f.connect(-1), key = Identity.generate();
  f.identities.push({ key, id: key.peerId, token: "h".repeat(64) });
  const otherHost = await f.connect(f.identities.length - 1);
  for (const window of [host, otherHost]) {
    assert.equal(window.socket.readyState, WebSocket.OPEN);
    assert.equal((await window.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
  }
  assert.equal((await f.publisher.command({ type: "publishLive", sourceId: "rebound-capture", uploadToken: f.uploadToken,
    kind: "microphone", audio: true, video: false, audioDelivery: "pcm" })).ok, true);
  const capture = await f.streamCapture(f.publisher, "rebound-capture");
  t.after(() => capture.stop());
  const clock = once(capture.upload, "message");
  capture.upload.send(JSON.stringify({ type: "clock", clientUs: 1 }));
  assert.equal(JSON.parse(String((await clock)[0])).type, "clock", "the upload reaches the worker before rebinding");
  assert.equal(capture.upload.readyState, WebSocket.OPEN);
  const oldId = identity.id;
  identity.id = Identity.generate().peerId;
  const rebound = await f.connect(0);
  assert.equal(rebound.id, identity.id);
  assert.equal((await f.api("/api/devices/me")).status, 200, "rebinding preserves the token");
  // Keep sending valid PCM: a stalled or malformed upload must not explain its closure.
  await until(() => f.publisher.socket.readyState === WebSocket.CLOSED && capture.upload.readyState === WebSocket.CLOSED)
    .catch(() => assert.deepEqual({ control: f.publisher.socket.readyState, upload: capture.upload.readyState },
      { control: WebSocket.CLOSED, upload: WebSocket.CLOSED }, "the old control connection and active capture upload must close after rebinding"));
  assert.ok(!rebound.state.liveSources?.some(source => source.deviceId === oldId));
  for (const window of [host, otherHost]) {
    assert.equal(window.socket.readyState, WebSocket.OPEN);
    assert.equal((await window.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
  }
  const refused = new WebSocket(capture.upload.url, { origin: f.hub.origin });
  refused.on("error", () => {});
  t.after(() => refused.terminate());
  const status = await new Promise<number>(resolve => {
    refused.once("open", () => resolve(101));
    refused.once("unexpected-response", (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode!); });
  });
  assert.equal(status, 403, "old capture credentials cannot open another upload");
});

test("rebinding a paired ID closes its Sendspin session and removes its output assignments", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const player = new SendspinClient(identity.id, "Receiver", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [],
  } });
  t.after(async () => { await player.disconnect(); await f.close(); });
  const host = await f.connect(-1);
  await player.connect(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  identity.id = Identity.generate().peerId;
  const rebound = await f.connect(1);
  await until(() => !player.isConnected)
    .catch(() => assert.fail("the old Sendspin session must close after rebinding"));
  assert.equal((await host.command({ type: "publishLive", sourceId: "concert", uploadToken: f.uploadToken,
    kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" })).ok, true);
  assert.equal((await rebound.command({ type: "playLive", sourceId: "concert", deviceId: identity.id })).ok, true);
  await until(() => host.state.playbacks?.some(playback => playback.outputs.some(output => output.deviceId === identity.id)) === true);
  const oldId = identity.id;
  identity.id = Identity.generate().peerId;
  await f.connect(1);
  await until(() => host.state.playbacks?.every(playback => playback.outputs.every(output => output.deviceId !== oldId)) === true);
  assert.ok(host.state.liveSources?.some(source => source.id === "concert"), "another device's publication survives");
});

test("repeated paired ID rebinding leaves only the current ID's connections, and revocation closes them", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const generations: WebSocket[][] = [[f.receiver.socket]];
  t.after(async () => { for (const socket of generations.flat()) socket.terminate(); await f.close(); });
  const connect = (path: string, sockets: WebSocket[]) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}${path}`, { origin: f.hub.origin });
    sockets.push(socket);
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  for (let generation = 0; generation < 3; generation++) {
    if (generation) { identity.id = Identity.generate().peerId; generations.push([]); }
    const sockets = generations.at(-1)!;
    for (let i = 0; i < 2; i++) await connect(`/api/ws?token=${identity.token}&device=${identity.id}`, sockets);
    for (let i = 0; i < 2; i++) await connect(`/api/audio/${identity.token}/sendspin`, sockets);
    await until(() => generations.slice(0, -1).flat().every(socket => socket.readyState !== WebSocket.OPEN));
  }
  assert.equal((await fetch(`${f.hub.origin}/api/devices/${identity.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } })).status, 200);
  await until(() => generations.flat().every(socket => socket.readyState !== WebSocket.OPEN));
});
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

test("audio session cookies and both upgrade routes retain host, origin and token checks", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!, sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await f.close(); });
  const authorize = (headers: Record<string, string> = {}) => fetch(`${f.hub.origin}/api/audio/session`, { method: "POST", headers: { Authorization: `Bearer ${identity.token}`, ...headers } });
  const response = await authorize();
  assert.equal(response.status, 204);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /; HttpOnly; SameSite=Strict; Path=\/sendspin$/);
  assert.doesNotMatch(cookie, /Domain=|Max-Age=|Expires=/i, "the cookie is host-only and lasts for the browser session");
  assert.equal((await authorize({ Origin: "https://evil.example" })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${f.hub.origin}/api/audio/session`, {
      method: "POST", headers: { Host: "evil.example", Authorization: `Bearer ${identity.token}` },
    }, response => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject); request.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await authorize({ Authorization: "Bearer invalid" })).status, 401);
  const secureCookie = await new Promise<string>((resolve, reject) => {
    const request = httpsRequest(`${f.hub.origin.replace("http:", "https:")}/api/audio/session`, {
      method: "POST", rejectUnauthorized: false, headers: { Authorization: `Bearer ${identity.token}` },
    }, response => { response.resume(); resolve(response.headers["set-cookie"]?.[0] ?? ""); });
    request.on("error", reject); request.end();
  });
  assert.match(secureCookie, /; Secure$/);
  const upgrade = (path: string, headers: Record<string, string> = {}) => new Promise<number>(resolve => {
    const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}${path}`, { headers }); sockets.push(socket);
    socket.once("open", () => resolve(101)); socket.on("error", () => resolve(0));
    socket.once("unexpected-response", (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode!); });
  });
  assert.equal(await upgrade("/sendspin"), 401);
  const headers = { Cookie: cookie.split(";")[0]! };
  for (const path of ["/sendspin", `/api/audio/${identity.token}/sendspin`]) {
    assert.equal(await upgrade(path, { ...headers, Origin: "https://evil.example" }), 403);
    assert.equal(await upgrade(path, { ...headers, Host: "evil.example" }), 403);
    assert.equal(await upgrade(path, headers), 101, "non-browser clients may omit Origin but still need their token");
  }
  assert.equal((await fetch(`${f.hub.origin}/api/devices/${identity.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } })).status, 200);
  assert.equal(await upgrade("/sendspin", headers), 401, "revocation also invalidates a retained cookie");
});

test("plaintext hello cannot claim another device behind an authenticated token", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await f.close(); });
  await once(socket, "open");
  const received: string[] = [];
  socket.on("message", data => received.push(String(data)));
  socket.send(JSON.stringify({ type: "client/hello", payload: { client_id: f.identities[0]!.id, version: 1, supported_roles: ["controller@v1"] } }));
  await once(socket, "close");
  assert.deepEqual(received, []);
});

test("pairing retains the twenty-attempt global throttle", { timeout: 10_000 }, async t => {
  const f = await liveFixture(); t.after(() => f.close());
  const body = { code: "wrong", id: Identity.generate().peerId, name: "Unpaired" };
  for (let attempt = 0; attempt < 21; attempt++) {
    const response = await fetch(`${f.hub.origin}/api/pair`, { method: "POST", headers: { Origin: f.hub.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, attempt < 20 ? 401 : 429);
  }
});
