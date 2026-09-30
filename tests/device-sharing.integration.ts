import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { defaultDeviceSharing } from "../src/shared/device-sharing";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-sharing-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const adminId = "a".repeat(43), deviceId = "d".repeat(43);
  const adminToken = store.pair(adminId, "Admin"), deviceToken = store.pair(deviceId, "Device");
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
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
  return { hub, admin, device, adminId, deviceId, deviceToken, connect,
    api: (path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${adminToken}`, ...body === undefined ? {} : { "Content-Type": "application/json" } }, ...body === undefined ? {} : { method: "POST", body: JSON.stringify(body) } }),
    subtitle: (playbackId: string) => fetch(`${hub.origin}/api/subtitles?playbackId=${playbackId}&name=subtitles.vtt`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/octet-stream" }, body: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello" }),
    close: async () => { for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); },
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
    for (const action of [{ type: "control", deviceId: f.deviceId }, { type: "volume", volume: 50, deviceId: f.deviceId }, { type: "enqueue", entry: { id: "blocked", title: "Blocked", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId }] satisfies Action[]) {
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
    await f.admin.command({ type: "control", deviceId: f.adminId });
    await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `http://127.0.0.1:${address.port}/media` } });
    assert.equal((await f.device.command({ type: "control", deviceId: f.adminId })).ok, true);
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
    assert.equal((await f.admin.command({ type: "allSpeakers", level: 0 })).ok, true);
    assert.equal(f.admin.state.devices?.find(device => device.id === f.deviceId)?.volume, volume);
    assert.equal(f.admin.state.outputs?.find(output => output.deviceId === f.deviceId)?.sound, true);
    assert.equal((await f.admin.command({ type: "stop", playbackId })).ok, true);
  } finally { await f.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); }
});

test("joining shared audio from another playback cannot replace that device's private video", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.device.command({ type: "control", deviceId: f.deviceId });
    await f.admin.command({ type: "control", deviceId: f.adminId });
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
    await f.device.command({ type: "control", deviceId: f.deviceId });
    await f.admin.command({ type: "control", deviceId: f.adminId });
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
    await f.device.command({ type: "control", deviceId: f.deviceId });
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `${f.hub.origin}/api/health` } })).ok, true);
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, picture: false, level: 0 })).ok, true);
    await until(() => !f.device.state.outputs?.length);
    await f.admin.command({ type: "control", deviceId: f.adminId });
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
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); await f.close(); }
});

test("Play from a controller cannot pull a device out of, or replace, its private picture", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const own = { deviceId: f.deviceId, picture: true, sound: true, local: true };
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `${f.hub.origin}/api/health` } });
    await f.admin.command({ type: "output", deviceId: f.adminId, picture: false, level: 0 });
    await f.admin.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: `${f.hub.origin}/api/health` }, playNow: true });
    await f.device.command({ type: "control", deviceId: f.adminId });
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 });
    await f.device.command({ type: "output", deviceId: f.deviceId, picture: true });
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.admin.command({ type: "control", deviceId: f.deviceId })).ok, true);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "taken", title: "Taken", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.equal((await f.admin.command({ type: "play", entryId: "waiting" })).ok, false);
    assert.deepEqual(f.device.state.outputs?.find(output => output.deviceId === f.deviceId), own);
    assert.deepEqual(f.device.state.queue.map(entry => entry.id), ["mix"]);
  } finally { await f.close(); }
});

test("Solo keeps a device that joined on its own", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.admin.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "mix", title: "Mix", source: `${f.hub.origin}/api/health` } });
    await f.device.command({ type: "control", deviceId: f.adminId });
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 });
    await until(() => f.admin.state.outputs?.length === 2);
    assert.equal((await f.admin.command({ type: "solo", deviceId: f.adminId })).ok, true);
    assert.deepEqual(f.admin.state.outputs?.map(output => [output.deviceId, output.local]), [[f.adminId, true], [f.deviceId, true]]);
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
