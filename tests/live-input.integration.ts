import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";
import { Identity } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { playbackMediaId } from "../src/server/progress";
import { parseLiveSignal } from "../src/server/validation";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected live state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-live-input-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const identities = ["Publisher", "Receiver", "Other"].map(name => { const id = Identity.generate().peerId; return { id, token: store.pair(id, name) }; });
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  async function connect(index: number, sharing = "") {
    const identity = identities[index]!;
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}${sharing}`, { headers: { Origin: hub.origin } });
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
    return { socket, messages, id: identity.id, get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }), load: () => messages.findLast(message => message.type === "player" && message.command.type === "load") as Extract<ServerMessage, { type: "player" }> | undefined };
  }
  const publisher = await connect(0), receiver = await connect(1);
  return { hub, publisher, receiver, connect, databasePath,
    api: (path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${identities[0]!.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }),
    close: async () => { for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("live publishing requires selected output consent and only its exact peer can signal", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.publisher.command({ type: "publishLive", sourceId: "screen", kind: "screen", audio: true, video: true })).ok, true);
    assert.equal(f.publisher.state.playbacks?.length, 0, "publishing does not monitor the source");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, false);
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => f.receiver.load()?.command.type === "load");
    const load = f.receiver.load()!.command;
    assert.equal(load.type, "load");
    if (load.type !== "load") return;
    assert.equal(load.liveSourceId, "screen");
    assert.deepEqual(load.liveOutput, { picture: false, sound: true, volume: f.publisher.state.devices?.find(device => device.id === f.receiver.id)?.volume });
    assert.equal(f.receiver.messages.some(message => message.type === "sendspin" && message.listen), false);
    for (const action of [{ type: "pause", playbackId: load.playbackId, paused: true }, { type: "seek", playbackId: load.playbackId, position: 5 }, { type: "speed", playbackId: load.playbackId, speed: 2 }] satisfies Action[]) assert.equal((await f.publisher.command(action)).ok, false);
    const signal = { type: "liveSignal", peerId: load.livePeerId, signal: { description: { type: "offer", sdp: "v=0\r\n" } } };
    f.publisher.socket.send(JSON.stringify(signal));
    await until(() => f.receiver.messages.some(message => message.type === "liveSignal" && message.peerId === load.livePeerId));
    assert.equal((await f.receiver.command({ type: "endLive", sourceId: "screen" })).ok, false);
    const outsider = await f.connect(2);
    const before = f.receiver.messages.filter(message => message.type === "liveSignal").length;
    const closed = new Promise<number>(resolve => outsider.socket.once("close", code => resolve(code)));
    outsider.socket.send(JSON.stringify(signal));
    assert.equal(await closed, 1008);
    assert.equal(f.receiver.messages.filter(message => message.type === "liveSignal").length, before);
    await f.receiver.command({ type: "sharing", sharing: { audio: false, video: false } });
    await until(() => f.receiver.messages.some(message => message.type === "player" && message.command.type === "stop"));
    f.publisher.socket.send(JSON.stringify(signal));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.receiver.messages.filter(message => message.type === "liveSignal").length, before);
    assert.equal(f.publisher.state.liveSources?.length, 1);
    const saved = openStore(f.databasePath, true);
    try { assert.deepEqual(saved.playbackIds(), []); } finally { saved.close(); }
  } finally { await f.close(); }
});

test("live receivers join at the edge, hand over tabs, and close without ending capture", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.publisher.command({ type: "publishLive", sourceId: "mic", kind: "microphone", audio: true, video: false });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const first = f.receiver.load()!.command; assert.equal(first.type, "load");
    if (first.type !== "load") return;
    const newer = await f.connect(1, "&audio=1");
    await until(() => !!newer.load());
    const second = newer.load()!.command; assert.equal(second.type, "load");
    if (second.type !== "load") return;
    assert.notEqual(second.livePeerId, first.livePeerId);
    assert.equal(second.startPosition, undefined);
    await until(() => f.receiver.messages.some(message => message.type === "player" && message.command.type === "stop"));
    const late = await f.connect(2, "&audio=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: late.id, level: 50 })).ok, true);
    await until(() => !!late.load());
    assert.equal(f.publisher.state.outputs?.length, 2);
    newer.socket.terminate();
    await until(() => f.receiver.messages.filter(message => message.type === "player" && message.command.type === "load").length > 1);
    assert.equal(f.publisher.state.liveSources?.length, 1);
    const current = f.publisher.state.player.playbackId!;
    await f.publisher.command({ type: "stop", playbackId: current });
    assert.equal(f.publisher.state.liveSources?.length, 1, "Stop playback leaves the owned source running");
    await f.publisher.command({ type: "endLive", sourceId: "mic" });
    await until(() => !f.publisher.state.liveSources?.length && !f.publisher.state.playbacks?.length);
  } finally { await f.close(); }
});

test("switching live to normal media preserves capture and cannot be stopped by retired signaling", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.publisher.command({ type: "publishLive", sourceId: "system", kind: "system-audio", audio: true, video: false });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "system", deviceId: f.publisher.id })).ok, false, "system audio cannot recapture its own playback");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "system", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const old = f.receiver.load()!.command; assert.equal(old.type, "load");
    if (old.type !== "load") return;
    const entry = { id: "normal", title: "Normal media", source: `${f.hub.origin}/api/health` };
    assert.equal((await f.publisher.command({ type: "enqueue", entry, playNow: true })).ok, true);
    await until(() => { const next = f.receiver.load()?.command; return next?.type === "load" && next.source === entry.source; });
    const next = f.receiver.load()!.command; assert.equal(next.type, "load");
    if (next.type !== "load") return;
    assert.equal(next.liveSourceId, undefined);
    assert.equal(f.publisher.state.liveSources?.length, 1);
    assert.deepEqual(f.publisher.state.outputs?.map(output => output.deviceId), [f.receiver.id]);
    const stopCount = f.receiver.messages.filter(message => message.type === "player" && message.command.type === "stop").length;
    f.publisher.socket.send(JSON.stringify({ type: "liveSignal", peerId: old.livePeerId, signal: { candidate: null } }));
    await f.publisher.command({ type: "endLive", sourceId: "system" });
    assert.equal(f.receiver.messages.filter(message => message.type === "player" && message.command.type === "stop").length, stopCount);
    f.receiver.socket.send(JSON.stringify({ type: "player", state: { ...f.publisher.state.player, playbackId: next.playbackId, status: "playing", buffering: false, speed: 1, duration: 20, position: 3, seekable: true } }));
    await until(() => f.publisher.state.player.status === "playing");
    const saved = openStore(f.databasePath, true);
    try {
      const queues = saved.playbackIds().flatMap(id => saved.playback(id).queue);
      assert.deepEqual(queues.map(item => item.id), ["normal"]);
      assert.ok(saved.sharedProgress(playbackMediaId(entry)!));
    } finally { saved.close(); }
  } finally { await f.close(); }
});

test("publisher disconnect ends its publication and all receiving peers", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.publisher.command({ type: "publishLive", sourceId: "mic", kind: "microphone", audio: true, video: false });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.publisher.socket.terminate();
    await until(() => !f.receiver.state.liveSources?.length && !f.receiver.state.playbacks?.length);
    assert.ok(f.receiver.messages.some(message => message.type === "player" && message.command.type === "stop"));
  } finally { await f.close(); }
});

test("live entries cannot be saved for later or receive a catalog queue", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.publisher.command({ type: "publishLive", sourceId: "mic", kind: "microphone", audio: true, video: false });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const sourceEntry = f.publisher.state.currentEntryId;
    const rejected = await f.api("/api/for-later", { reference: { kind: "queue", id: sourceEntry } });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json() as { error: string }).error, /Live inputs cannot be saved/);
    const saved = await f.api("/api/for-later", { reference: { kind: "web", url: `${f.hub.origin}/api/health`, title: "Normal media" } });
    assert.equal(saved.status, 201);
    const { item } = await saved.json() as { item: { id: string } };
    const queued = await f.api(`/api/for-later/${item.id}/load`, { mode: "append" });
    assert.equal(queued.status, 400);
    assert.match((await queued.json() as { error: string }).error, /live source has no saved queue/i);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), [sourceEntry]);
    assert.equal(f.publisher.state.liveSources?.length, 1);
    const stored = openStore(f.databasePath, true);
    try { assert.deepEqual(stored.playbackIds(), []); } finally { stored.close(); }
  } finally { await f.close(); }
});

test("ordinary Play after a live group establishes normal synced routing for the preserved mix", { timeout: 15_000 }, async () => {
  const f = await fixture();
  // Hold URL resolution: the routing transition must happen before media decoding or helper work.
  const media = createServer(() => {});
  await new Promise<void>(resolve => media.listen(0, "127.0.0.1", resolve));
  try {
    await f.publisher.command({ type: "publishLive", sourceId: "mic", kind: "microphone", audio: true, video: false });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    const other = await f.connect(2, "&audio=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50 });
    await until(() => !!other.load());
    await f.publisher.command({ type: "allSpeakers", level: 35 });
    const previousOutputs = f.publisher.state.outputs?.map(output => ({ deviceId: output.deviceId, picture: output.picture, sound: output.sound }));
    const address = media.address(); assert.ok(address && typeof address === "object");
    assert.equal((await f.publisher.command({ type: "enqueue", entry: { id: "normal", title: "Normal", source: `http://127.0.0.1:${address.port}/pending` }, playNow: true })).ok, true);
    await until(() => f.receiver.messages.some(message => message.type === "sendspin" && message.listen) && other.messages.some(message => message.type === "sendspin" && message.listen));
    assert.deepEqual(f.publisher.state.outputs?.map(output => ({ deviceId: output.deviceId, picture: output.picture, sound: output.sound })), previousOutputs);
    assert.equal(f.publisher.state.mixTrim, 35);
    assert.equal(f.publisher.state.playbacks?.find(playback => playback.id === f.publisher.state.playback)?.liveSourceId, undefined);
    assert.equal(f.publisher.state.liveSources?.length, 1);
    const latestPeers = f.publisher.messages.findLast(message => message.type === "livePeers");
    assert.equal(latestPeers?.type, "livePeers");
    if (latestPeers?.type === "livePeers") assert.deepEqual(latestPeers.peers, []);
  } finally { await f.close(); media.closeAllConnections(); await new Promise<void>(resolve => media.close(() => resolve())); }
});

test("live signaling validates bounds and removes unvalidated fields", () => {
  const valid = { type: "liveSignal", peerId: "peer", signal: { candidate: { candidate: "candidate:1", sdpMid: "0", injected: "discard" }, injected: "discard" }, targetDeviceId: "other" };
  assert.deepEqual(parseLiveSignal(JSON.stringify(valid)), { type: "liveSignal", peerId: "peer", signal: { candidate: { candidate: "candidate:1", sdpMid: "0" } } });
  for (const signal of [{ description: { type: ["offer"], sdp: "v=0" } }, { description: { type: "offer", sdp: "x".repeat(32_769) } }, { candidate: { candidate: "x".repeat(4097) } }, { candidate: { candidate: "a", sdpMLineIndex: -1 } }, { candidate: null, description: { type: "offer", sdp: "v=0" } }]) assert.equal(parseLiveSignal(JSON.stringify({ type: "liveSignal", peerId: "peer", signal })), null);
});
