import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// A locked Android phone runs its page's timers late and its Wi-Fi dozes. Speakers must hold
// seconds of sound, not one, and a speaker that joins late gets that sound too.
test("synced sound goes out seconds ahead, also to a late speaker", { timeout: 20_000, skip: !available && "Set COUCH_TEST_FFMPEG to run the send-ahead test." }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-ahead-"));
  const clients: SendspinClient[] = [];
  const keys = [Identity.generate(), Identity.generate()];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Ahead fixture", admit: id => keys.some(key => key.peerId === id), changed: () => {}, ffmpeg: async () => ffmpeg });
  const group = core.group("ahead", () => {});
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "audio/wav"); response.end(readFileSync(join(directory, "tone.wav"))); });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  t.after(async () => {
    group.close(); core.close();
    await Promise.all(clients.map(client => client.disconnect()));
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "30", "-ac", "2", join(directory, "tone.wav")], { stdio: "pipe" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  async function receiver(index: number) {
    const key = keys[index]!, frames: { timestamp: number; bytes: Buffer }[] = [];
    const client = new SendspinClient(key.peerId, `Receiver ${index}`, [Roles.PLAYER], {
      encryption: { identity: key },
      playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 2_000_000, supported_commands: [] },
    });
    clients.push(client);
    client.addAudioChunkListener((timestamp, bytes) => frames.push({ timestamp, bytes: Buffer.from(bytes) }));
    await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
    return { id: key.peerId, frames };
  }
  const first = await receiver(0);
  group.members([{ deviceId: first.id, level: 100 }]);
  group.send({ type: "load", playbackId: "ahead", source: `${origin}/tone.wav` });
  await until(() => (first.frames.at(-1)?.timestamp ?? 0) - serverNowUs() > 5_000_000, "Speakers were not sent sound seconds ahead");
  await until(() => serverNowUs() > first.frames[0]!.timestamp + 1_000_000, "The first speaker never started playing");

  const second = await receiver(1);
  const joinedAt = serverNowUs();
  group.members([{ deviceId: first.id, level: 100 }, { deviceId: second.id, level: 100 }]);
  await until(() => (second.frames.at(-1)?.timestamp ?? 0) - serverNowUs() > 5_000_000, "A late speaker was not sent the sound others hold");
  assert.ok(second.frames[0]!.timestamp - joinedAt < 500_000, "a late speaker must start with the sound that plays next");
  const original = new Map(first.frames.map(frame => [frame.timestamp, frame.bytes]));
  for (const frame of second.frames) assert.deepEqual(original.get(frame.timestamp), frame.bytes, "both speakers must receive identical samples with identical play times");
  for (let index = 1; index < second.frames.length; index++) assert.equal(second.frames[index]!.timestamp - second.frames[index - 1]!.timestamp, 60_000, "a late speaker's sound must have no gap");
  t.diagnostic(`lead ${((first.frames.at(-1)!.timestamp - serverNowUs()) / 1e6).toFixed(1)} s; late speaker started ${((second.frames[0]!.timestamp - joinedAt) / 1e3).toFixed(0)} ms after joining`);
});
