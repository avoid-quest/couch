import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("relaxed PCM retains more than 200 small capture blocks until their original deadlines", { timeout: 5000 }, async t => {
  const children: { pid: number | undefined; closed: Promise<void> }[] = [];
  const spawn = childProcess.spawn;
  const observer = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    children.push({ pid: child.pid, closed: new Promise(resolve => child.once("close", () => resolve())) });
    return child;
  });
  syncBuiltinESMExports();
  const key = Identity.generate(), errors: string[] = [], chunks: { at: number; received: number; data: Buffer }[] = [];
  const core = createScheduledAudio({ identity: Identity.generate().privateB64u, name: "Relaxed PCM fixture", admit: id => id === key.peerId, changed() {},
    ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", sourceFailed: (_id, error) => errors.push(error), logError: (_id, _source, error) => errors.push(error) });
  const group = core.group("relaxed", state => { if (state.error) errors.push(state.error); });
  const server = createServer(), sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  const client = new SendspinClient(key.peerId, "PCM receiver", [Roles.PLAYER], { encryption: { identity: key }, playerSupport: {
    supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 1024 * 1024, supported_commands: [] } });
  const unsubscribe = client.addAudioChunkListener((at, data) => chunks.push({ at, received: serverNowUs(), data: Buffer.from(data) }));
  t.after(async () => {
    unsubscribe(); group.close(); core.close();
    await client.disconnect();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.all(children.map(child => child.closed));
    sockets.removeAllListeners(); server.removeAllListeners();
    observer.mock.restore(); syncBuiltinESMExports();
    assert.equal(server.listening, false); assert.equal(sockets.clients.size, 0);
    for (const child of children) if (child.pid) assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
    t.diagnostic(JSON.stringify({ cleanup: "closed", encoderPids: children.map(child => child.pid), workersCreated: 0, listening: server.listening, sockets: sockets.clients.size }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}/sendspin`, { timeoutMs: 2000 });
  const identifiedBy = performance.now() + 1000;
  while (!core.connected(key.peerId) && performance.now() < identifiedBy) await sleep(1);
  assert.equal(core.connected(key.peerId), true);
  core.registerSource("capture", { intent: "relaxed" });
  group.members([{ deviceId: key.peerId, level: 100 }]);
  group.send({ type: "load", playbackId: "relaxed", source: "", liveSourceId: "capture", live: true, intent: "relaxed" });
  const origin = serverNowUs(), count = 240;
  const pcm = Float32Array.from({ length: 256 }, (_, index) => index % 2 ? -.5 : .25);
  for (let sequence = 0; sequence < count; sequence++) {
    // A real 128-frame block becomes available after its last sample, not early.
    const available = origin + Math.round((sequence + 1) * 128 / 48_000 * 1e6);
    while (serverNowUs() < available) await sleep(Math.max(1, (available - serverNowUs()) / 1000));
    assert.equal(core.writeSource("capture", { generation: "small-blocks", sequence, samplePosition: sequence * 128,
      capturedAtUs: origin + Math.round(sequence * 128 / 48_000 * 1e6), sampleRate: 48000, channels: 2, pcm }), true);
  }
  const receivedBy = origin + 900_000;
  while (chunks.length < count && !errors.length && serverNowUs() < receivedBy) await sleep(1);
  const now = serverNowUs(), future = chunks.filter(chunk => chunk.at > now).length;
  t.diagnostic(JSON.stringify({ inputBlocks: count, receivedChunks: chunks.length, futureChunks: future, elapsedUs: now - origin, errors }));
  assert.deepEqual(errors, [], "healthy small-block relaxed capture must not fail its group");
  assert.equal(chunks.length, count, "every real capture block reaches the PCM receiver");
  assert.ok(future > 200, "more than 200 delivered chunks coexist before their one-second deadlines");
  let frames = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.at, origin + 1_000_000 + Math.round(frames / 48_000 * 1e6), "source sample positions retain the original relaxed deadline");
    assert.ok(chunk.received < chunk.at, "PCM arrives before its deadline");
    assert.equal(chunk.data.length % 4, 0);
    for (let offset = 0; offset < chunk.data.length; offset += 4) {
      assert.equal(chunk.data.readInt16LE(offset), 8192); assert.equal(chunk.data.readInt16LE(offset + 2), -16384);
    }
    frames += chunk.data.length / 4;
  }
  assert.equal(frames, 30_720, "normalized PCM retains the complete 240-block sample count");
  assert.equal(children.length, 1, "the real capture encoder ran once");
});
