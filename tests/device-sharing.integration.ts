import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { defaultDeviceSharing } from "../src/shared/device-identity";
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
  return { hub, admin, device, adminId, deviceId,
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
    assert.equal((await f.device.command({ type: "sharing", sharing: { ...defaultDeviceSharing, audio: true } })).ok, true);
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "shared", title: "Shared", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    const load = f.device.messages.find(message => message.type === "player" && message.command.type === "load");
    assert.equal(load?.type === "player" && load.local, false);
    assert.deepEqual(load?.type === "player" && load.output, { picture: false, sound: true });
    assert.equal((await f.admin.command({ type: "output", deviceId: f.deviceId, picture: true })).ok, false);
    assert.equal((await f.device.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    await until(() => !f.device.state.outputs?.length);
    assert.ok(f.device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("explicit self playback works while private and a foreign playback ID cannot control it", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.device.command({ type: "enqueue", entry: { id: "private", title: "Private", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    const playbackId = f.device.state.player.playbackId!;
    assert.ok(f.device.messages.some(message => message.type === "player" && message.command.type === "load" && message.local));
    assert.equal((await f.admin.command({ type: "pause", playbackId, paused: true })).ok, false);
    assert.equal((await f.admin.command({ type: "play", entryId: "private" })).ok, false);
    f.device.socket.send(JSON.stringify({ type: "player", state: { ...f.device.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
    await until(() => f.device.state.player.status === "playing");
    assert.equal((await f.subtitle(playbackId)).status, 403);
    assert.equal((await f.device.command({ type: "sharing", sharing: { ...defaultDeviceSharing, audio: true, video: true } })).ok, true);
    assert.equal((await f.device.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    assert.equal(f.device.state.outputs?.[0]?.sound, true);
    assert.equal(f.device.state.outputs?.[0]?.picture, true);
    assert.equal((await f.device.command({ type: "pause", playbackId, paused: true })).ok, true);
  } finally { await f.close(); }
});

test("native administration requires its own opt-in and revocation cancels pending requests", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await (await f.api("/api/updates/targets")).json(), []);
    assert.equal((await f.api(`/api/updates?device=${f.deviceId}`)).status, 503);
    assert.equal((await f.device.command({ type: "sharing", sharing: { ...defaultDeviceSharing, audio: true, video: true } })).ok, true);
    assert.deepEqual(await (await f.api("/api/updates/targets")).json(), []);
    assert.equal((await f.device.command({ type: "sharing", sharing: { ...defaultDeviceSharing, administration: true }, updates: true })).ok, true);
    assert.equal((await (await f.api("/api/updates/targets")).json()).length, 1);
    const pending = f.api(`/api/updates?device=${f.deviceId}`);
    await until(() => f.device.messages.some(message => message.type === "updates"));
    assert.equal((await f.device.command({ type: "sharing", sharing: defaultDeviceSharing })).ok, true);
    assert.equal((await pending).status, 503);
    assert.deepEqual(await (await f.api("/api/updates/targets")).json(), []);
  } finally { await f.close(); }
});

test("joining your own mixer output needs no sharing permission and retains that explicit local choice", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.admin.command({ type: "sharing", sharing: { ...defaultDeviceSharing, audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: `${f.hub.origin}/api/health` } });
    assert.equal((await f.device.command({ type: "control", deviceId: f.adminId })).ok, true);
    assert.equal((await f.device.command({ type: "output", deviceId: f.deviceId, level: 25 })).ok, true);
    await until(() => !!f.device.state.outputs?.find(output => output.deviceId === f.deviceId));
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.local, true);
    assert.ok(f.device.messages.some(message => message.type === "sendspin" && message.listen && message.local));
    await f.device.command({ type: "sharing", sharing: defaultDeviceSharing });
    assert.equal(f.device.state.outputs?.find(output => output.deviceId === f.deviceId)?.sound, true);
    assert.equal((await f.admin.command({ type: "volume", deviceId: f.deviceId, volume: 50 })).ok, false);
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
    await f.device.command({ type: "sharing", sharing: { ...defaultDeviceSharing, audio: true } });
    const address = source.address(); assert.ok(address && typeof address === "object");
    assert.equal((await f.admin.command({ type: "enqueue", entry: { id: "pending", title: "Pending", source: `http://127.0.0.1:${address.port}/media` }, playNow: true, deviceId: f.deviceId })).ok, true);
    await until(() => !!release);
    await f.device.command({ type: "sharing", sharing: defaultDeviceSharing });
    release!();
    await until(() => f.admin.state.playbacks?.some(playback => playback.status === "unavailable") === true);
    assert.equal(f.device.messages.some(message => message.type === "player" && message.command.type === "load"), false);
  } finally { source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); await f.close(); }
});
