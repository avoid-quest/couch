import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createServer } from "node:http";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { applyUndo, undoPlan } from "../src/client/session/undo";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

// Remote tests exercise local Core only; source discovery must not depend on the Internet.
const fetchLocal = globalThis.fetch;
globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;

const hostId = "h".repeat(43), phoneId = "p".repeat(43), tvId = "t".repeat(43), hostToken = "h".repeat(64);
async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected Remote state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-remote-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const phoneToken = store.pair(phoneId, "Phone"), tvToken = store.pair(tvId, "Another Couch TV"); store.close();
  const source = createServer(() => {});
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  async function connect(token: string, id: string, flags = "") {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${flags}`, { headers: { Origin: hub.origin } }); sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (value: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage; messages.push(message);
        if (message.type === "text") socket.send(JSON.stringify({ type: "textResult", requestId: message.requestId, ok: true }));
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, messages, get state() { return state!; }, command: (action: Action, targetDeviceId?: string) => new Promise<Extract<ServerMessage, { type: "result" }>>((resolve, reject) => {
      const requestId = String(++sequence), timer = setTimeout(() => reject(new Error("No command result")), 1000);
      pending.set(requestId, result => { clearTimeout(timer); resolve(result); });
      socket.send(JSON.stringify({ type: "command", requestId, action, ...(targetDeviceId ? { targetDeviceId } : {}) }));
    }) };
  }
  const host = await connect(hostToken, hostId, "&tv=1"), phone = await connect(phoneToken, phoneId), tv = await connect(tvToken, tvId, "&tv=1&audio=1&video=1");
  return { hub, host, phone, tv, connect, phoneToken, tvToken, source: `http://127.0.0.1:${address.port}/media`, close: async () => { for (const socket of sockets) socket.terminate(); await hub.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); } };
}

test("Remote selects a joined TV without output consent and keeps target through idle reconnect", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    await until(() => f.phone.state.controlling === tvId);
    assert.deepEqual(f.phone.state.devices?.find(device => device.id === phoneId)?.sharing, { audio: false, video: false });
    assert.equal(f.phone.state.outputs?.some(output => output.deviceId === phoneId), false);
    assert.equal((await f.phone.command({ type: "navigate", key: "down", deviceId: tvId }, tvId)).ok, true);
    await until(() => f.tv.messages.some(message => message.type === "navigation" && message.key === "down"));
    // OK held on the Remote reaches the TV as "menu", which opens its focused item's menu; unknown keys don't.
    assert.equal((await f.phone.command({ type: "navigate", key: "menu", deviceId: tvId }, tvId)).ok, true);
    await until(() => f.tv.messages.some(message => message.type === "navigation" && message.key === "menu"));
    await assert.rejects(f.phone.command({ type: "navigate", key: "hold" as "menu", deviceId: tvId }, tvId), /No command result/);
    assert.equal(f.tv.messages.some(message => message.type === "navigation" && (message.key as string) === "hold"), false);
    assert.equal(f.host.messages.some(message => message.type === "navigation"), false);
    f.phone.socket.terminate(); await until(() => f.phone.socket.readyState === WebSocket.CLOSED);
    const returned = await f.connect(f.phoneToken, phoneId);
    assert.equal(returned.state.controlling, tvId);
    f.tv.socket.terminate(); await until(() => returned.state.devices?.find(device => device.id === tvId)?.online === false);
    assert.equal(returned.state.controlling, tvId);
    assert.equal((await returned.command({ type: "navigate", key: "down", deviceId: tvId }, tvId)).ok, false);
    await f.connect(f.tvToken, tvId, "&tv=1&audio=1&video=1");
    await until(() => returned.state.devices?.find(device => device.id === tvId)?.online === true);
    assert.equal(returned.state.controlling, tvId);
    assert.equal(returned.state.player.playbackId, null);
  } finally { await f.close(); }
});

test("Core binds text to current TV focus, enforces allowlist, consent and stale target guards", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    const focus = (field: string, token = "focus1") => f.tv.socket.send(JSON.stringify({ type: "textFocus", field: { kind: field, token, value: "" } }));
    focus("find");
    await until(() => f.phone.state.textField?.token === "focus1");
    const action = { type: "text", deviceId: tvId, token: "focus1", text: "Caffè 日本 🍋", submit: true } satisfies Action;
    assert.equal((await f.phone.command(action, tvId)).ok, true);
    await until(() => f.tv.messages.some(message => message.type === "text"));
    assert.equal((await f.phone.command({ ...action, text: "" }, tvId)).ok, true);
    f.tv.socket.send(JSON.stringify({ type: "textFocus", field: null }));
    await until(() => !f.phone.state.textField);
    assert.equal((await f.phone.command(action, tvId)).ok, false);
    // A controller cannot report the TV's focus, and unsupported admin/password kinds never become capabilities.
    f.phone.socket.send(JSON.stringify({ type: "textFocus", field: { kind: "find", token: "claimed", value: "" } }));
    focus("password", "denied"); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.phone.state.textField, null);
    focus("device-name", "name1");
    await until(() => f.phone.state.textField?.token === "name1");
    assert.equal((await f.phone.command({ ...action, token: "name1", text: "x".repeat(61) }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "control", deviceId: hostId })).ok, true);
    assert.equal((await f.phone.command({ ...action, token: "name1" }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "volume", deviceId: tvId, volume: 12 }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "stop" }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    await f.tv.command({ type: "sharing", sharing: { audio: false, video: false } });
    assert.equal((await f.phone.command({ ...action, token: "name1" }, tvId)).ok, false);
  } finally { await f.close(); }
});


test("Remote target binds playback and device commands without changing output selections", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    const entry = (id: string) => ({ id, title: id, source: f.source });
    assert.equal((await f.host.command({ type: "enqueue", entry: entry("host-item"), playNow: true })).ok, true);
    assert.equal((await f.tv.command({ type: "enqueue", entry: entry("tv-item"), playNow: true, deviceId: tvId })).ok, true);
    await until(() => !!f.tv.state.player.playbackId && !!f.host.state.player.playbackId);
    const tvPlayback = f.tv.state.player.playbackId!, hostPlayback = f.host.state.player.playbackId!;
    const outputs = f.tv.state.playbacks!.map(playback => ({ id: playback.id, outputs: playback.outputs }));
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    await until(() => f.phone.state.controlling === tvId);
    assert.equal(f.phone.state.player.playbackId, tvPlayback);
    assert.deepEqual(f.phone.state.playbacks!.map(playback => ({ id: playback.id, outputs: playback.outputs })), outputs);
    assert.equal((await f.phone.command({ type: "pause", playbackId: hostPlayback, paused: true }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "volume", deviceId: hostId, volume: 12 }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "volume", deviceId: tvId, volume: 37 }, tvId)).ok, true);
    await until(() => f.phone.state.devices?.find(device => device.id === tvId)?.volume === 37);
    assert.equal((await f.phone.command({ type: "play", entryId: "host-item" }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "control", deviceId: hostId })).ok, true);
    await until(() => f.phone.state.controlling === hostId);
    assert.equal(f.phone.state.player.playbackId, hostPlayback);
    assert.equal((await f.phone.command({ type: "stop", playbackId: tvPlayback }, hostId)).ok, false);
  } finally { await f.close(); }
});


test("a receiving device with no explicit target shows its own playback instead of the host's", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.host.command({ type: "enqueue", entry: { id: "host-item", title: "Host", source: f.source }, playNow: true });
    await f.tv.command({ type: "enqueue", entry: { id: "received-item", title: "Received", source: f.source }, playNow: true, deviceId: tvId });
    assert.equal((await f.tv.command({ type: "output", deviceId: phoneId, picture: true, level: 50 })).ok, true);
    await until(() => f.phone.state.playbacks?.some(playback => playback.outputs.some(output => output.deviceId === phoneId)) === true);
    assert.equal(f.phone.state.controlling, phoneId);
    assert.equal(f.phone.state.currentEntryId, "received-item");
    assert.equal(f.phone.state.playback, f.tv.state.playback);
    assert.deepEqual(f.phone.state.outputs, f.tv.state.outputs);
    assert.equal(f.host.state.currentEntryId, "host-item");
  } finally { await f.close(); }
});

for (const selection of ["Remote", "Play on"] as const) test(`receiving another playback does not replace an explicit ${selection} target`, { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "sharing", sharing: { audio: true, video: true } });
    if (selection === "Remote") assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    else assert.equal((await f.phone.command({ type: "enqueue", entry: { id: "chosen-item", title: "Chosen", source: f.source }, playNow: true, deviceId: tvId })).ok, true);
    await f.host.command({ type: "enqueue", entry: { id: "received-item", title: "Received", source: f.source }, playNow: true });
    assert.equal((await f.host.command({ type: "output", deviceId: phoneId, picture: true, level: 50 })).ok, true);
    await until(() => f.phone.state.playbacks?.some(playback => playback.outputs.some(output => output.deviceId === phoneId)) === true);
    assert.equal(f.phone.state.controlling, tvId);
    assert.equal(f.phone.state.currentEntryId, selection === "Remote" ? null : "chosen-item");
    assert.equal(f.phone.state.outputs?.some(output => output.deviceId === phoneId), false);
  } finally { await f.close(); }
});

test("moving the host playback leaves an implicit receiver looking at its separate playback", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.host.command({ type: "enqueue", entry: { id: "host-item", title: "Host", source: f.source }, playNow: true });
    await f.tv.command({ type: "enqueue", entry: { id: "received-item", title: "Received", source: f.source }, playNow: true, deviceId: phoneId });
    await until(() => f.phone.state.currentEntryId === "received-item");
    const received = f.phone.state.playback;
    f.host.socket.send(JSON.stringify({ type: "player", state: { ...f.host.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
    await until(() => f.host.state.player.status === "playing");
    assert.equal((await f.host.command({ type: "solo", deviceId: tvId })).ok, true);
    await until(() => f.phone.state.playbacks?.some(playback => playback.id !== received && playback.outputs.some(output => output.deviceId === tvId)) === true);
    assert.equal(f.host.state.controlling, tvId);
    assert.equal(f.phone.state.controlling, phoneId);
    assert.equal(f.phone.state.currentEntryId, "received-item");
    assert.equal(f.phone.state.playback, received);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [phoneId]);
  } finally { await f.close(); }
});

for (const departure of ["Solo", "output removal"] as const) test(`an implicit receiver follows its playback after ${departure}`, { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.host.command({ type: "enqueue", entry: { id: "host-item", title: "Host", source: f.source }, playNow: true });
    await f.tv.command({ type: "enqueue", entry: { id: "received-item", title: "Received", source: f.source }, playNow: true, deviceId: phoneId });
    await until(() => f.phone.state.currentEntryId === "received-item");
    assert.equal(f.phone.state.controlling, phoneId);
    const received = f.phone.state.playback;
    if (departure === "Solo") {
      f.phone.socket.send(JSON.stringify({ type: "player", state: { ...f.phone.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
      await until(() => f.phone.state.player.status === "playing");
      assert.equal((await f.phone.command({ type: "solo", deviceId: tvId })).ok, true);
    } else {
      assert.equal((await f.tv.command({ type: "output", deviceId: tvId, picture: true, level: 50 })).ok, true);
      assert.equal((await f.tv.command({ type: "output", deviceId: phoneId, picture: false, level: 0 })).ok, true);
    }
    await until(() => f.phone.state.playbacks?.some(playback => playback.id === received && playback.outputs.length === 1 && playback.outputs[0]?.deviceId === tvId) === true);
    assert.equal(f.phone.state.controlling, tvId);
    assert.equal(f.phone.state.currentEntryId, "received-item");
    assert.equal(f.phone.state.playback, received);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [tvId]);
    assert.equal(f.host.state.currentEntryId, "host-item");
  } finally { await f.close(); }
});

// #711 is a separate owner/base dependency; parent integration runs these with its final Stop Core.
const stopIntegration = { skip: process.env.COUCH_TEST_STOP !== "1", timeout: 20000 };
test("Remote Stop Undo stays on its TV across reconnect and rejects playback reassigned to the other TV", stopIntegration, async () => {
  const f = await fixture();
  try {
    const entry = (id: string) => ({ id, title: id, source: f.source });
    await f.host.command({ type: "enqueue", entry: entry("other-tv"), playNow: true });
    await f.phone.command({ type: "enqueue", entry: entry("chosen-tv"), playNow: true, deviceId: tvId });
    await f.phone.command({ type: "control", deviceId: tvId });
    await until(() => f.phone.state.currentEntryId === "chosen-tv");
    const before = f.phone.state;
    assert.equal((await f.phone.command({ type: "stop" }, tvId)).ok, true);
    await until(() => f.phone.state.currentEntryId === null);
    assert.deepEqual(f.phone.state.queue.map(entry => entry.id), ["chosen-tv"]);
    const plan = undoPlan({ type: "stop" }, before, f.phone.state);
    assert.ok(plan);
    await applyUndo(plan, async action => {
      const result = await f.phone.command(action, tvId);
      if (!result.ok) throw new Error(result.error);
    }, () => f.phone.state);
    assert.equal(f.phone.state.currentEntryId, "chosen-tv");
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [tvId]);
    assert.equal(f.host.state.currentEntryId, "other-tv");
    await f.phone.command({ type: "stop" }, tvId);
    f.tv.socket.terminate();
    await until(() => f.phone.state.devices?.find(device => device.id === tvId)?.online === false);
    assert.equal(f.phone.state.controlling, tvId);
    assert.equal((await f.phone.command({ type: "play", entryId: "chosen-tv" }, tvId)).ok, false);
    await f.connect(f.tvToken, tvId, "&tv=1&audio=1&video=1");
    await until(() => f.phone.state.devices?.find(device => device.id === tvId)?.online === true);
    assert.equal((await f.phone.command({ type: "play", entryId: "chosen-tv" }, tvId)).ok, true);
    await until(() => f.phone.state.currentEntryId === "chosen-tv");
    await f.phone.command({ type: "stop" }, tvId);
    await f.host.command({ type: "control", deviceId: tvId });
    assert.equal((await f.host.command({ type: "solo", deviceId: hostId })).ok, true);
    await until(() => !f.phone.state.queue.length);
    assert.equal(f.phone.state.controlling, tvId);
    assert.equal((await f.phone.command({ type: "play", entryId: "chosen-tv" }, tvId)).ok, false);
    assert.equal(f.phone.state.outputs?.length, 0);
  } finally { await f.close(); }
});

test("Remote retained queue expires without adopting another TV and revocation denies Undo", stopIntegration, async () => {
  const f = await fixture();
  try {
    const entry = (id: string) => ({ id, title: id, source: f.source });
    await f.host.command({ type: "enqueue", entry: entry("other-tv"), playNow: true });
    await f.phone.command({ type: "enqueue", entry: entry("chosen-tv"), playNow: true, deviceId: tvId });
    await f.phone.command({ type: "control", deviceId: tvId });
    await until(() => f.phone.state.currentEntryId === "chosen-tv");
    assert.equal((await f.phone.command({ type: "stop" }, tvId)).ok, true);
    assert.equal(f.phone.state.queue[0]?.id, "chosen-tv");
    await until(() => !f.phone.state.queue.length, 12000);
    assert.equal(f.phone.state.controlling, tvId);
    assert.equal(f.phone.state.playback, null);
    assert.equal(f.host.state.currentEntryId, "other-tv");
    assert.equal((await f.phone.command({ type: "play", entryId: "other-tv" }, tvId)).ok, false);
    await f.phone.command({ type: "enqueue", entry: entry("revoked-tv"), playNow: true, deviceId: tvId });
    await f.phone.command({ type: "control", deviceId: tvId });
    await f.phone.command({ type: "stop" }, tvId);
    assert.equal(f.phone.state.queue[0]?.id, "revoked-tv");
    await f.tv.command({ type: "sharing", sharing: { audio: false, video: false } });
    assert.equal((await f.phone.command({ type: "play", entryId: "revoked-tv" }, tvId)).ok, false);
    assert.equal(f.phone.state.controlling, tvId);
  } finally { await f.close(); }
});
