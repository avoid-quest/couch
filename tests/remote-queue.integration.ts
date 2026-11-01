import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createServer } from "node:http";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { undoPlan } from "../src/client/session/undo";
import type { Action, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";
import type { SavedPlaylist } from "../src/shared/playlists";

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

for (const target of [undefined, tvId]) test(`Remote plays the selected TV's Autoplay picks without admitting queue edits or stale targets (${target ? "guarded" : "legacy"})`, async () => {
  const f = await fixture();
  const api = (path: string, body: unknown) => fetchLocal(`${f.hub.origin}/api/playlists${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${f.phoneToken}`, Origin: f.hub.origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    await f.host.command({ type: "enqueue", entry: entry("other", f.source), playNow: true });
    await choose(f);
    const saved = await api("", { name: "TV collection" });
    assert.equal(saved.status, 201);
    const { playlist } = await saved.json() as { playlist: SavedPlaylist };
    assert.equal((await api(`/${playlist.id}/load?on=${tvId}`, { mode: "play", revision: playlist.revision })).status, 200);
    await until(() => f.phone.state.autoplay?.upcoming.length === 2);
    const [first, second] = f.phone.state.autoplay!.upcoming;
    assert.equal(f.phone.state.queue.some(item => item.id === second!.id), false);
    for (const action of [{ type: "remove", entryId: first!.id }, { type: "move", entryId: first!.id, beforeEntryId: null }] as const) {
      assert.equal((await f.phone.command(action, tvId)).ok, false, "Autoplay picks are not queue-edit targets");
    }
    await f.phone.command({ type: "control", deviceId: hostId });
    assert.equal((await f.phone.command({ type: "play", entryId: second!.id }, tvId)).ok, false, "A stale target must still reject Play");
    await f.phone.command({ type: "control", deviceId: tvId });
    const profileId = f.phone.state.activeProfile.id;
    await f.phone.command({ type: "preferences", profileId, preferences: { autoplay: false } });
    assert.equal((await f.phone.command({ type: "play", entryId: second!.id }, target)).ok, false, "Disabled Autoplay must reject Play");
    await f.phone.command({ type: "preferences", profileId, preferences: { autoplay: true } });
    const result = await f.phone.command({ type: "play", entryId: second!.id }, target);
    assert.equal(result.ok, true, result.error ?? "");
    await until(() => f.phone.state.currentEntryId === second!.id && f.phone.state.player.status === "playing");
    assert.equal(f.tv.state.currentEntryId, second!.id);
    assert.equal(f.host.state.currentEntryId, "other");
    assert.deepEqual(queueIds(f.host.state), ["other"]);
    assert.deepEqual(f.phone.state.autoplay?.upcoming, []);
    assert.equal((await f.phone.command({ type: "play", entryId: first!.id }, target)).ok, false, "A consumed suggestion must reject Play");
  } finally { await f.close(); }
});

test("saved lists capture the caller's selected Up next and reject stale replacements after remote advance", async () => {
  const f = await fixture();
  const api = (token: string, path: string, body?: unknown) => fetchLocal(`${f.hub.origin}/api/playlists${path}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: f.hub.origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const save = async (token: string, name: string, expected: string[]) => {
    const response = await api(token, "", { name, scope: "upNext" });
    assert.equal(response.status, 201);
    const { playlist } = await response.json() as { playlist: SavedPlaylist };
    assert.deepEqual(playlist.entries.map(entry => entry.id), expected);
    return playlist;
  };
  try {
    await f.host.command({ type: "enqueue", entry: entry("host-current", f.source), playNow: true });
    await f.host.command({ type: "enqueue", entry: entry("host-next", f.source) });
    await choose(f);
    await save(hostToken, "Host", ["host-next"]);
    assert.equal((await f.phone.command({ type: "control", deviceId: hostId })).ok, true);
    await save(f.phoneToken, "Phone looking at host", ["host-next"]);
    await save(f.tvToken, "TV looking at itself", ["waiting", "later"]);
    assert.equal((await f.phone.command({ type: "control", deviceId: tvId })).ok, true);
    let playlist = await save(f.phoneToken, "Phone", ["waiting", "later"]);
    const update = { revision: playlist.revision, operation: "saveQueue", scope: "upNext" };
    // Another Device advances while the controller's confirmation is open.
    assert.equal((await f.tv.command({ type: "play", entryId: "waiting" })).ok, true);
    await until(() => f.phone.state.currentEntryId === "waiting");
    const replaced = await api(f.phoneToken, `/${playlist.id}`, update);
    assert.equal(replaced.status, 200);
    ({ playlist } = await replaced.json() as { playlist: SavedPlaylist });
    assert.deepEqual(playlist.entries.map(entry => entry.id), ["later"]);
    assert.equal((await api(f.phoneToken, `/${playlist.id}`, update)).status, 409);
    assert.equal((await f.tv.command({ type: "stop" })).ok, true);
    await until(() => f.phone.state.currentEntryId === null && f.phone.state.queueCursorEntryId === "waiting");
    await save(f.phoneToken, "Stopped", ["later"]);
    const whole = await api(f.phoneToken, "", { name: "Unscoped" });
    assert.equal(whole.status, 201);
    const wholeList = (await whole.json() as { playlist: SavedPlaylist }).playlist;
    assert.deepEqual(wholeList.entries.map(entry => entry.id), ["chosen", "waiting", "later"]);
    assert.equal((await f.tv.command({ type: "play", entryId: "later" })).ok, true);
    await until(() => f.phone.state.currentEntryId === "later");
    const exhausted = { ...update, revision: playlist.revision };
    assert.equal((await api(f.phoneToken, `/${playlist.id}`, exhausted)).status, 400);
    assert.equal((await api(f.phoneToken, "", { name: "Empty", scope: "upNext" })).status, 400);
    assert.equal((await api("invalid", `/${playlist.id}`, exhausted)).status, 401);
    assert.deepEqual((await (await api(f.phoneToken, `/${playlist.id}`)).json() as { playlist: SavedPlaylist }).playlist, playlist);
    assert.equal(f.host.state.currentEntryId, "host-current");
    assert.deepEqual(queueIds(f.host.state), ["host-current", "host-next"]);
    const revoke = await fetchLocal(`${f.hub.origin}/api/devices/${phoneId}`, { method: "DELETE", headers: { Authorization: `Bearer ${hostToken}`, Origin: f.hub.origin } });
    assert.equal(revoke.status, 200);
    assert.equal((await api(f.phoneToken, `/${playlist.id}`, exhausted)).status, 401);
    assert.deepEqual((await (await api(hostToken, `/${playlist.id}`)).json() as { playlist: SavedPlaylist }).playlist, playlist);
  } finally { await f.close(); }
});

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
