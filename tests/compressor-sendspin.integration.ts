import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { defaultCompressor } from "../src/shared/compressor";
import type { PlayerState } from "../src/shared/protocol";
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "Timed out waiting for compressed audio"); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("one compressed Sendspin mix feeds Opus and PCM, preserves timestamps, and applies paused edits", { timeout: 30_000, skip: !available && "Set COUCH_TEST_FFMPEG to a real FFmpeg." }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-compressor-sendspin-")), clients: SendspinClient[] = [];
  const keys = [Identity.generate(), Identity.generate(), Identity.generate()];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Compressor fixture", admit: id => keys.some(key => key.peerId === id), changed: () => {}, ffmpeg: async () => ffmpeg });
  let state: PlayerState;
  const group = core.group("compressed", next => { state = next; });
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "audio/wav"); response.end(readFileSync(join(directory, "tone.wav"))); });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  t.after(async () => {
    group.close(); core.close(); await Promise.all(clients.map(client => client.disconnect()));
    await new Promise<void>(resolve => sockets.close(() => resolve())); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
  });
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*997*t)|0.4*sin(2*PI*997*t):s=48000", "-t", "30", join(directory, "tone.wav")]);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  async function receiver(index: number, codec: AudioCodec) {
    const key = keys[index]!, frames: { timestamp: number; bytes: Buffer }[] = [];
    let starts = 0, clears = 0;
    const client = new SendspinClient(key.peerId, `Receiver ${index}`, [Roles.PLAYER], { encryption: { identity: key }, playerSupport: { supported_formats: [{ codec, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 2_000_000, supported_commands: [] } });
    clients.push(client);
    client.addStreamStartListener(() => { starts++; frames.length = 0; });
    client.addStreamClearListener(() => { clears++; frames.length = 0; });
    client.addAudioChunkListener((timestamp, bytes) => frames.push({ timestamp, bytes: Buffer.from(bytes) }));
    await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3000 });
    return { id: key.peerId, frames, get starts() { return starts; }, get clears() { return clears; } };
  }
  const pcm = await receiver(0, AudioCodec.PCM), opus = await receiver(1, AudioCodec.OPUS);
  group.members([{ deviceId: pcm.id, level: 100 }, { deviceId: opus.id, level: 37 }]);
  group.send({ type: "load", playbackId: "tone", source: `${origin}/tone.wav`, compressor: { ...defaultCompressor, enabled: true } });
  await until(() => pcm.frames.length > 10 && opus.frames.length > 10);
  const rms = (channel: number) => {
    const bytes = pcm.frames[10]!.bytes; let sum = 0;
    for (let i = channel * 2; i < bytes.length; i += 4) sum += (bytes.readInt16LE(i) / 32768) ** 2;
    return Math.sqrt(sum / (bytes.length / 4));
  };
  const compressedRms = rms(0);
  assert.ok(compressedRms < .35 && compressedRms > .1, `Expected gain reduction, received ${compressedRms}`);
  assert.ok(Math.abs(rms(0) / rms(1) - 2) < .01, "Stereo-linked compression changed the channel balance");
  for (let i = 1; i < pcm.frames.length; i++) assert.equal(pcm.frames[i]!.timestamp - pcm.frames[i - 1]!.timestamp, 100_000);
  for (let i = 1; i < opus.frames.length; i++) assert.equal(opus.frames[i]!.timestamp - opus.frames[i - 1]!.timestamp, 60_000);
  const late = await receiver(2, AudioCodec.PCM);
  group.members([{ deviceId: pcm.id, level: 100 }, { deviceId: opus.id, level: 37 }, { deviceId: late.id, level: 10 }]);
  await until(() => late.frames.length > 2);
  const originals = new Map(pcm.frames.map(frame => [frame.timestamp, frame.bytes]));
  for (const frame of late.frames) assert.deepEqual(frame.bytes, originals.get(frame.timestamp), "A receiver's volume must not change the shared samples");
  const pausedClears = pcm.clears;
  group.send({ type: "pause", playbackId: "tone", paused: true });
  await until(() => state.status === "paused" && pcm.clears > pausedClears);
  group.send({ type: "compressor", playbackId: "tone", settings: { ...defaultCompressor, enabled: true, ratio: 1, gain: -6 } });
  assert.equal(state.status, "paused");
  group.send({ type: "pause", playbackId: "tone", paused: false });
  await until(() => pcm.frames.length > 10);
  assert.ok(Math.abs(rms(0) - .8 / Math.sqrt(2) * 10 ** (-6 / 20)) < .003, "Paused settings were not applied on resume");
  const clears = pcm.clears;
  group.send({ type: "compressor", playbackId: "tone", settings: defaultCompressor });
  await until(() => pcm.clears > clears && pcm.frames.length > 10);
  assert.ok(Math.abs(rms(0) - .8 / Math.sqrt(2)) < .003, "Disabling did not restore unprocessed samples");
  const liveClears = pcm.clears;
  group.send({ type: "load", playbackId: "live", source: `${origin}/tone.wav`, liveSourceId: "capture", compressor: { ...defaultCompressor, enabled: true, threshold: -60 } });
  await until(() => pcm.clears > liveClears && pcm.frames.length > 10 && state.playbackId === "live");
  assert.ok(Math.abs(rms(0) - .8 / Math.sqrt(2)) < .003, "Buffered live sharing was compressed");
  t.diagnostic(`compressed PCM RMS ${compressedRms.toFixed(4)}; original 0.5657; mixed Opus/PCM and late receiver verified`);
});
