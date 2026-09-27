import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Identity } from "@sonn-audio/node-sendspin";
import { SendspinCore } from "@sendspin/sendspin-js";
import { WebSocket } from "ws";
import { createSendspin, sendspinDrainMs, validateSendspinConfig } from "./sendspin";
import type { PlaybackTarget, PlayerState } from "../shared/protocol";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function until(test: () => boolean, label: string, timeout = 6000) { const end = Date.now() + timeout; while (!test()) { if (Date.now() > end) throw new Error(label); await Bun.sleep(20); } }
function fixture(qualified = true, describeClient?: (clientId: string) => { deviceId: string; name?: string }) {
  const identity = Identity.generate(), keys = new Map<string, string>();
  let target: PlaybackTarget, player: PlayerState;
  const controls: string[] = [];
  const host = createSendspin({ host: "127.0.0.1", port: 0, name: "Test group" }, { identity: identity.privateB64u, lookupPsk: id => keys.get(id) ?? null, isQualified: () => qualified, describeClient, control: (_playbackId, _clientId, command) => { controls.push(command); } });
  const playback = host.playback("proof", { changed: value => { target = value; }, observe: value => { player = value; } });
  cleanups.push(() => host.close());
  async function client(authorized = true, mismatch = false) {
    const psk = randomBytes(32).toString("base64url"), storage = new Map<string, string>();
    const client = new SendspinCore({ baseUrl: `http://127.0.0.1:${host.port}`, suite: "aesgcm", clientName: "Official JS fixture", codecs: ["pcm"], storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, longTermPsks: [{ psk, serverId: host.serverId }], unpairedAccess: false, requiredLeadTimeMs: 250, minBufferMs: 250, reconnect: { maxAttempts: 0 } });
    if (authorized) keys.set(client.clientId, mismatch ? randomBytes(32).toString("base64url") : psk);
    cleanups.push(async () => { client.disconnect(); });
    await client.connect(); return client;
  }
  return { host, playback, keys, client, controls, get target() { return target!; }, get player() { return player!; } };
}

test("Sendspin validates optional host configuration", () => {
  expect(() => validateSendspinConfig({ host: "127.0.0.1", port: 0, name: "Rooms" })).not.toThrow();
  expect(() => validateSendspinConfig({ host: "0.0.0.0", port: 8927, name: "Rooms", publicUrl: "wss://audio.example/sendspin" })).not.toThrow();
  for (const publicUrl of ["http://example.org", "wss://user:secret@example.org", "wss://example.org/sendspin?secret=1"]) expect(() => validateSendspinConfig({ host: "127.0.0.1", port: 1, name: "Rooms", publicUrl })).toThrow();
});

test("paused readiness waits for decoded PCM and failed preparation never reports paused", async () => {
  const f = fixture(); await until(() => !!f.host.port, "listener");
  const client = await f.client(); await until(() => f.host.devices.some(device => device.id === client.clientId), "authenticated player"); await f.playback.setMembers([client.clientId]); await until(() => f.target.connected, "joined");
  const audio = Buffer.alloc(44 + 192000); audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(2, 22); audio.writeUInt32LE(48000, 24); audio.writeUInt32LE(192000, 28); audio.writeUInt16LE(4, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const http = Bun.serve({ port: 0, async fetch(request) { if (new URL(request.url).pathname === "/good.wav") { await pending; return new Response(audio, { headers: { "Content-Type": "audio/wav" } }); } return new Response("bad media"); } });
  cleanups.push(async () => { release(); await http.stop(true); });
  f.playback.send({ type: "load", playbackId: "good", source: `http://127.0.0.1:${http.port}/good.wav`, paused: true, duration: 1 } as any);
  await until(() => f.player.playbackId === "good" && f.player.status === "loading", "paused decoder is preparing");
  release(); await until(() => f.player.status === "paused", "decoded paused readiness");
  f.playback.send({ type: "load", playbackId: "bad", source: `http://127.0.0.1:${http.port}/bad.wav`, paused: true, duration: 1 } as any);
  await until(() => f.player.status === "unavailable", "bad source rejected");
  expect(f.player.status).not.toBe("paused");
}, 15000);

test("official encrypted JS authenticates, refuses unknown/wrong credentials and plaintext, observes volume and revocation", async () => {
  const f = fixture(); await until(() => !!f.host.port, "listener");
  const good = await f.client(); await until(() => f.host.devices.some(device => device.id === good.clientId), "authenticated player");
  await f.client(false); await f.client(true, true);
  const plaintext = new WebSocket(`ws://127.0.0.1:${f.host.port}/sendspin`);
  const rejected = new Promise(resolve => plaintext.on("close", resolve));
  plaintext.on("open", () => plaintext.send(JSON.stringify({ type: "client/hello", payload: { client_id: "legacy", name: "Legacy", supported_roles: ["player@v1"] } })));
  await rejected; await Bun.sleep(200);
  expect(f.host.devices).toHaveLength(1);
  await f.playback.setMembers([good.clientId]); await until(() => f.target.connected, "joined");
  expect(f.target.handoffSafety).toBe("buffer-drain");
  await f.playback.setMemberVolume(good.clientId, 37, true);
  expect(f.target.members![0]).toMatchObject({ volume: 37, muted: true });
  good.sendCommand("next", undefined); await until(() => f.controls.includes("next"), "Core intent callback");
  f.keys.delete(good.clientId); f.host.disconnectClient(good.clientId);
  await until(() => !f.target.connected, "revoked client disconnected");
}, 15000);

test("real decoded PCM preserves queued stop/load, pause seek/speed and fences access loss", async () => {
  const f = fixture(); await until(() => !!f.host.port, "listener");
  const clients = [await f.client(), await f.client()];
  await until(() => f.host.devices.length === 2, "two clients");
  await f.playback.setMembers(clients.map(client => client.clientId)); await until(() => f.target.connected, "joined");
  const wav = Buffer.alloc(44 + 12 * 192000); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 12 * 48000; i++) { const value = Math.round(12000 * Math.sin(2 * Math.PI * (i < 3 * 48000 ? 440 : 880) * i / 48000)); wav.writeInt16LE(value, 44 + i * 4); wav.writeInt16LE(value, 46 + i * 4); }
  const http = Bun.serve({ port: 0, fetch: () => new Response(wav, { headers: { "Content-Type": "audio/wav" } }) });
  cleanups.push(async () => { await http.stop(true); });
  const frequencies = [0, 0], counts = [0, 0];
  clients.forEach((client, index) => { client.onAudioData = chunk => { const pcm = chunk.samples[0]!; let crossings = 0; for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! <= 0 && pcm[i]! > 0) crossings++; frequencies[index] = crossings / pcm.length * chunk.sampleRate; counts[index]++; }; });
  f.playback.send({ type: "stop" });
  f.playback.send({ type: "load", playbackId: "tone", source: `http://127.0.0.1:${http.port}/tone.wav`, duration: 12 } as any);
  await until(() => frequencies.every(hz => Math.abs(hz - 440) < 60), "both decoded440");
  await Bun.sleep(6000);
  expect(f.player.status).toBe("playing");
  f.playback.send({ type: "pause", playbackId: "tone", paused: true });
  await until(() => f.player.status === "paused", "paused after drain");
  f.playback.send({ type: "seek", playbackId: "tone", position: 3 });
  f.playback.send({ type: "speed", playbackId: "tone", speed: 1.25 });
  await until(() => f.player.status === "paused" && f.player.position === 3 && f.player.speed === 1.25, "queued paused seek and speed");
  frequencies.fill(0);
  f.playback.send({ type: "pause", playbackId: "tone", paused: false });
  await until(() => frequencies.every(hz => Math.abs(hz - 880) < 60), "both decoded880");
  expect(f.player).toMatchObject({ speed: 1.25, status: "playing" });
  const retainedPosition = f.player.position, retainedCount = counts[1]!;
  clients[0]!.disconnect();
  await until(() => !f.playback.members.includes(clients[0]!.clientId) && f.target.connected, "remaining member keeps group");
  await until(() => f.player.status === "playing" && counts[1]! > retainedCount + 5, "remaining member resumes the same playback");
  expect(f.player.playbackId).toBe("tone"); expect(f.player.position).toBeGreaterThanOrEqual(retainedPosition);
  f.host.disconnectAll(); await until(() => !f.target.connected && f.player.status === "unavailable", "access loss");
  await until(() => clients.every(client => !client.isConnected), "client transports closed");
  // Already received PCM can finish decoding after the server revokes access.
  await Bun.sleep(sendspinDrainMs);
  const before = [...counts]; await Bun.sleep(500); expect(counts).toEqual(before);
  expect(() => f.playback.send({ type: "pause", playbackId: "tone", paused: false })).toThrow();
}, 25000);

test("closing one playback releases its membership without closing the host", async () => {
  const f = fixture(); await until(() => !!f.host.port, "listener");
  const client = await f.client(); await until(() => f.host.devices.length === 1, "connected client");
  await f.playback.setMembers([client.clientId]);
  await f.playback.close();
  expect(f.playback.members).toEqual([]);
  const next = f.host.playback("next", { changed: () => {}, observe: () => {} });
  await next.setMembers([client.clientId]);
  expect(next.members).toEqual([client.clientId]);
  await next.close();
});

test("two Sendspin identities mapped to one Couch device cannot join different groups", async () => {
  const f = fixture(true, () => ({ deviceId: "same-device" })); await until(() => !!f.host.port, "listener");
  const first = await f.client(), second = await f.client();
  await until(() => f.host.devices.length === 2, "two connected clients");
  const other = f.host.playback("other", { changed: () => {}, observe: () => {} });
  await f.playback.setMembers([first.clientId]);
  await expect(other.setMembers([second.clientId])).rejects.toThrow("another playback");
  await expect(f.playback.setMembers([first.clientId, second.clientId])).rejects.toThrow("another playback");
  expect(other.members).toEqual([]);
});

test("one host runs independent timelines and joins a member without restarting either playback", async () => {
  const f = fixture(); await until(() => !!f.host.port, "listener");
  const [first, second, joining] = [await f.client(), await f.client(), await f.client()];
  await until(() => f.host.devices.length === 3, "three authenticated devices");
  let otherTarget!: PlaybackTarget, otherPlayer!: PlayerState;
  const other = f.host.playback("other", { changed: value => { otherTarget = value; }, observe: value => { otherPlayer = value; } });
  await f.playback.setMembers([first.clientId]); await other.setMembers([second.clientId]);
  await until(() => f.target.connected && otherTarget.connected, "two connected groups");
  await expect(other.setMembers([second.clientId, first.clientId])).rejects.toThrow("another playback");
  const wav = (hz: number) => {
    const audio = Buffer.alloc(44 + 8 * 192000); audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(2, 22); audio.writeUInt32LE(48000, 24); audio.writeUInt32LE(192000, 28); audio.writeUInt16LE(4, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
    for (let i = 0; i < 8 * 48000; i++) { const value = Math.round(10000 * Math.sin(2 * Math.PI * hz * i / 48000)); audio.writeInt16LE(value, 44 + i * 4); audio.writeInt16LE(value, 46 + i * 4); }
    return audio;
  };
  const tones = { first: wav(440), second: wav(660) };
  const http = Bun.serve({ port: 0, fetch: request => new Response(new URL(request.url).pathname === "/first.wav" ? tones.first : tones.second, { headers: { "Content-Type": "audio/wav" } }) });
  cleanups.push(async () => { await http.stop(true); });
  const counts = [0, 0, 0], frequencies = [0, 0, 0];
  const continuingChunks = new Map<number, Float32Array>();
  let joiningFirst: { timestamp: number; samples: Float32Array } | undefined;
  const starts = [0, 0]; first.onStreamStart = () => { starts[0]++; }; second.onStreamStart = () => { starts[1]++; };
  [first, second, joining].forEach((client, index) => { client.onAudioData = chunk => { const pcm = chunk.samples[0]!; if (index === 0) continuingChunks.set(chunk.serverTimeUs, pcm); if (index === 2 && !joiningFirst) joiningFirst = { timestamp: chunk.serverTimeUs, samples: pcm }; let crossings = 0; for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! <= 0 && pcm[i]! > 0) crossings++; frequencies[index] = crossings / pcm.length * chunk.sampleRate; counts[index]++; }; });
  f.playback.send({ type: "load", playbackId: "first-tone", source: `http://127.0.0.1:${http.port}/first.wav`, duration: 8 } as any);
  other.send({ type: "load", playbackId: "second-tone", source: `http://127.0.0.1:${http.port}/second.wav`, duration: 8 } as any);
  await until(() => Math.abs(frequencies[0]! - 440) < 60 && Math.abs(frequencies[1]! - 660) < 60, "independent decoded tones");
  const before = [counts[0]!, counts[1]!], position = f.player.position;
  await f.playback.setMembers([first.clientId, joining.clientId]);
  await until(() => Math.abs(frequencies[2]! - 440) < 60 && counts[0]! > before[0] + 5 && counts[1]! > before[1] + 5, "join without interrupting either stream");
  const original = continuingChunks.get(joiningFirst!.timestamp)!;
  expect(joiningFirst!.samples[0]).toBe(0);
  expect(joiningFirst!.samples[240]).toBeCloseTo(original[240]! / 2, 4);
  expect(joiningFirst!.samples[600]).toBe(original[600]);
  expect(f.player).toMatchObject({ playbackId: "first-tone", status: "playing" });
  expect(f.player.position).toBeGreaterThanOrEqual(position);
  expect(otherPlayer!).toMatchObject({ playbackId: "second-tone", status: "playing" });
  expect(starts).toEqual([1, 1]);
  const continuing = [counts[1]!, counts[2]!];
  await f.playback.setMembers([joining.clientId]);
  await until(() => counts[1]! > continuing[0] + 5 && counts[2]! > continuing[1] + 5, "remaining streams continue after removal");
  expect(starts).toEqual([1, 1]);
}, 16000);
