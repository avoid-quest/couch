import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { defaultDeviceSharing } from "../src/shared/device-sharing";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-sharing-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const adminKey = Identity.generate(), deviceKey = Identity.generate(), adminId = adminKey.peerId, deviceId = deviceKey.peerId;
  const adminToken = store.pair(adminId, "Admin"), deviceToken = store.pair(deviceId, "Device");
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [], chunks = new Map<string, number>();
  // A Device's Sendspin player: the levels Core sends it while its sound is synced.
  async function speaker(key: Identity) {
    const levels: number[] = [], client = new SendspinClient(key.peerId, "Test speaker", [Roles.PLAYER], {
      playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.VOLUME] },
    });
    speakers.push(client);
    client.addAudioChunkListener(() => chunks.set(key.peerId, (chunks.get(key.peerId) ?? 0) + 1));
    client.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.VOLUME) levels.push(command.player.volume!); });
    await client.connect(`${hub.origin.replace("http:", "ws:")}/api/audio/${key.peerId === adminId ? adminToken : deviceToken}/sendspin`, { timeoutMs: 3_000 });
    return levels;
  }
  async function connect(token: string, id: string, options = "") {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${options}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, messages, get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  }
  const admin = await connect(adminToken, adminId), device = await connect(deviceToken, deviceId, "&updates=1");
  return { hub, admin, device, adminId, deviceId, deviceToken, connect, heard: (id: string) => chunks.get(id) ?? 0, speakers: () => Promise.all([speaker(adminKey), speaker(deviceKey)]),
    api: (path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${adminToken}`, ...body === undefined ? {} : { "Content-Type": "application/json" } }, ...body === undefined ? {} : { method: "POST", body: JSON.stringify(body) } }),
    subtitle: (playbackId: string) => fetch(`${hub.origin}/api/subtitles?playbackId=${playbackId}&name=subtitles.vtt`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/octet-stream" }, body: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello" }),
    close: async () => { await Promise.all(speakers.map(client => client.disconnect())); for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected device state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("pairing grants no output consent, even to admins; audio sharing excludes video and stops on revoke", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.admin.state.devices?.find(device => device.id === f.deviceId)?.sharing, defaultDeviceSharing);
    for (const action of [{ type: "volume", volume: 50, deviceId: f.deviceId }, { type: "enqueue", entry: { id: "blocked", title: "Blocked", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId }] satisfies Action[]) {
      assert.equal((await f.admin.command(action)).ok, false);
    }
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
    assert.equal((await f.device.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "shared", title: "Shared", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    assert.deepEqual(f.admin.state.outputs, [{ deviceId: f.deviceId, picture: false, sound: true, local: false }]);
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, picture: true })).ok, false);
    assert.equal((await f.device.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    await until(() => !f.device.state.outputs?.length);
    assert.ok(f.device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("explicit self playback works while private and a foreign playback ID cannot control it", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "private", title: "Private", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    const playbackId = f.device.state.player.playbackId!;
    assert.equal(f.device.state.outputs?.[0]?.local, true);
    assert.equal((await f.admin.command({ type: "pause", playbackId, paused: true })).ok, false);
    assert.equal((await f.admin.command({ type: "play", entryId: "private" })).ok, false);
    f.device.socket.send(JSON.stringify({ type: "player", state: { ...f.device.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
    await until(() => f.device.state.player.status === "playing");
    assert.equal((await f.subtitle(playbackId)).status, 403);
    assert.equal((await f.device.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    assert.equal((await f.device.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    assert.equal(f.device.state.outputs?.[0]?.sound, true);
    assert.equal(f.device.state.outputs?.[0]?.picture, true);
    assert.equal((await f.device.command({ type: "pause", playbackId, paused: true })).ok, true);
  } finally { await f.close(); }
});

test("a sharing device that disconnects keeps its output and resumes when it reconnects", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "shared", title: "Shared", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    f.device.socket.terminate();
    await until(() => f.admin.state.devices?.find(device => device.id === f.deviceId)?.online === false);
    assert.equal(f.admin.state.controlling, f.deviceId);
    assert.deepEqual(f.admin.state.outputs?.map(output => [output.deviceId, output.sound]), [[f.deviceId, true]]);
    const back = await f.connect(f.deviceToken, f.deviceId, "&audio=1");
    await until(() => back.messages.some(message => message.type === "player" && message.command.type === "load"));
    back.socket.terminate();
    await until(() => f.admin.state.devices?.find(device => device.id === f.deviceId)?.online === false);
    await f.connect(f.deviceToken, f.deviceId);
    await until(() => !f.admin.state.outputs?.length);
  } finally { await f.close(); }
});

test("a private self-join preserves shared group controls without granting direct output control", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let resolving = false;
  const source = createServer(() => { resolving = true; });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    const address = source.address(); assert.ok(address && typeof address === "object");
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.adminId })).ok, true);
    await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `http://127.0.0.1:${address.port}/media` } });
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 })).ok, true);
    await until(() => !!f.device.state.outputs?.find(output => output.deviceId === f.deviceId));
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.local, true);
    assert.ok(f.device.messages.some(message => message.type === "sendspin" && message.listen));
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: true });
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.admin.command({ type: "solo", deviceId: f.deviceId })).ok, false);
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.picture, true);
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, level: 40 })).ok, true);
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.picture, true);
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, picture: false })).ok, false);
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, level: 60, picture: false })).ok, false);
    assert.equal(f.admin.state.devices?.find(device => device.id === f.deviceId)?.volume, 40);
    await f.device.command({ type: "sharing", sharing: defaultDeviceSharing });
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: false });
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.sound, true);
    assert.equal((await f.admin.command({ type: "play", entryId: "waiting" })).ok, true);
    await until(() => resolving);
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.local, true);
    const playbackId = f.admin.state.player.playbackId!;
    assert.equal((await f.admin.command({ type: "pause", playbackId, paused: true })).ok, true);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } })).ok, true);
    for (const action of [
      { type: "volume", deviceId: f.deviceId, volume: 50 },
      { type: "output", deviceId: f.deviceId, level: 0 },
      { type: "output", deviceId: f.deviceId, picture: false },
      { type: "output", deviceId: f.deviceId, delay: 0 },
      { type: "solo", deviceId: f.deviceId },
    ] satisfies Action[]) assert.equal((await f.admin.command(action)).ok, false);
    const volume = f.admin.state.devices?.find(device => device.id === f.deviceId)?.volume;
    assert.equal((await f.admin.command({ type: "volume", volume: 30 })).ok, true);
    // All changes only the speakers the admin may control: the private Device keeps the level it plays at.
    const [adminLevels, deviceLevels] = await f.speakers();
    await until(() => adminLevels.at(-1) === 30 && deviceLevels.at(-1) === volume);
    assert.equal((await f.admin.command({ type: "allSpeakers", level: 0 })).ok, true);
    await until(() => adminLevels.at(-1) === 0);
    assert.equal(deviceLevels.at(-1), volume);
    assert.equal(f.admin.state.devices?.find(device => device.id === f.deviceId)?.volume, volume);
    assert.equal(f.admin.state.outputs?.find(output => output.deviceId === f.deviceId)?.sound, true);
    assert.equal((await f.admin.command({ type: "allSpeakers", level: 100 })).ok, true);
    await until(() => adminLevels.at(-1) === 30);
    assert.equal(deviceLevels.at(-1), volume);
    assert.equal((await f.admin.command({ type: "stop", playbackId })).ok, true);
  } finally { await f.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); }
});

test("joining shared audio from another playback cannot replace that device's private video", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.device.command({ type: "enqueue", entry: { id: "private", title: "Private", source: `${f.hub.origin}/api/health` } });
    const volume = f.device.state.devices?.find(device => device.id === f.deviceId)?.volume;
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "shared", title: "Shared", source: `${f.hub.origin}/api/health` } });
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, level: 40 })).ok, false);
    assert.equal(f.device.state.devices?.find(device => device.id === f.deviceId)?.volume, volume);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["private"]);
    assert.deepEqual(f.device.state.outputs, [{ deviceId: f.deviceId, picture: true, sound: true, local: true }]);
    await f.device.command({ type: "sharing", sharing: { audio: true, video: true } });
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, level: 40 })).ok, true);
    await until(() => f.device.state.queue.some(entry => entry.id === "shared"));
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), { deviceId: f.deviceId, picture: false, sound: true, local: false });
  } finally { await f.close(); }
});

test("Solo rechecks existing private channels after resolving the destination source", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let hold = false, release: (() => void) | undefined;
  const source = createServer((_request, response) => {
    const send = () => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("media"); };
    if (hold && !release) release = send; else send();
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    const address = source.address(); assert.ok(address && typeof address === "object");
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.device.command({ type: "enqueue", entry: { id: "private", title: "Private", source: `${f.hub.origin}/api/health` } });
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: false });
    await f.admin.command({ type: "enqueue", entry: { id: "moving", title: "Moving", source: `http://127.0.0.1:${address.port}/media` }, playNow: true });
    await until(() => f.admin.messages.some(message => message.type === "player" && message.command.type === "load"));
    const playbackId = f.admin.state.player.playbackId;
    f.admin.socket.send(JSON.stringify({ type: "player", state: { ...f.admin.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
    await until(() => f.admin.state.player.status === "playing");
    hold = true;
    const moving = f.admin.command({ type: "solo", deviceId: f.deviceId });
    await until(() => !!release);
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: true });
    release!();
    assert.equal((await moving).ok, false);
    assert.equal(f.admin.state.player.playbackId, playbackId);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["private"]);
    assert.deepEqual(f.device.state.outputs, [{ deviceId: f.deviceId, picture: true, sound: true, local: true }]);
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { await f.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); }
});

test("waiting queues with no outputs can be edited and played on an explicit local output", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `${f.hub.origin}/api/health` } })).ok, true);
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, picture: false, level: 0 })).ok, true);
    await until(() => !f.device.state.outputs?.length);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } })).ok, true);
    assert.equal((await f.admin.command({ type: "play", entryId: "waiting" })).ok, true);
    await until(() => f.admin.messages.some(message => message.type === "player" && message.command.type === "load"));
    assert.deepEqual(f.admin.state.outputs?.map(output => [output.deviceId, output.local]), [[f.adminId, true]]);
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { await f.close(); }
});

test("revoking consent while a source resolves prevents its late load from starting playback", { timeout: 15_000 }, async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  const source = createServer((_request, response) => {
    const send = () => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("media"); };
    if (release) send(); else release = send;
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    const address = source.address(); assert.ok(address && typeof address === "object");
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "pending", title: "Pending", source: `http://127.0.0.1:${address.port}/media` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => !!release);
    await f.device.command({ type: "sharing", sharing: defaultDeviceSharing });
    release!();
    await until(() => f.admin.state.playbacks?.some(playback => playback.status === "unavailable") === true);
    assert.match(f.admin.state.player.error ?? "", /Device is not sharing audio/);
    assert.deepEqual(f.admin.state.outputs, []);
    assert.deepEqual(f.admin.state.queue.map(entry => entry.id), ["pending"]);
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); await f.close(); }
});


// Hold the initial MIME/classification read after resolution, then use real WAV
// bytes and the adjacent scheduled worker to prove the current route can play.
async function heldAudio(invalid = false) {
  const frames = 6 * 48_000, wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(192_000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  let release: (() => void) | undefined, reads = 0, closed = false;
  const server = createServer((_request, response) => {
    const answer = () => {
      response.setHeader("Content-Type", invalid ? "application/vnd.apple.mpegurl" : "audio/wav");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end(invalid ? '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Unavailable",DEFAULT=YES,URI="file:///unavailable"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a"\n/picture.m3u8\n' : wav);
    };
    if (++reads === 1) { release = answer; response.once("close", () => { closed = true; }); } else answer();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { source: `http://127.0.0.1:${address.port}/audio.wav`, get held() { return !!release; }, get closed() { return closed; }, get reads() { return reads; }, release: () => { release?.(); release = undefined; },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test("initial source preparation follows accepted output edits and retains private picture authority", { timeout: 15_000 }, async () => {
  const f = await fixture(), audio = await heldAudio();
  try {
    await f.speakers();
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: audio.source } })).ok, true);
    assert.equal((await f.admin.command({ type: "output", deviceId: f.adminId, picture: false, level: 0 })).ok, true);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: audio.source }, playNow: true, deviceId: f.adminId })).ok, true);
    await until(() => audio.held);
    const playbackId = f.device.state.player.playbackId;
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 })).ok, true);
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, picture: true })).ok, true);
    assert.equal((await f.device.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    audio.release();
    await until(() => f.device.state.player.status === "playing" && f.heard(f.deviceId) > 0 && f.heard(f.adminId) > 0);
    assert.equal(f.device.state.player.playbackId, playbackId);
    assert.equal(f.device.state.player.error, null);
    assert.ok(f.device.messages.some(message => message.type === "player" && message.command.type === "load" && message.command.playbackId === playbackId));
    const own = f.device.state.outputs?.find(output => output.deviceId === f.deviceId);
    assert.equal(own?.picture, true); assert.equal(own.sound, true); assert.equal(own.local, true); assert.equal(own.error, undefined);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "taken", title: "Taken", source: audio.source }, playNow: true, deviceId: f.deviceId })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.equal((await f.admin.command({ type: "play", entryId: "waiting" })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["mix"]);
  } finally { await f.close(); await audio.close(); }
});


for (const ending of ["stop", "replace", "leave", "consent"] as const) test(`initial output preparation cannot revive an item after ${ending}`, { timeout: 15_000 }, async () => {
  const f = await fixture(), audio = await heldAudio();
  try {
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "pending", title: "Pending", source: audio.source }, playNow: true, deviceId: f.adminId })).ok, true);
    await until(() => audio.held);
    const playbackId = f.device.state.player.playbackId!;
    assert.equal((await f.device.command({ type: "output", deviceId: f.adminId, picture: false })).ok, true);
    if (ending === "stop") {
      assert.equal((await f.device.command({ type: "stop", playbackId })).ok, true);
      await until(() => audio.closed);
    } else if (ending === "replace") {
      assert.equal((await f.device.command({ type: "enqueue", entry: { id: "replacement", title: "Replacement", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
      await until(() => audio.closed && f.admin.messages.some(message => message.type === "player" && message.command.type === "load" && message.command.playbackId !== playbackId));
    } else if (ending === "leave") {
      assert.equal((await f.device.command({ type: "output", deviceId: f.adminId, level: 0 })).ok, true);
    } else {
      assert.equal((await f.admin.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    }
    audio.release();
    if (ending === "leave") await until(() => f.device.state.player.status === "error");
    if (ending === "consent") await until(() => f.device.state.player.status === "unavailable");
    assert.equal(f.admin.messages.some(message => message.type === "player" && message.command.type === "load" && message.command.playbackId === playbackId), false);
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load" && message.command.playbackId === playbackId), false);
    if (ending === "stop") assert.equal(f.device.state.currentEntryId, null);
    if (ending === "replace") { assert.equal(f.device.state.currentEntryId, "replacement"); assert.equal(f.device.state.player.error, null); }
    if (ending === "leave" || ending === "consent") assert.deepEqual(f.device.state.outputs, []);
    if (ending === "consent") assert.match(f.device.state.player.error ?? "", /Admin is not sharing audio/);
  } finally { await f.close(); await audio.close(); }
});

test("initial output preparation honors the current channel consent after a route edit", { timeout: 15_000 }, async () => {
  const f = await fixture(), audio = await heldAudio();
  try {
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "pending", title: "Pending", source: audio.source }, playNow: true, deviceId: f.adminId })).ok, true);
    await until(() => audio.held);
    const playbackId = f.device.state.player.playbackId;
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    audio.release();
    await until(() => f.admin.messages.some(message => message.type === "player" && message.command.type === "load"));
    const loads = f.admin.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
    assert.equal(loads.length, 1);
    assert.equal(loads[0]!.playbackId, playbackId);
    assert.deepEqual(loads[0]!.output, { picture: false, sound: true });
    assert.equal(f.device.state.player.error, null);
    assert.deepEqual(f.device.state.outputs, [{ deviceId: f.adminId, picture: false, sound: true, local: false }]);
    assert.equal((await f.device.command({ type: "output", deviceId: f.adminId, picture: true })).ok, false);
  } finally { await f.close(); await audio.close(); }
});


test("initial output edits do not retry or hide a genuine source preparation failure", { timeout: 15_000 }, async () => {
  const f = await fixture(), audio = await heldAudio(true);
  try {
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "broken", title: "Broken", source: audio.source }, playNow: true, deviceId: f.adminId })).ok, true);
    await until(() => audio.held);
    const playbackId = f.device.state.player.playbackId;
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 })).ok, true);
    audio.release();
    await until(() => f.device.state.player.status === "error");
    assert.equal(f.device.state.player.playbackId, playbackId);
    assert.match(f.device.state.player.error ?? "", /playlist contains an unsupported destination/);
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.error, f.device.state.player.error);
    assert.ok(audio.reads <= 3, "a source-selection failure must not enter the retired-output retry loop");
    assert.equal(f.admin.messages.some(message => message.type === "player" && message.command.type === "load"), false);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["broken"]);
  } finally { await f.close(); await audio.close(); }
});

for (const duringPreparation of [false, true]) test(`initial sound-only HLS selects its audio rendition${duringPreparation ? " after picture consent changes during preparation" : " before preparation"}`, { timeout: 15_000 }, async () => {
  const f = await fixture();
  let release: (() => void) | undefined, masters = 0, retry = 0;
  const requests: string[] = [];
  const source = createServer((request, response) => {
    requests.push(request.url!);
    if (request.method === "GET" && request.url === "/master.m3u8" && ++masters === 2) retry = requests.length - 1;
    const answer = () => {
      response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end(request.url === "/master.m3u8"
        ? '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Audio",DEFAULT=YES,URI="/audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a",CODECS="avc1.42e01e,mp4a.40.2"\n/picture.m3u8\n'
        : '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n/segment.ts\n#EXT-X-ENDLIST\n');
    };
    if (duringPreparation && requests.length === 1) release = answer; else answer();
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: duringPreparation } })).ok, true);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "selected", title: "Selected", source: `${origin}/master.m3u8` }, playNow: true, deviceId: f.adminId })).ok, true);
    const playbackId = f.device.state.player.playbackId;
    if (duringPreparation) {
      await until(() => !!release);
      assert.equal((await f.admin.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
      release!();
    }
    await until(() => f.admin.messages.some(message => message.type === "player" && message.command.type === "load"));
    const loads = f.admin.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
    assert.equal(loads.length, 1);
    assert.equal(loads[0]!.playbackId, playbackId);
    assert.deepEqual(loads[0]!.output, { picture: false, sound: true });
    assert.equal(loads[0]!.source, `${origin}/audio.m3u8`, "the current output channels must select the available audio rendition, independently of resolved coverage");
    assert.equal(f.device.state.player.error, null);
    if (duringPreparation) assert.ok(retry > 0, "the held full A/V attempt must have been replaced");
    assert.equal(requests.slice(retry).includes("/picture.m3u8"), false, "the sound-only attempt must not read a picture playlist");
    assert.deepEqual(f.device.state.outputs, [{ deviceId: f.adminId, picture: false, sound: true, local: false }]);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["selected"]);
  } finally { await f.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); }
});

test("Play from a controller cannot pull a device out of, or replace, its private picture", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const own = { deviceId: f.deviceId, picture: true, sound: true, local: true };
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `${f.hub.origin}/api/health` } });
    await f.admin.command({ type: "output", deviceId: f.adminId, picture: false, level: 0 });
    await f.device.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.adminId });
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 });
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: true });
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "taken", title: "Taken", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.equal((await f.admin.command({ type: "play", entryId: "waiting" })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["mix"]);
  } finally { await f.close(); }
});

test("Move here is refused, changing nothing, while a device that joined on its own plays privately", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.device.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.adminId });
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 });
    await until(() => f.admin.state.outputs?.length === 2);
    const outputs = f.admin.state.outputs;
    const only = await f.admin.command({ type: "solo", deviceId: f.adminId });
    assert.equal(only.ok, false);
    assert.equal(only.error, "Move here is unavailable while Device plays this privately.");
    assert.deepEqual(f.admin.state.outputs, outputs);
    assert.deepEqual(f.admin.state.outputs?.map(output => [output.deviceId, output.local]), [[f.adminId, false], [f.deviceId, true]]);
  } finally { await f.close(); }
});

test("turning Share on network off keeps what a device started on the host playing", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const hostId = "e".repeat(43), host = await f.connect("h".repeat(64), hostId);
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "shared", title: "Shared", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: hostId })).ok, true);
    await until(() => host.messages.some(message => message.type === "player" && message.command.type === "load"));
    const before = host.messages.length;
    const response = await fetch(`${f.hub.origin}/api/settings/sharing`, { method: "POST", headers: { Authorization: `Bearer ${"h".repeat(64)}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(response.status, 200);
    await until(() => host.state.outputs?.[0]?.local === true);
    assert.deepEqual(host.state.outputs, [{ deviceId: hostId, picture: true, sound: true, local: true }]);
    assert.equal(host.messages.slice(before).some(message => message.type === "player" && message.command.type === "stop"), false);
  } finally { await f.close(); }
});
