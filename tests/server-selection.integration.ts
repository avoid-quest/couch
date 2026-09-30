import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

const hostId = "h".repeat(43), phoneId = "p".repeat(43), speakerId = "s".repeat(43), hostToken = "h".repeat(64);

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected server selection was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function fixture(savedTarget?: string) {
  const directory = mkdtempSync(join(tmpdir(), "couch-server-selection-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const phoneToken = store.pair(phoneId, "Phone"), speakerToken = store.pair(speakerId, "Speaker");
  if (savedTarget) store.saveDeviceTarget(phoneId, savedTarget);
  store.close();
  // Hold resolution until shutdown so routing tests never start a decoder or fetch external media.
  const source = createServer(() => {});
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  async function connect(token: string, id: string, sharing = "") {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${sharing}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, get state() { return state!; }, command: (action: Action) => new Promise<void>((resolve, reject) => {
      const requestId = String(++sequence);
      pending.set(requestId, message => message.ok ? resolve() : reject(new Error(message.error)));
      socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  }
  const host = await connect(hostToken, hostId), phone = await connect(phoneToken, phoneId), speaker = await connect(speakerToken, speakerId, "&audio=1&video=1");
  return { hub, host, phone, speaker,
    entry: (id: string) => ({ id, title: id, source: `http://127.0.0.1:${address.port}/media` }),
    reconnect: async () => { phone.socket.close(); await until(() => phone.socket.readyState === WebSocket.CLOSED); return connect(phoneToken, phoneId); },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await hub.close();
      source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("controllers start on server outputs and return to their selected live mix", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal(f.phone.state.controlling, hostId);
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await f.phone.command({ type: "control", deviceId: speakerId });
    await until(() => f.phone.state.controlling === speakerId && f.phone.state.outputs?.length === 2);
    const playback = f.phone.state.playback;
    const returned = await f.reconnect();
    assert.equal(returned.state.controlling, speakerId);
    assert.equal(returned.state.playback, playback);
    assert.deepEqual(returned.state.outputs?.map(output => output.deviceId), [hostId, speakerId]);
  } finally { await f.close(); }
});

test("reconnecting to an idle or restarted server falls back to its default outputs", { timeout: 15_000 }, async () => {
  const f = await fixture(speakerId);
  try {
    assert.equal(f.phone.state.controlling, hostId);
    await f.phone.command({ type: "control", deviceId: speakerId });
    await until(() => f.phone.state.controlling === speakerId);
    assert.equal((await f.reconnect()).state.controlling, hostId);
  } finally { await f.close(); }
});

test("ordinary Play keeps a mix and explicit Play on isolates only its named output", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    const mix = f.phone.state.playback;
    await f.phone.command({ type: "enqueue", entry: f.entry("ordinary"), playNow: true });
    await until(() => f.phone.state.currentEntryId === "ordinary");
    assert.equal(f.phone.state.playback, mix);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [hostId, speakerId]);
    await f.phone.command({ type: "enqueue", entry: f.entry("explicit"), playNow: true, deviceId: hostId });
    await until(() => f.phone.state.currentEntryId === "explicit");
    assert.equal(f.phone.state.controlling, hostId);
    assert.notEqual(f.phone.state.playback, mix);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [hostId]);
    assert.deepEqual(f.phone.state.playbacks?.find(playback => playback.id === mix)?.outputs.map(output => output.deviceId), [speakerId]);
    await until(() => f.host.state.controlling === speakerId);
    assert.equal(f.host.state.playback, mix);
  } finally { await f.close(); }
});

test("removing an output follows the remaining mix even while its controller is away", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    const mix = f.phone.state.playback;
    f.phone.socket.close(); await until(() => f.phone.socket.readyState === WebSocket.CLOSED);
    await f.host.command({ type: "output", deviceId: hostId, picture: false, level: 0 });
    const returned = await f.reconnect();
    assert.equal(returned.state.controlling, speakerId);
    assert.equal(returned.state.playback, mix);
    assert.deepEqual(returned.state.outputs?.map(output => output.deviceId), [speakerId]);
  } finally { await f.close(); }
});

test("saved target references survive restart, follow identity migration and disappear on revoke", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-server-target-store-")), path = join(directory, "couch.sqlite");
  let store = openStore(path, true);
  try {
    store.identify(null, hostId);
    const phone = store.pair(phoneId, "Phone"), speaker = store.pair(speakerId, "Speaker");
    store.saveDeviceTarget(phoneId, speakerId); store.saveDeviceTarget(speakerId, phoneId); store.saveDeviceTarget(hostId, speakerId);
    store.close(); store = openStore(path, true);
    assert.equal(store.deviceTarget(phoneId), speakerId);
    const renamed = "r".repeat(43), newHost = "n".repeat(43);
    assert.equal(store.identify(phone, renamed), true);
    assert.equal(store.deviceTarget(phoneId), null);
    assert.equal(store.deviceTarget(renamed), speakerId);
    assert.equal(store.deviceTarget(speakerId), renamed);
    store.saveDeviceTarget(speakerId, hostId);
    assert.equal(store.identify(null, newHost), true);
    assert.equal(store.deviceTarget(speakerId), newHost);
    assert.equal(store.deviceTarget(newHost), speakerId);
    assert.ok(store.deviceForToken(speaker));
    store.revokeDevice(speakerId);
    assert.deepEqual(store.deviceTargetOwners(), []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
