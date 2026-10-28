import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { AudioCodec, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import { createSendspin } from "../src/server/sendspin";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean) => { const deadline = Date.now() + 5000; while (!check()) { if (Date.now() > deadline) throw new Error("Expected audio state did not arrive"); await sleep(10); } };

test("Sendspin control replies stop when a peer stops reading", { timeout: 10_000 }, async t => {
  const audio = createScheduledAudio({ name: "Control backlog", admit: () => true, changed() {} });
  const server = createServer(), sockets = new WebSocketServer({ server });
  let served: WebSocket | undefined;
  sockets.on("connection", (socket, request) => { served = socket; audio.accept(socket, request, "receiver"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const peer = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  t.after(async () => { peer.terminate(); audio.close(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await once(peer, "open");
  const greeting = once(peer, "message");
  peer.send(JSON.stringify({ type: "client/hello", payload: { client_id: "receiver", version: 1, supported_roles: ["controller@v1"] } }));
  await greeting;
  let writes = 0;
  const send = served!.send.bind(served!);
  served!.send = ((...args: Parameters<typeof send>) => { writes++; return send(...args); }) as typeof send;
  // Reproduce socket backpressure without flooding the host's kernel buffers.
  let stalled = true;
  Object.defineProperty(served, "bufferedAmount", { configurable: true, get: () => stalled ? 1 << 20 : 0 });
  peer.send(JSON.stringify({ type: "client/time", payload: { client_transmitted: "x".repeat(60_000) } }));
  await sleep(100);
  assert.equal(writes, 0, "control responses must not keep growing an already-stalled send queue");
  assert.equal(peer.readyState, WebSocket.OPEN);
  stalled = false;
  const reply = await once(peer, "message");
  assert.equal(JSON.parse(String(reply[0])).payload.client_transmitted.length, 60_000);
});

test("a non-finite player timing declaration cannot crash the shared audio worker", { timeout: 10_000 }, async t => {
  const errors: string[] = [], frames: number[] = [];
  const audio = createSendspin({ name: "Timing isolation", admit: () => true, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => audio.upgrade(request, socket as import("node:net").Socket, head));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const healthy = new SendspinClient("healthy", "Healthy", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 1 << 20, supported_commands: [],
  } });
  healthy.addAudioChunkListener(timestamp => frames.push(timestamp));
  const group = audio.group("programme", state => { if (state.error) errors.push(state.error); });
  let bad: WebSocket | undefined, timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); bad?.terminate(); group.close(); audio.close(); await healthy.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await healthy.connect(url);
  await healthy.sendPlayerState({ min_buffer_ms: 150 });
  audio.registerSource("capture");
  group.members([{ deviceId: "healthy", level: 100 }, { deviceId: "bad", level: 100 }]);
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", captureIntent: "live" });
  let sequence = 0;
  const origin = serverNowUs();
  timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      audio.writeSource("capture", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000,
        sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
      sequence++;
    }
  }, 5);
  await until(() => frames.length > 10);
  bad = new WebSocket(url);
  await once(bad, "open");
  const greeting = once(bad, "message");
  bad.send(JSON.stringify({ type: "client/hello", payload: { client_id: "bad", version: 1, name: "Bad", supported_roles: ["player@v1"],
    "player@v1_support": { supported_formats: [{ codec: "pcm", sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 1 << 20, supported_commands: [] },
  } }));
  await greeting;
  // Valid JSON numbers can overflow JavaScript's finite range. The SDK forwards this declaration unchanged.
  bad.send('{"type":"client/state","payload":{"player":{"min_buffer_ms":1e309,"static_delay_ms":0}}}');
  await until(() => bad!.readyState === WebSocket.CLOSED || errors.length > 0);
  assert.deepEqual(errors, [], "a player's invalid timing must not fail other playbacks");
  const before = frames.length;
  await until(() => frames.length > before + 10);
  assert.equal(audio.connected("healthy"), true);
});

test("capture sends on arrival with the maximum playback buffer and output delay", { timeout: 10_000 }, async t => {
  const frames: number[] = [], errors: string[] = [];
  const audio = createScheduledAudio({ name: "Long lead", admit: () => true, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => audio.accept(socket, request));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const player = new SendspinClient("receiver", "Receiver", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 4 * 1024 * 1024, supported_commands: [],
  } });
  player.addAudioChunkListener(timestamp => frames.push(timestamp));
  const group = audio.group("programme", state => { if (state.error) errors.push(state.error); });
  t.after(async () => { group.close(); audio.close(); await player.disconnect(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await player.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  await player.sendPlayerState({ min_buffer_ms: 5000, static_delay_ms: 5000 });
  await until(() => audio.delay("receiver") === 5000);
  audio.registerSource("capture");
  group.members([{ deviceId: "receiver", level: 100 }]);
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", captureIntent: "live" });
  const origin = serverNowUs();
  for (let sequence = 0; sequence < 120; sequence++) assert.equal(audio.writeSource("capture", {
    generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10_000,
    sampleRate: 48000, channels: 2, pcm: new Float32Array(960),
  }), true);
  await until(() => errors.length > 0 || frames.length > 200);
  assert.deepEqual(errors, [], "valid timing declarations must not overflow the capture queue");
  assert.equal(frames[0], origin + 10_000_000);
  assert.ok(frames.length > 200, "encoded capture is sent immediately even beyond media's eight-second horizon");
});

test("a player's output delay does not keep already-played audio charged to its buffer", { timeout: 10_000 }, async t => {
  const frames: number[] = [];
  const audio = createScheduledAudio({ name: "Delayed output", admit: () => true, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => audio.accept(socket, request));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const player = new SendspinClient("receiver", "Receiver", [Roles.PLAYER], { playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 64 * 1024, supported_commands: [],
  } });
  player.addAudioChunkListener(timestamp => frames.push(timestamp));
  const group = audio.group("programme", () => {});
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); audio.close(); await player.disconnect(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await player.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  await player.sendPlayerState({ min_buffer_ms: 150, static_delay_ms: 2000 });
  await until(() => audio.delay("receiver") === 2000);
  audio.registerSource("capture");
  group.members([{ deviceId: "receiver", level: 100 }]);
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", captureIntent: "live" });
  let sequence = 0;
  const origin = serverNowUs();
  timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      audio.writeSource("capture", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000,
        sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
      sequence++;
    }
  }, 5);
  await until(() => sequence >= 120);
  assert.ok(frames.length > 180, `a healthy receiver stopped after ${frames.length} chunks despite playing 2 seconds before their timestamps`);
});

test("Live listeners retain independent buffer limits and output delays on a shared timeline", { timeout: 10_000 }, async t => {
  const audio = createScheduledAudio({ name: "Buffer accounting", admit: () => true, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => audio.accept(socket, request));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const group = audio.group("programme", () => {});
  const players = [
    { capacity: 1 << 20, delay: 0 },
    { capacity: 40 * 1024, delay: 0 },
    { capacity: 40 * 1024, delay: 30 },
  ].map(({ capacity, delay }, i) => {
    const frames: { at: number; data: Buffer }[] = [];
    const client = new SendspinClient(`receiver-${i}`, `Receiver ${i}`, [Roles.PLAYER], { playerSupport: {
      supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: capacity, supported_commands: [],
    } });
    let most = 0;
    client.addAudioChunkListener((at, data) => {
      frames.push({ at, data: Buffer.from(data) });
      const now = serverNowUs() + delay * 1000;
      most = Math.max(most, frames.reduce((bytes, frame) => bytes + (frame.at + 5000 > now ? frame.data.length + 13 : 0), 0));
    });
    return { client, frames, capacity, delay, get most() { return most; } };
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); audio.close(); await Promise.all(players.map(player => player.client.disconnect())); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  for (const [i, player] of players.entries()) {
    await player.client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    await player.client.sendPlayerState({ min_buffer_ms: 200, static_delay_ms: player.delay });
    await until(() => audio.delay(`receiver-${i}`) === player.delay);
  }
  audio.registerSource("capture");
  group.members(players.map((_, i) => ({ deviceId: `receiver-${i}`, level: 100 })));
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", captureIntent: "live" });
  let sequence = 0;
  const origin = serverNowUs(), pcm = Float32Array.from({ length: 960 }, (_, i) => i % 2 ? -.5 : .25);
  timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      assert.equal(audio.writeSource("capture", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000,
        sampleRate: 48000, channels: 2, pcm }), true);
      sequence++;
    }
  }, 5);
  await until(() => players.every(player => player.frames.length > 240));
  const original = new Map(players[0]!.frames.map(frame => [frame.at, frame.data]));
  for (const player of players) {
    assert.ok(player.most <= player.capacity, `${player.most} held bytes exceeded ${player.capacity}`);
    for (const [i, frame] of player.frames.entries()) {
      assert.deepEqual(frame.data, original.get(frame.at), "every listener receives the same samples and timestamps");
      if (i) assert.equal(frame.at - player.frames[i - 1]!.at, 5000, "buffer pressure must not skip playable chunks");
    }
  }
});

test("public SDK session dispatch isolates a malformed plaintext peer without patches or changing healthy playback", { timeout: 15_000 }, async t => {
  const errors: string[] = [], frames: number[] = [];
  const audio = createScheduledAudio({ name: "Isolation", admit: id => ["healthy", "bad"].includes(id), changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", sourceFailed: (_id, error) => errors.push(error) });
  const server = createServer(), sockets = new WebSocketServer({ server, maxPayload: 65536 });
  sockets.on("connection", (socket, request) => audio.accept(socket, request));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const healthy = new SendspinClient("healthy", "Receiver", [Roles.PLAYER], { playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 131072, supported_commands: [] } });
  healthy.addAudioChunkListener(timestamp => frames.push(timestamp));
  await healthy.connect(url);
  await healthy.sendPlayerState({ min_buffer_ms: 250 });
  audio.registerSource("capture");
  const group = audio.group("programme", () => {});
  group.members([{ deviceId: "healthy", level: 100 }]);
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", live: true });
  let sequence = 0;
  const origin = serverNowUs(), timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      audio.writeSource("capture", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }); sequence++;
    }
  }, 5);
  t.after(async () => { clearInterval(timer); group.close(); audio.close(); await healthy.disconnect(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await until(() => frames.length > 5);
  const bad = new WebSocket(url);
  await once(bad, "open");
  const hello = { type: "client/hello", payload: { client_id: "bad", version: 1, name: "Bad peer", supported_roles: ["player@v1"], "player@v1_support": { supported_formats: [{ codec: "pcm", sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [] } } };
  bad.send(JSON.stringify(hello));
  const closed = once(bad, "close");
  const before = frames.length;
  bad.send("null"); // The unmodified SDK throws here; our public dispatch boundary contains it.
  await closed;
  await until(() => frames.length > before + 5);
  assert.deepEqual(errors, []);
  assert.equal(healthy.isConnected, true);
});

for (const delay of [0, 2000]) test(`a stalled Live listener resumes at playable audio with ${delay} ms output delay`, { timeout: 20_000 }, async t => {
  const frames: number[] = [], stalledFrames: number[] = [];
  const audio = createScheduledAudio({ name: "Stall", admit: id => ["healthy", "stalled"].includes(id), changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", sourceFailed() {} });
  const server = createServer(), sockets = new WebSocketServer({ server });
  const served: WebSocket[] = [];
  sockets.on("connection", (socket, request) => { served.push(socket); audio.accept(socket, request); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const player = (id: string, heard: number[]) => {
    const client = new SendspinClient(id, id, [Roles.PLAYER], { playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 1 << 20, supported_commands: [] } });
    client.addAudioChunkListener(timestamp => heard.push(timestamp));
    return client;
  };
  const healthy = player("healthy", frames), stalled = player("stalled", stalledFrames);
  await healthy.connect(url); await stalled.connect(url);
  await healthy.sendPlayerState({ min_buffer_ms: 150, static_delay_ms: delay }); await stalled.sendPlayerState({ min_buffer_ms: 150, static_delay_ms: delay });
  await until(() => audio.delay("stalled") === delay);
  const stalledSocket = served.at(-1)!;
  audio.registerSource("capture");
  const group = audio.group("programme", () => {});
  group.members([{ deviceId: "healthy", level: 100 }, { deviceId: "stalled", level: 100 }]);
  group.send({ type: "load", playbackId: "programme", source: "", liveSourceId: "capture", live: true, captureIntent: "live" });
  let sequence = 0;
  const origin = serverNowUs(), timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      audio.writeSource("capture", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }); sequence++;
    }
  }, 5);
  t.after(async () => { clearInterval(timer); group.close(); audio.close(); await healthy.disconnect(); await stalled.disconnect(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await until(() => stalledFrames.length > 20 && frames.length > 20);
  // A frozen tab or process: its socket stops reading while the connection stays open. Once the
  // kernel's buffers fill (seconds on Wi-Fi, ~1 MB on loopback), Core's socket reports a backlog.
  const socket = (stalled as unknown as { ws: { _socket: { pause(): void; resume(): void } } }).ws._socket;
  let backlog = true, writes = 0;
  Object.defineProperty(stalledSocket, "bufferedAmount", { configurable: true, get: () => backlog ? 1 << 20 : 0 });
  const send = stalledSocket.send.bind(stalledSocket);
  stalledSocket.send = ((...args: Parameters<typeof send>) => { writes++; return send(...args); }) as typeof send;
  socket.pause();
  const before = frames.length;
  await sleep(4000);
  assert.ok(frames.length > before + 500, "the healthy listener keeps receiving while another stalls");
  assert.ok(writes < 10, `Core stops queueing audio for the stalled listener (${writes} writes)`);
  const resumed = serverNowUs() + delay * 1000;
  stalledFrames.length = 0;
  backlog = false; socket.resume();
  await until(() => stalledFrames.some(at => at > resumed));
  await sleep(500);
  // What the kernel already held arrives first; Core adds no stale backlog behind it.
  const stale = stalledFrames.filter(at => at < resumed).length;
  assert.ok(stale < 50, `stale chunks after resume: ${stale} of ${stalledFrames.length}`);
});
