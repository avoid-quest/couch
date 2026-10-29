import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import WebSocket from "ws";
import { Identity } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

for (const master of ["/master.m3u8", "/stream"]) test(`Core sound-only Direct selects ${master} without video; restoring picture keeps its queue`, { timeout: 15_000 }, async () => {
  const requested: string[] = [];
  const media = createServer((request, response) => {
    requested.push(request.url!);
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    if (request.url === master) response.end('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,NAME="Sound",URI="/sound.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio",CODECS="avc1.640028,mp4a.40.2"\n/picture.m3u8\n');
    else if (request.url === "/sound.m3u8") response.end("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/sound.aac\n#EXT-X-ENDLIST\n");
    else if (request.url === "/picture.m3u8") response.end("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/picture.ts\n#EXT-X-ENDLIST\n");
    else response.end("fixture media");
  });
  await new Promise<void>(resolve => media.listen(0, "127.0.0.1", resolve));
  const source = `http://127.0.0.1:${(media.address() as { port: number }).port}${master}`;
  const f = await liveFixture();
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id })).ok, true);
    await until(() => f.receiver.load()?.source.includes("/api/health") === true);
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: false })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Programme", source }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.source.includes("sound.m3u8") === true);
    const command = f.receiver.load()!;
    assert.deepEqual(command.output, { picture: false, sound: true });
    assert.equal(command.audioSource, undefined);
    assert.equal(command.follow, undefined);
    for (const internal of ["headers", "audioManifest", "credentialOrigin", "publicNetwork", "hasAudio"]) assert.equal(internal in command, false, `${internal} stays inside Core source preparation`);
    assert.equal(f.receiver.state.playbacks?.find(item => item.id === f.receiver.state.playback)?.delivery, "direct");
    assert.ok(requested.includes(master) && requested.includes("/sound.m3u8"), "the fixture exercised real Core HTTP preparation");
    assert.equal(requested.filter(path => path === master).length, 1, "one load selects its rendition once");
    assert.equal(requested.some(path => path.startsWith("/picture")), false, "even source classification and relay preparation must leave unused picture bytes alone");
    await f.receiver.command({ type: "enqueue", entry: { id: "next-item", title: "Next", source: `${f.hub.origin}/api/health` } });
    const queue = f.receiver.state.queue.map(entry => entry.id), playback = f.receiver.state.playback;
    f.receiver.report({ duration: 5, seekable: true, audioDelay: undefined });
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "audioDelay", playbackId: command.playbackId, delay: 0.1 })).ok, false, "muxed audio delay is unavailable when the renderer reports none");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: true })).ok, true);
    await until(() => f.receiver.load()?.output?.picture === true);
    assert.equal(f.receiver.state.playback, playback);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
    assert.equal(f.receiver.load()!.playbackId, command.playbackId);
    assert.equal(f.receiver.load()?.source, source, "restoring picture reselects the complete master");
    f.receiver.report({ audioDelay: 0 });
    await until(() => f.receiver.state.controls?.audioDelay === true);
    assert.equal((await f.receiver.command({ type: "audioDelay", playbackId: command.playbackId, delay: 0.08 })).ok, true, "a renderer that supports split audio retains useful delay");
  } finally {
    await f.close();
    media.closeAllConnections();
    await new Promise<void>(resolve => media.close(() => resolve()));
  }
});

test("picture-only groups keep a seekable timeline, duration and queue through joins", { timeout: 15_000 }, async () => {
  const broadcast = createServer((_request, response) => { response.setHeader("Content-Type", "application/vnd.apple.mpegurl"); response.end("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/live.ts\n"); });
  await new Promise<void>(resolve => broadcast.listen(0, "127.0.0.1", resolve));
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "enqueue", entry: { id: "picture", title: "Picture", source: `${f.hub.origin}/api/health`, duration: 60 }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report({ duration: 60, seekable: true, position: 3 });
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    const other = await f.connect(2, "&video=1");
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, picture: true })).ok, true);
    await until(() => f.receiver.state.player.timeline?.mapping === "media" && f.receiver.state.player.status === "playing");
    const playbackId = f.receiver.state.player.playbackId!;
    assert.equal(f.receiver.state.player.duration, 60);
    assert.equal(f.receiver.state.player.seekable, true);
    assert.equal(f.receiver.state.controls?.speed, true);
    assert.equal(f.receiver.state.outputs?.some(output => output.sound), false);
    assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 12 })).ok, true);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    await until(() => f.receiver.state.player.status === "paused");
    assert.ok(f.receiver.state.player.position >= 12);
    assert.equal((await f.receiver.command({ type: "speed", playbackId, speed: 1.5 })).ok, true);
    await until(() => f.receiver.state.player.speed === 1.5);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["picture", "next"]);
    await until(() => other.load()?.follow?.timeline?.generation === playbackId);
    assert.deepEqual(other.load()?.output, { picture: true, sound: false });
    assert.equal(other.load()?.audioSource, undefined);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "broadcast", title: "Broadcast", source: `http://127.0.0.1:${(broadcast.address() as { port: number }).port}/live.m3u8` }, playNow: true })).ok, true);
    await until(() => f.receiver.state.player.timeline?.mapping === "unavailable");
    await until(() => other.load()?.playbackId === f.receiver.state.player.playbackId);
    assert.equal(other.load()?.follow?.timeline?.mapping, "unavailable", "a picture-only broadcast has no source-PTS clock");
  } finally { await f.close(); broadcast.closeAllConnections(); await new Promise<void>(resolve => broadcast.close(() => resolve())); }
});

test("native receiving-host preflight preserves queues while a capture-only host can serve remote listeners", { skip: process.platform !== "linux", timeout: 15_000 }, async t => {
  let unavailable = false;
  const subscription = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill() { this.stdout.end(); } });
  const { execFile, spawn } = childProcess;
  const exists = fs.existsSync;
  t.mock.method(fs, "existsSync", path => path === "/usr/bin/pactl" || exists(path));
  t.mock.method(childProcess, "execFile", (file, args, options, callback) => {
    if (file !== "/usr/bin/pactl") return execFile(file, args, options, callback);
    queueMicrotask(() => {
      if (unavailable) return callback(Object.assign(new Error("Audio session unavailable"), { code: "ECONNREFUSED" }), "");
      callback(null, args[0] === "get-default-sink" ? "speakers" : JSON.stringify(args.includes("sinks") ? [{ index: 1, name: "speakers", volume: { left: { value: 32768 } } }] : []));
    });
  });
  t.mock.method(childProcess, "spawn", (file, ...args) => file === "/usr/bin/pactl" ? subscription : spawn(file, ...args));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const directory = mkdtempSync(join(tmpdir(), "couch-native-policy-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true), hostId = Identity.generate().peerId, receiverId = Identity.generate().peerId;
  const receiverToken = store.pair(receiverId, "Receiver"), hostToken = "h".repeat(64);
  store.close();
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, native: true, streamingCommunityFetch: async () => new Response(null, { status: 503 }) });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); });
  const connect = async (id: string, token: string) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?${new URLSearchParams({ device: id, token, audio: "1", video: "1" })}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    let state: SessionState | undefined, sequence = 0;
    const pending = new Map<string, (result: Extract<ServerMessage, { type: "result" }>) => void>();
    socket.on("message", data => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "state") state = message.state;
      if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
    });
    await until(() => !!state);
    return { get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => { const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action })); }) };
  };
  const host = await connect(hostId, hostToken), receiver = await connect(receiverId, receiverToken);
  await until(() => host.state.systemAudio?.error === null);
  assert.equal((await receiver.command({ type: "enqueue", entry: { id: "ordinary", title: "Ordinary", source: `${hub.origin}/api/health` }, playNow: true, deviceId: receiverId })).ok, true);
  const playback = receiver.state.playback, outputs = receiver.state.outputs;
  unavailable = true;
  subscription.stdout.write("Event 'change' on server #0\n");
  await until(() => !!host.state.systemAudio?.error);
  assert.equal((await receiver.command({ type: "solo", deviceId: hostId })).ok, false);
  assert.equal(receiver.state.playback, playback);
  assert.deepEqual(receiver.state.outputs, outputs);
  assert.deepEqual(receiver.state.queue.map(entry => entry.id), ["ordinary"]);
  assert.equal((await host.command({ type: "publishLive", sourceId: "capture", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, intent: "live", audioDelivery: "pcm" })).ok, true);
  assert.equal((await receiver.command({ type: "playLive", sourceId: "capture", deviceId: receiverId, picture: false, sound: true })).ok, true);
  await until(() => receiver.state.controls?.leave === true);
  assert.equal(receiver.state.outputs?.length, 1);
  assert.equal(receiver.state.outputs?.[0]?.deviceId, receiverId);
  assert.equal(receiver.state.playbacks?.find(item => item.id === receiver.state.playback)?.delivery, "scheduled");
});
