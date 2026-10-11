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

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-server-selection-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const phoneToken = store.pair(phoneId, "Phone"), speakerToken = store.pair(speakerId, "Speaker");
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
    rest: async (path: string, body?: unknown, token = phoneToken) => {
      const response = await fetch(`${hub.origin}${path}`, { method: body === undefined ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
    },
    entry: (id: string) => ({ id, title: id, source: `http://127.0.0.1:${address.port}/media` }),
    reconnect: async () => { phone.socket.close(); await until(() => phone.socket.readyState === WebSocket.CLOSED); return connect(phoneToken, phoneId); },
    reconnectSpeaker: () => connect(speakerToken, speakerId, "&audio=1&video=1"),
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
    await f.phone.command({ type: "enqueue", entry: f.entry("mix"), playNow: true, deviceId: speakerId });
    await f.phone.command({ type: "output", deviceId: hostId, level: 30 });
    await until(() => f.phone.state.controlling === speakerId && f.phone.state.outputs?.length === 2);
    const playback = f.phone.state.playback;
    const returned = await f.reconnect();
    assert.equal(returned.state.controlling, speakerId);
    assert.equal(returned.state.playback, playback);
    assert.deepEqual(returned.state.outputs?.map(output => output.deviceId), [speakerId, hostId]);
  } finally { await f.close(); }
});

test("reconnecting to a selection that went idle falls back to the server's default outputs", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("ended"), playNow: true, deviceId: speakerId });
    await f.phone.command({ type: "remove", entryId: "ended" });
    await until(() => !f.phone.state.playbacks?.length);
    assert.equal(f.phone.state.controlling, speakerId);
    assert.equal((await f.reconnect()).state.controlling, hostId);
  } finally { await f.close(); }
});

test("a controller back before its target stays on it, and Wi-Fi blips change no selection", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("mix"), playNow: true, deviceId: speakerId });
    const playback = f.phone.state.playback;
    f.speaker.socket.close(); await until(() => f.phone.state.devices?.find(device => device.id === speakerId)?.online === false);
    const returned = await f.reconnect();
    assert.equal(returned.state.controlling, speakerId);
    await f.reconnectSpeaker();
    await until(() => returned.state.devices?.find(device => device.id === speakerId)?.online === true);
    assert.equal(returned.state.controlling, speakerId);
    assert.equal(returned.state.playback, playback);
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
    // The host's own window follows its Device into the new Playback.
    assert.equal(f.host.state.controlling, hostId);
    await until(() => f.host.state.playback === f.phone.state.playback);
  } finally { await f.close(); }
});

test("REST Play on isolates its named output like the WebSocket path", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    const mix = f.phone.state.playback;
    const { item } = await f.rest("/api/for-later", { reference: { kind: "queue", id: "waiting" } });
    await f.rest(`/api/for-later/${item.id}/load?on=${hostId}`, { mode: "play" });
    await until(() => f.phone.state.playback !== mix);
    assert.equal(f.phone.state.controlling, hostId);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [hostId]);
    assert.deepEqual(f.phone.state.playbacks?.find(playback => playback.id === mix)?.outputs.map(output => output.deviceId), [speakerId]);
  } finally { await f.close(); }
});

test("a Play on whose item fails, now or after loading, leaves its target in the mix and the selection as it was", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    const mix = f.phone.state.playback;
    const failures = [
      () => f.phone.command({ type: "enqueueRadio", stationId: "missing", entryId: "radio", playNow: true, deviceId: speakerId }),
      // A provider list fails only once it has loaded.
      () => f.phone.command({ type: "enqueueProvider", provider: "bandcamp", url: "https://example.com/not-an-album", shape: "playlist", playNow: true, deviceId: speakerId }),
      () => f.rest(`/api/progress/media:${"0".repeat(64)}/play?on=${speakerId}`, { profileId: f.phone.state.activeProfile.id }),
    ];
    for (const failure of failures) {
      await assert.rejects(failure());
      assert.equal(f.phone.state.controlling, hostId);
      assert.equal(f.phone.state.playback, mix);
      assert.deepEqual(f.phone.state.playbacks?.map(playback => playback.outputs.map(output => output.deviceId)), [[hostId, speakerId]]);
    }
  } finally { await f.close(); }
});

test("playing a waiting Playback moves the whole selected mix to it", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    const waiting = f.phone.state.playback;
    await f.phone.command({ type: "output", deviceId: hostId, picture: false, level: 0 });
    await f.phone.command({ type: "enqueue", entry: f.entry("mix"), playNow: true });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.playback !== waiting && f.phone.state.outputs?.length === 2);
    await f.phone.command({ type: "play", entryId: "waiting" });
    await until(() => f.phone.state.playback === waiting);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [hostId, speakerId]);
    assert.equal(f.phone.state.playbacks?.filter(playback => playback.outputs.length).length, 1);
  } finally { await f.close(); }
});

test("a mix that ends leaves every controller on its own selection", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.phone.command({ type: "output", deviceId: speakerId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    await f.phone.command({ type: "remove", entryId: "waiting" });
    await until(() => !f.phone.state.playbacks?.length && !f.host.state.playbacks?.length);
    assert.equal(f.host.state.controlling, hostId);
    assert.equal(f.phone.state.controlling, hostId);
  } finally { await f.close(); }
});

test("Play falls back to the actor's own Device while the server's outputs are offline", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    f.host.socket.close(); await until(() => f.phone.state.devices?.find(device => device.id === hostId)?.online === false);
    await f.phone.command({ type: "enqueue", entry: f.entry("here"), playNow: true });
    await until(() => f.phone.state.currentEntryId === "here");
    assert.equal(f.phone.state.controlling, phoneId);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [phoneId]);
  } finally { await f.close(); }
});

test("explicit Play on cannot replace a target's private video while its audio is shared", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.speaker.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.phone.command({ type: "enqueue", entry: f.entry("waiting") });
    await f.speaker.command({ type: "output", deviceId: speakerId, picture: true, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2 && f.phone.state.outputs.some(output => output.deviceId === speakerId && output.picture && output.local));
    const mix = f.phone.state.playback;
    await assert.rejects(f.phone.command({ type: "enqueue", entry: f.entry("forbidden"), playNow: true, deviceId: speakerId }), /not sharing video/);
    assert.equal(f.phone.state.playback, mix);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [hostId, speakerId]);
    assert.equal(f.phone.state.outputs?.find(output => output.deviceId === speakerId)?.picture, true);
    await f.phone.command({ type: "volume", deviceId: speakerId, volume: 40 });
    await until(() => f.phone.state.devices?.find(device => device.id === speakerId)?.volume === 40);
    // The device itself can choose a new private playback without opting its screen into sharing.
    await f.speaker.command({ type: "enqueue", entry: f.entry("self"), playNow: true, deviceId: speakerId });
    await until(() => f.speaker.state.currentEntryId === "self");
    assert.notEqual(f.speaker.state.playback, mix);
    assert.deepEqual(f.speaker.state.outputs, [{ deviceId: speakerId, picture: true, sound: true, local: true }]);
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

for (const [how, end] of [
  ["withdrawing consent", (f: Awaited<ReturnType<typeof fixture>>) => f.speaker.command({ type: "sharing", sharing: { audio: false, video: false } })],
  ["unpairing", (f: Awaited<ReturnType<typeof fixture>>) => f.rest(`/api/devices/${speakerId}`, undefined, hostToken)],
] as const) test(`${how} moves a target's controllers to the rest of its mix`, { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: f.entry("mix"), playNow: true, deviceId: speakerId });
    await f.phone.command({ type: "output", deviceId: phoneId, level: 30 });
    await until(() => f.phone.state.outputs?.length === 2);
    const mix = f.phone.state.playback;
    await end(f);
    await until(() => f.phone.state.outputs?.length === 1);
    assert.equal(f.phone.state.controlling, phoneId);
    assert.equal(f.phone.state.playback, mix);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [phoneId]);
  } finally { await f.close(); }
});
