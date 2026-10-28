import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { Identity, serverNowUs } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import type { PlayerState } from "../src/shared/protocol";
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string, ms = 5000) => { const deadline = Date.now() + ms; while (!check()) { if (Date.now() > deadline) throw new Error(message); await sleep(10); } };

test("repeated resume cannot leave a picture timeline running after Stop", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const states: PlayerState[] = [];
  const core = createScheduledAudio({ name: "Resume fixture", admit: () => false, changed() {} });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.send({ type: "load", playbackId: "pictures", source: "", duration: 60 });
  group.send({ type: "pause", playbackId: "pictures", paused: true });
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.send({ type: "stop" });
  const stopped = states.length;
  t.mock.timers.tick(100);
  assert.equal(states.length, stopped, "Stop retires every timeline callback");
  assert.equal(states.at(-1)!.status, "idle");
});

test("picture-only media has a controllable timeline without opening an audio decoder", { timeout: 5000 }, async t => {
  let lookups = 0; const states: PlayerState[] = [];
  const core = createSendspin({ name: "Picture fixture", admit: () => false, changed() {}, ffmpeg: async () => { lookups++; throw new Error("No audio decoder expected"); } });
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


test("a picture-only VOD without a listed duration ends at the length its screen reports", { timeout: 5000 }, async t => {
  const states: PlayerState[] = [];
  const core = createSendspin({ name: "Picture fixture", admit: () => false, changed() {}, ffmpeg: async () => { throw new Error("No audio decoder expected"); } });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.members([]);
  group.send({ type: "load", playbackId: "pictures", source: "http://127.0.0.1:1/video-only.mp4" });
  await until(() => states.at(-1)?.status === "playing", "picture timeline never started");
  assert.equal(states.at(-1)!.duration, null);
  group.duration("other", 0.2);
  group.duration("pictures", 0.2);
  await until(() => states.at(-1)?.status === "ended", "the timeline never ended");
  assert.equal(states.at(-1)!.duration, 0.2);
});

test("queued failures and acknowledgments cannot cross a reused public source ID", { timeout: 5000 }, async t => {
  const errors: string[] = [];
  const core = createSendspin({ name: "Lifetime fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  t.after(() => core.close());
  // Ensure the worker has booted; the timeline callback crosses its real message port.
  let ready = false;
  const group = core.group("barrier", () => { ready = true; });
  group.send({ type: "load", playbackId: "barrier", source: "", duration: 60 });
  await until(() => ready, "worker did not start");
  const packet = { generation: "first", sequence: 0, samplePosition: 0, capturedAtUs: serverNowUs(), sampleRate: 48000, channels: 2 as const, pcm: new Float32Array(960) };
  core.registerSource("reused");
  core.writeSource("reused", { ...packet, sampleRate: 1 }); // Worker emits failure + ACK.
  const stall = performance.now(); while (performance.now() - stall < 100) { /* Queue worker notifications on parent. */ }
  core.endSource("reused"); core.registerSource("reused");
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
  const core = createSendspin({ name: "Auth bridge fixture", admit: () => false, changed() {}, ffmpeg: async () => ffmpeg });
  core.registerSource("auth");
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
