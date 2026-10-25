import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { createScheduledCapture } from "../src/server/scheduled-capture";
import { opusDuration } from "../src/server/audio-packets";
import type { PlayerState } from "../src/shared/protocol";
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string, ms = 5000) => { const deadline = Date.now() + ms; while (!check()) { if (Date.now() > deadline) throw new Error(message); await sleep(10); } };

test("live worker shares Opus and native PCM deadlines and survives bounded Hub stalls", { timeout: 15_000 }, async t => {
  const keys = Array.from({ length: 52 }, () => Identity.generate());
  const errors: string[] = [], states: PlayerState[] = [];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Capture fixture", admit: id => keys.some(key => key.peerId === id), changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  const group = core.group("concert", state => states.push(state));
  const server = createServer();
  server.on("upgrade", (request, socket, head) => core.upgrade(request, socket as import("node:net").Socket, head));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const clients: SendspinClient[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); core.endSource("stage"); core.close(); await Promise.all(clients.map(client => client.disconnect())); await new Promise<void>(resolve => server.close(() => resolve())); });
  const receive = async (index: number, codec: AudioCodec, capacity = 128 * 1024) => {
    const frames: { at: number; data: Buffer; received: number }[] = [];
    const client = new SendspinClient(keys[index]!.peerId, `Receiver ${index}`, [Roles.PLAYER], { encryption: { identity: keys[index]! }, playerSupport: { supported_formats: [{ codec, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: capacity, supported_commands: [] } });
    clients.push(client); client.addAudioChunkListener((at, data) => frames.push({ at, data: Buffer.from(data), received: serverNowUs() }));
    await client.connect(`ws://127.0.0.1:${address.port}/sendspin`, { timeoutMs: 3000 });
    await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 });
    return frames;
  };
  const first = await receive(0, AudioCodec.OPUS);
  core.registerSource("stage", { intent: "live" }); group.members([{ deviceId: keys[0]!.peerId, level: 100 }]);
  group.send({ type: "load", playbackId: "concert", source: "", liveSourceId: "stage", live: true, intent: "live" });
  let sequence = 0;
  const origin = serverNowUs();
  timer = setInterval(() => {
    const due = Math.floor((serverNowUs() - origin) / 10_000);
    while (sequence < due) {
      const samplePosition = sequence * 480, pcm = Float32Array.from({ length: 960 }, (_, i) => Math.sin((samplePosition + Math.floor(i / 2)) * 2 * Math.PI * (i % 2 ? 660 : 440) / 48000) * .3);
      core.writeSource("stage", { generation: "source-1", sequence, samplePosition, capturedAtUs: origin + sequence * 10_000, channels: 2, sampleRate: 48000, pcm }); sequence++;
    }
  }, 5);
  await until(() => first.length > 30, `no live Opus: ${errors.join(", ")}`);
  assert.equal(opusDuration(first[0]!.data), 5000);
  const second = await receive(1, AudioCodec.OPUS), native = await receive(2, AudioCodec.PCM);
  group.members(keys.slice(0, 3).map(key => ({ deviceId: key.peerId, level: 100 })));
  await until(() => second.length > 20 && native.length > 20, "Opus/PCM join not admitted independently");
  assert.equal(core.receiverError(keys[2]!.peerId), undefined); assert.equal(errors.length, 0);
  assert.ok(native.every(frame => frame.data.length > 0 && frame.data.length <= 240 * 4 && frame.data.length % 4 === 0));
  for (let i = 1; i < native.length; i++) assert.ok(Math.abs(native[i]!.at - native[i - 1]!.at - native[i - 1]!.data.length / 4 / 48000 * 1e6) <= 2, "PCM joins preserve contiguous sample deadlines");
  const original = new Map(first.map(frame => [frame.at, frame.data]));
  for (const frame of second) if (original.has(frame.at)) assert.deepEqual(original.get(frame.at), frame.data);
  const before = first.length;
  const stall = performance.now(); while (performance.now() - stall < 100) { /* Deliberate Hub main-loop stall. */ }
  await until(() => first.length > before + 25, "audience did not recover after a bounded Hub stall");
  const anchor = first[0]!.at;
  for (const frame of first) assert.equal((frame.at - anchor) % 5000, 0, "stall/join must not retime the audience");
  assert.equal(errors.length, 0);
  assert.ok(!states.some(state => state.status === "error"));
  const audience: Awaited<ReturnType<typeof receive>>[] = [first, second];
  for (let at = 3; at < 51; at += 6) audience.push(...await Promise.all(Array.from({ length: Math.min(6, 51 - at) }, (_, index) => receive(at + index, AudioCodec.OPUS))));
  const tiny = await receive(51, AudioCodec.OPUS, 1);
  group.members(keys.map(key => ({ deviceId: key.peerId, level: 100 })));
  await until(() => audience.every(frames => frames.length >= 8) && !!core.receiverError(keys[51]!.peerId), "50-client fanout or bounded-buffer refusal failed");
  assert.equal(tiny.length, 0, "an undersized receiver cannot hold up healthy fanout");
  assert.equal(audience.length, 50); assert.equal(errors.length, 0);
  for (const frames of audience) for (const frame of frames) assert.equal((frame.at - anchor) % 5000, 0);
  t.diagnostic("50 encrypted software Opus clients and one PCM client received shared source deadlines; one one-byte-capacity client refused independently. Not browser decoders or physical receivers.");
  t.diagnostic(`100 ms Hub stall: ${first.filter(frame => frame.received > frame.at).length} late network deliveries; no audience retiming. Software packets, no physical timing claim.`);
});

test("an encoder that cannot catch up fails after a bounded run of overdue Opus", { timeout: 8000 }, async t => {
  const errors: string[] = [];
  const source = createScheduledCapture({ intent: "live" }, async () => ffmpeg, error => errors.push(error));
  t.after(() => source.close());
  const origin = serverNowUs() - 1_000_000;
  for (let i = 0; i < 80 && !errors.length; i++) { source.write({ generation: "late", sequence: i, samplePosition: i * 480, capturedAtUs: origin + i * 10_000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }); await sleep(10); }
  await until(() => errors.length === 1, "overdue encoder did not fail");
  assert.match(errors[0]!, /deadlines/);
});

test("picture-only media has a controllable timeline without opening an audio decoder", { timeout: 5000 }, async t => {
  let lookups = 0; const states: PlayerState[] = [];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Picture fixture", admit: () => false, changed() {}, ffmpeg: async () => { lookups++; throw new Error("No audio decoder expected"); } });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.members([]); group.screens([]);
  group.send({ type: "load", playbackId: "pictures", source: "http://127.0.0.1:1/video-only.webm", duration: 60 });
  await until(() => states.at(-1)?.status === "playing", "picture timeline never started");
  assert.equal(lookups, 0);
  group.send({ type: "seek", playbackId: "pictures", position: 12 });
  group.send({ type: "pause", playbackId: "pictures", paused: true });
  await until(() => states.at(-1)?.status === "paused", "picture pause failed");
  assert.ok(states.at(-1)!.position >= 12);
  group.send({ type: "speed", playbackId: "pictures", speed: 1.5 });
  await until(() => states.at(-1)?.speed === 1.5, "picture speed failed");
  assert.equal(lookups, 0);
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.members([{ deviceId: "new-sound", level: 100 }]);
  await until(() => lookups === 1, "adding sound did not transition to decoder");
});


test("queued failures and acknowledgments cannot cross a reused public source ID", { timeout: 5000 }, async t => {
  const errors: string[] = [];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Lifetime fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  t.after(() => core.close());
  // Ensure the worker has booted; the timeline callback crosses its real message port.
  let ready = false;
  const group = core.group("barrier", () => { ready = true; });
  group.send({ type: "load", playbackId: "barrier", source: "", duration: 60 });
  await until(() => ready, "worker did not start");
  const packet = { generation: "first", sequence: 0, samplePosition: 0, capturedAtUs: serverNowUs(), sampleRate: 48000, channels: 2 as const, pcm: new Float32Array(960) };
  core.registerSource("reused", { intent: "live" });
  core.writeSource("reused", { ...packet, channels: 1 }); // Worker emits failure + ACK.
  const stall = performance.now(); while (performance.now() - stall < 100) { /* Queue worker notifications on parent. */ }
  core.endSource("reused"); core.registerSource("reused", { intent: "live" });
  await sleep(50); // Deliver the previous registration's queued notifications.
  assert.equal(core.sourceError("reused"), undefined); assert.deepEqual(errors, []);
  // Hold the parent so current ACKs cannot run. Exactly 200 stereo frames fit the
  // facade's 768000-byte limit, regardless of any prior registration's ACK.
  for (let i = 0; i < 200; i++) assert.equal(core.writeSource("reused", { ...packet, generation: "second", sequence: i, samplePosition: i * 480, capturedAtUs: serverNowUs() + i * 10000 }), true);
  assert.equal(core.writeSource("reused", packet), false, "replacement retains its own bounded queue");
  assert.match(core.sourceError("reused")!, /cannot keep up/);
  core.endSource("reused"); group.close();
});

test("an upload frame rejected by an earlier auth handler never reaches the worker", { timeout: 5000 }, async t => {
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Auth bridge fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg });
  core.registerSource("auth", { intent: "live" });
  const server = createServer(), ws = new WebSocketServer({ server });
  ws.on("connection", socket => {
    socket.on("message", (_data, binary) => { if (binary) socket.close(1008, "Authorization revoked"); });
    assert.equal(core.acceptSource(socket, "auth"), true);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  t.after(async () => { client.terminate(); core.close(); ws.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await once(client, "open");
  const clock = once(client, "message"); client.send(JSON.stringify({ type: "clock", clientUs: 0 })); await clock;
  const closed = once(client, "close"); client.send(Buffer.alloc(44)); await closed; await sleep(50);
  assert.equal(core.sourceError("auth"), undefined, "rejected malformed frame did not fail the source");
});
