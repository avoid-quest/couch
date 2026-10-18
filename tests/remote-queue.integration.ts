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
import type { Action, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

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
  const source = createServer((_request, response) => response.end(""));
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  async function connect(token: string, id: string, flags = "") {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${flags}`, { headers: { Origin: hub.origin } }); sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (value: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, reported: PlayerState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage; messages.push(message);
        if (message.type === "text") socket.send(JSON.stringify({ type: "textResult", requestId: message.requestId, ok: true }));
        // Core/queue is real; this renderer reports deterministic load, seek and pause observations.
        if (message.type === "player") {
          const command = message.command;
          if (command.type === "load") reported = { playbackId: command.playbackId, status: command.paused ? "paused" : "playing", position: command.startPosition ?? 0, duration: 60,
            volume: 80, seekable: true, buffering: false, error: null, speed: 1, tracks: [], audioDelay: 0, subtitleDelay: 0 };
          else if (reported && command.type === "pause") reported = { ...reported, status: command.paused ? "paused" : "playing" };
          else if (reported && command.type === "seek") reported = { ...reported, position: command.position };
          if (reported && ["load", "pause", "seek"].includes(command.type)) socket.send(JSON.stringify({ type: "player", state: reported }));
        }
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
  return { hub, host, phone, tv, connect, phoneToken, tvToken, source: `http://127.0.0.1:${address.port}/media`, close: async () => { for (const socket of sockets) socket.terminate(); try { await hub.close(); } finally { source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); } } };
}

const entry = (id: string, source: string) => ({ id, title: id, source });
async function choose(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal((await f.phone.command({ type: "enqueue", entry: entry("chosen", f.source), playNow: true, deviceId: tvId })).ok, true);
  assert.equal((await f.phone.command({ type: "enqueue", entry: entry("waiting", f.source) })).ok, true);
  assert.equal((await f.phone.command({ type: "enqueue", entry: entry("later", f.source) })).ok, true);
  assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
  await until(() => f.phone.state.player.status === "playing");
}
const queueIds = (state: SessionState) => state.queue.map(entry => entry.id);

test("delayed Remote queue and transport commands cannot follow their entries to another TV, with or without an envelope", async () => {
  const f = await fixture();
  try {
    await choose(f);
    const playbackId = f.phone.state.player.playbackId!;
    const captured: Action[] = [
      { type: "remove", entryId: "waiting" }, { type: "move", entryId: "waiting", beforeEntryId: null },
      { type: "play", entryId: "waiting" }, { type: "play", entryId: "chosen", fromStart: true },
      { type: "pause", playbackId, paused: false }, { type: "seek", playbackId, position: 30 },
      { type: "next", playbackId }, { type: "stop", playbackId }, { type: "stop" },
    ];
    assert.equal((await f.phone.command({ type: "solo", deviceId: hostId })).ok, true);
    await until(() => f.host.state.player.status === "playing");
    for (const target of [undefined, tvId]) for (const action of captured) {
      const result = await f.phone.command(action, target);
      assert.equal(result.ok, false, `${action.type} crossed TVs (${target ? "guarded" : "legacy"})`);
      assert.deepEqual(queueIds(f.host.state), ["chosen", "waiting", "later"]);
      assert.equal(f.host.state.currentEntryId, "chosen");
    }
    assert.equal(f.phone.state.controlling, tvId);
    assert.deepEqual(queueIds(f.phone.state), []);
  } finally { await f.close(); }
});

test("selected Remote queue supports reorder, remove Undo, play and Stop Undo without changing the other TV", async () => {
  const f = await fixture();
  try {
    await f.host.command({ type: "enqueue", entry: entry("other", f.source), playNow: true });
    await choose(f);
    assert.equal((await f.phone.command({ type: "move", entryId: "later", beforeEntryId: "waiting" }, tvId)).ok, true);
    assert.deepEqual(queueIds(f.phone.state), ["chosen", "later", "waiting"]);
    const before = f.phone.state;
    assert.equal((await f.phone.command({ type: "remove", entryId: "later" }, tvId)).ok, true);
    const removed = undoPlan({ type: "remove", entryId: "later" }, before, f.phone.state);
    assert.ok(removed);
    const command = async (action: Action) => { const result = await f.phone.command(action, tvId); if (!result.ok) throw new Error(result.error); };
    await applyUndo(removed, command, () => f.phone.state);
    assert.deepEqual(queueIds(f.phone.state), ["chosen", "later", "waiting"]);
    await command({ type: "play", entryId: "later" });
    await until(() => f.phone.state.player.status === "playing");
    await command({ type: "seek", playbackId: f.phone.state.player.playbackId!, position: 12 });
    await command({ type: "pause", playbackId: f.phone.state.player.playbackId!, paused: true });
    await until(() => f.phone.state.player.status === "paused");
    const playing = f.phone.state;
    await command({ type: "stop", playbackId: playing.player.playbackId! });
    const stopped = undoPlan({ type: "stop" }, playing, f.phone.state);
    assert.ok(stopped);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [tvId]);
    await applyUndo(stopped, command, () => f.phone.state);
    assert.equal(f.phone.state.currentEntryId, "later");
    await until(() => f.phone.state.player.status === "paused" && f.phone.state.player.position === 12);
    await command({ type: "pause", playbackId: f.phone.state.player.playbackId!, paused: false });
    await until(() => f.phone.state.player.status === "playing");
    assert.equal(f.host.state.currentEntryId, "other");
    assert.deepEqual(f.phone.state.devices?.find(device => device.id === phoneId)?.sharing, { audio: false, video: false });
    assert.equal(f.phone.state.outputs?.some(output => output.deviceId === phoneId), false);
  } finally { await f.close(); }
});

test("captured queue/Undo actions reject a target switch, offline TV and revoked sharing; reconnect restores only the same TV", async () => {
  const f = await fixture();
  try {
    await f.host.command({ type: "enqueue", entry: entry("other", f.source), playNow: true });
    await choose(f);
    const before = f.phone.state;
    await f.phone.command({ type: "remove", entryId: "waiting" }, tvId);
    const plan = undoPlan({ type: "remove", entryId: "waiting" }, before, f.phone.state);
    assert.ok(plan?.removed);
    const actions: Action[] = [{ type: "restoreRemoved", token: plan.removed.token }, { type: "move", entryId: "later", beforeEntryId: null }, { type: "play", entryId: "chosen" }, { type: "stop" }];
    await f.phone.command({ type: "control", deviceId: hostId });
    for (const action of actions) assert.equal((await f.phone.command(action, tvId)).ok, false, `${action.type} after target switch`);
    await f.phone.command({ type: "control", deviceId: tvId });
    f.tv.socket.terminate();
    await until(() => f.phone.state.devices?.find(device => device.id === tvId)?.online === false);
    for (const action of actions) assert.equal((await f.phone.command(action, tvId)).ok, false, `${action.type} offline`);
    const returned = await f.connect(f.tvToken, tvId, "&tv=1&audio=1&video=1");
    await until(() => f.phone.state.devices?.find(device => device.id === tvId)?.online === true);
    assert.equal((await f.phone.command(actions[0]!, tvId)).ok, true);
    assert.deepEqual(queueIds(f.phone.state), ["chosen", "waiting", "later"]);
    await returned.command({ type: "sharing", sharing: { audio: false, video: false } });
    for (const action of actions) assert.equal((await f.phone.command(action, tvId)).ok, false, `${action.type} revoked`);
    assert.equal(f.phone.state.controlling, tvId);
    assert.deepEqual(queueIds(f.host.state), ["other"]);
  } finally { await f.close(); }
});

test("Stop's real ten-second reservation expires without Remote adopting an idle or another TV's queue", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.host.command({ type: "enqueue", entry: entry("other", f.source), playNow: true });
    await choose(f);
    // A saved queue with waiting items stays available by design. Exhaust it to exercise
    // the Stop-only reservation rather than the ordinary saved-queue lifetime.
    await f.phone.command({ type: "remove", entryId: "waiting" }, tvId);
    await f.phone.command({ type: "remove", entryId: "later" }, tvId);
    await f.phone.command({ type: "stop" }, tvId);
    const retained = f.phone.state.playback, started = Date.now();
    assert.ok(retained);
    assert.deepEqual(f.phone.state.outputs?.map(output => output.deviceId), [tvId]);
    await until(() => !f.phone.state.playback, 12000);
    assert.ok(Date.now() - started >= 9500, "reservation expired too early");
    assert.equal(f.phone.state.controlling, tvId);
    assert.deepEqual(queueIds(f.phone.state), []);
    assert.equal((await f.phone.command({ type: "play", entryId: "chosen" }, tvId)).ok, false);
    assert.equal((await f.phone.command({ type: "play", entryId: "other" }, tvId)).ok, false);
    assert.equal(f.host.state.currentEntryId, "other");
  } finally { await f.close(); }
});

test("ordinary non-Remote queue control still follows a deliberate move and permits remove/Undo/play", async () => {
  const f = await fixture();
  try {
    await f.phone.command({ type: "enqueue", entry: entry("ordinary", f.source), playNow: true });
    await f.phone.command({ type: "enqueue", entry: entry("waiting", f.source) });
    await until(() => f.phone.state.player.status === "playing");
    await f.phone.command({ type: "solo", deviceId: tvId });
    await until(() => f.phone.state.controlling === tvId && f.phone.state.player.status === "playing");
    const before = f.phone.state;
    assert.equal((await f.phone.command({ type: "remove", entryId: "waiting" })).ok, true);
    const plan = undoPlan({ type: "remove", entryId: "waiting" }, before, f.phone.state);
    assert.ok(plan);
    await applyUndo(plan, async action => { const result = await f.phone.command(action); assert.equal(result.ok, true); }, () => f.phone.state);
    assert.equal((await f.phone.command({ type: "play", entryId: "waiting" })).ok, true);
    assert.equal(f.phone.state.currentEntryId, "waiting");
  } finally { await f.close(); }
});

test("a Remove Undo token and Stop Undo captured on B never restore or restart a reassigned sequence on A", async () => {
  const f = await fixture();
  try {
    await choose(f);
    const beforeRemove = f.phone.state;
    await f.phone.command({ type: "remove", entryId: "waiting" }, tvId);
    const removed = undoPlan({ type: "remove", entryId: "waiting" }, beforeRemove, f.phone.state);
    assert.ok(removed?.removed);
    const beforeStop = f.phone.state;
    await f.phone.command({ type: "stop" }, tvId);
    const stopped = undoPlan({ type: "stop" }, beforeStop, f.phone.state);
    assert.ok(stopped);
    assert.equal((await f.phone.command({ type: "solo", deviceId: hostId })).ok, true);
    await until(() => f.host.state.queue.some(entry => entry.id === "chosen"));
    const afterMove = queueIds(f.host.state);
    for (const target of [undefined, tvId]) {
      assert.equal((await f.phone.command({ type: "restoreRemoved", token: removed.removed.token }, target)).ok, false);
      assert.equal((await f.phone.command({ type: "play", entryId: stopped.resume!.entryId }, target)).ok, false);
    }
    assert.deepEqual(queueIds(f.host.state), afterMove);
    assert.equal(f.host.state.currentEntryId, null);
    assert.equal(f.phone.state.controlling, tvId);
  } finally { await f.close(); }
});

test("new queue additions use the selected idle TV and ordinary explicit Play on can change that choice", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    assert.equal((await f.phone.command({ type: "enqueue", entry: entry("idle-added", f.source) })).ok, true);
    assert.deepEqual(queueIds(f.phone.state), ["idle-added"]);
    assert.equal(f.phone.state.controlling, tvId);
    assert.deepEqual(queueIds(f.host.state), []);
    assert.equal((await f.phone.command({ type: "enqueue", entry: entry("explicit", f.source), playNow: true, deviceId: hostId })).ok, true);
    await until(() => f.phone.state.controlling === hostId && f.phone.state.currentEntryId === "explicit");
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    assert.deepEqual(queueIds(f.phone.state), ["idle-added"]);
  } finally { await f.close(); }
});

test("another device's play and queue reach the TV as its activity, sent before Core clears it", async () => {
  const f = await fixture();
  try {
    await choose(f);
    const activity = () => f.tv.messages.flatMap(message => message.type === "state" && message.state.activity ? [message.state.activity.text] : []);
    await until(() => activity().includes("Phone played chosen") && activity().includes("Phone queued waiting"));
  } finally { await f.close(); }
});
