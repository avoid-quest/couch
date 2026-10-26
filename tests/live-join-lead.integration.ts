import { test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, "bounded packet wait"); await sleep(5); }
};

test("a newly ready Live listener starts beyond its lead and correction without retiming healthy listeners", { timeout: 10000 }, async t => {
  const keys = [Identity.generate(), Identity.generate()], receiverIds = [randomUUID(), randomUUID()];
  const errors: string[] = [];
  const core = createScheduledAudio({
    identity: Identity.generate().privateB64u, name: "Join lead fixture",
    admit: id => keys.some(key => key.peerId === id), changed() {},
    ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", sourceFailed: (_id, error) => errors.push(error),
  });
  const group = core.group("live", () => {}), http = createServer(), ws = new WebSocketServer({ server: http });
  ws.on("connection", (socket, request) => core.accept(socket, request));
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const clients: SendspinClient[] = [], packets: { at: number; data: Buffer }[][] = [[], []];
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => {
    clearInterval(timer); group.close(); core.close();
    await Promise.all(clients.map(client => client.disconnect()));
    ws.close(); await new Promise<void>(resolve => http.close(() => resolve()));
  });
  for (let i = 0; i < 2; i++) {
    const client = new SendspinClient(keys[i]!.peerId, `Receiver ${i}`, [Roles.PLAYER], {
      encryption: { identity: keys[i]! },
      playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [] },
    });
    clients.push(client);
    client.addAudioChunkListener((at, data) => packets[i]!.push({ at, data: Buffer.from(data) }));
    await client.connect(`ws://127.0.0.1:${port}/sendspin`);
    await client.sendPlayerState({ required_lead_time_ms: 40, min_buffer_ms: 25, static_delay_ms: i ? 5 : 0,
      couch_preparation: { receiverId: receiverIds[i]!, epoch: 0, state: i ? "preparing" : "ready" } });
  }
  core.registerSource("stage", { intent: "live" });
  group.members(keys.map((key, i) => ({ deviceId: key.peerId, level: 100, receiverId: receiverIds[i]! })));
  group.send({ type: "load", playbackId: "live", source: "", liveSourceId: "stage", live: true, intent: "live" });
  const origin = serverNowUs(); let sequence = 0;
  timer = setInterval(() => {
    const due = Math.floor((serverNowUs() - origin) / 10000);
    while (sequence < due) {
      const index = sequence++;
      core.writeSource("stage", { generation: "source", sequence: index, samplePosition: index * 480,
        capturedAtUs: origin + index * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
    }
  }, 5);
  await until(() => packets[0]!.length >= 40);
  assert.equal(packets[1]!.length, 0);
  const readyAt = serverNowUs();
  await clients[1]!.sendPlayerState({ required_lead_time_ms: 40, min_buffer_ms: 25, static_delay_ms: 5,
    couch_preparation: { receiverId: receiverIds[1]!, epoch: 0, state: "ready" } });
  await until(() => packets[1]!.length >= 10);
  assert.ok(packets[1]![0]!.at >= readyAt + 45000,
    `first deadline has ${(packets[1]![0]!.at - readyAt) / 1000} ms; needs 40 ms lead + 5 ms output correction`);
  const joined = [...packets[1]!];
  // Socket deliveries can arrive in either order; compare the same completed range.
  await until(() => packets[0]!.at(-1)!.at >= joined.at(-1)!.at);
  const first = new Map(packets[0]!.map(packet => [packet.at, packet.data]));
  assert.ok(joined.every(packet => first.has(packet.at)), "new listener must use the existing audience timestamps");
  for (const packet of joined) assert.deepEqual(packet.data, first.get(packet.at));
  assert.deepEqual(errors, []);
});
