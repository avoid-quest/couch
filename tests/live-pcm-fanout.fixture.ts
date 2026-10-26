import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";

import { createScheduledAudio } from "../src/server/scheduled-audio";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("shared Live capture fans out PCM once and isolates a backpressured peer", async () => {
  const keys = [Identity.generate(), Identity.generate()];
  const errors: string[] = [], packets: { at: number; data: Buffer }[][] = [[], []];
  let lookups = 0;
  const core = createScheduledAudio({ identity: Identity.generate().privateB64u, name: "PCM fanout fixture",
    admit: id => keys.some(key => key.peerId === id), changed() {}, sourceFailed: (_id, error) => errors.push(error),
    ffmpeg: () => { lookups++; return new Promise<string>(() => {}); } });
  const group = core.group("live", () => {}), server = createServer(), sockets = new WebSocketServer({ server });
  const accepted: import("ws").WebSocket[] = [], clients: SendspinClient[] = [];
  const closed: { code: number; reason: string }[] = [];
  sockets.on("connection", (socket, request) => { accepted.push(socket); core.accept(socket, request); });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    for (const [index, key] of keys.entries()) {
      const client = new SendspinClient(key.peerId, `PCM ${index}`, [Roles.PLAYER], { encryption: { identity: key }, playerSupport: {
        supported_formats: [{ codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [],
      } });
      clients.push(client);
      client.addAudioChunkListener((at, data) => packets[index]!.push({ at, data: Buffer.from(data) }));
      await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}/sendspin`);
      await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 10, static_delay_ms: 0 });
    }
    const readyBy = performance.now() + 1000;
    while (!keys.every(key => core.status().timings.some(([id, lead]) => id === key.peerId && lead === 25)) && performance.now() < readyBy) await sleep(1);
    assert.ok(keys.every(key => core.status().timings.some(([id, lead]) => id === key.peerId && lead === 25)), "both sessions identified and declared timing");
    core.registerSource("stage", { intent: "live" });
    group.members(keys.map(key => ({ deviceId: key.peerId, level: 100 })));
    group.send({ type: "load", playbackId: "live", source: "", liveSourceId: "stage", live: true, intent: "live" });
    const capturedAtUs = serverNowUs(), pcm = Float32Array.from({ length: 256 }, (_, i) => i % 2 ? -.25 : .25);
    const write = (sequence: number) => assert.equal(core.writeSource("stage", { generation: "stage", sequence, samplePosition: sequence * 128,
      capturedAtUs: capturedAtUs + Math.round(sequence * 128 / 48000 * 1e6), sampleRate: 48000, channels: 2, pcm }), true);
    write(0);
    await sleep(20);
    assert.deepEqual(packets.map(list => list.length), [1, 1]);
    assert.deepEqual(packets[0]![0], packets[1]![0]);
    accepted[1]!.on("close", (code, reason) => closed.push({ code, reason: reason.toString() }));
    Object.defineProperty(accepted[1]!, "bufferedAmount", { get: () => 65537 });
    for (let sequence = 1; sequence < 16; sequence++) write(sequence);
    await sleep(20);
    assert.equal(packets[0]!.length, 16);
    assert.equal(packets[1]!.length, 1);
    assert.deepEqual(closed, [{ code: 1013, reason: "Audio output is too slow" }]);
    assert.equal(core.receiverError(keys[0]!.peerId), undefined);
    assert.deepEqual(errors, []);
    assert.equal(lookups, 1);
    let frames = 0;
    for (const packet of packets[0]!) {
      assert.equal(packet.at, capturedAtUs + 100000 + Math.round(frames / 48000 * 1e6));
      assert.ok(packet.data.length <= 240 * 4);
      for (let offset = 0; offset < packet.data.length; offset += 4) {
        assert.equal(packet.data.readInt16LE(offset), 8192);
        assert.equal(packet.data.readInt16LE(offset + 2), -8192);
      }
      frames += packet.data.length / 4;
    }
    assert.ok(frames >= 16 * 128 - 1 && frames <= 16 * 128, "all normalized samples survive fanout");
  } finally {
    group.close(); core.close();
    await Promise.all(clients.map(client => client.disconnect()));
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(server.listening, false);
    assert.equal(sockets.clients.size, 0);
  }
});
