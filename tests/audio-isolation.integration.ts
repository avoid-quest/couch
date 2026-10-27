import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { AudioCodec, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean) => { const deadline = Date.now() + 5000; while (!check()) { if (Date.now() > deadline) throw new Error("Expected audio state did not arrive"); await sleep(10); } };

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
