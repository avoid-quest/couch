import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { SendspinCore, type DecodedAudioChunk } from "@sendspin/sendspin-js";
import { AudioCodec } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";

test("unmodified browser SDK 3.2.1 receives plaintext capture through the authorized Couch device", { timeout: 15_000 }, async t => {
  const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
  const host = await f.connect(-1), identity = f.identities[1]!;
  const authorization = await fetch(`${f.hub.origin}/api/audio/session`, { method: "POST", headers: { Authorization: `Bearer ${identity.token}` } });
  assert.equal(authorization.status, 204);
  const cookie = authorization.headers.get("set-cookie")!.split(";")[0]!;
  const originalSocket = globalThis.WebSocket;
  // Node has no browser cookie jar. Supply the HTTP cookie at the public socket boundary.
  globalThis.WebSocket = class extends WebSocket { constructor(url: string | URL) { super(url, { headers: { Cookie: cookie } }); } } as typeof globalThis.WebSocket;
  t.after(() => { globalThis.WebSocket = originalSocket; });
  const chunks: DecodedAudioChunk[] = [];
  const player = new SendspinCore({ playerId: identity.id, baseUrl: f.hub.origin, codecs: ["pcm"] });
  player.onAudioData = chunk => chunks.push(chunk);
  let capture: { stop(): void } | undefined;
  t.after(async () => { capture?.stop(); player.disconnect("user_request"); await f.close(); });
  assert.equal((await host.command({ type: "publishLive", sourceId: "host-input", uploadToken: f.uploadToken, kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" })).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "host-input", deviceId: identity.id })).ok, true);
  await player.connect();
  capture = await f.streamCapture(host, "host-input", -1);
  await until(() => chunks.length > 5);
  assert.equal(player.currentFormat?.codec, "pcm");
  assert.equal(chunks[0]!.sampleRate, 48000);
  assert.equal(chunks[0]!.samples.length, 2);
  assert.equal(chunks[0]!.samples[0]!.length, 960);
  assert.ok(chunks.every(chunk => Number.isSafeInteger(chunk.serverTimeUs)));
  await until(() => f.receiver.state.outputs?.some(output => output.deviceId === identity.id && output.delayActive) === true);
  assert.ok(f.receiver.messages.some(message => message.type === "sendspin" && message.listen && message.live?.minBufferMs === 250));
  assert.equal(f.receiver.messages.some(message => message.type === "player" && message.command.type === "load" && message.command.livePeerId), false);
  // The SDK's public option is applied without a custom output preparation protocol.
  player.setMinBufferMs(400);
  await until(() => f.receiver.state.player.status === "playing");
  const other = await f.connect(2);
  assert.equal((await other.command({ type: "playLive", sourceId: "host-input", deviceId: other.id })).ok, true);
  await f.speaker(2, AudioCodec.OPUS, { min_buffer_ms: 250, required_lead_time_ms: 250 });
  await until(() => f.heard(2) > 5);
  const before = chunks.length;
  await player.disconnect("user_request");
  await player.connect();
  await until(() => chunks.length > before + 5);
  assert.equal((await f.receiver.command({ type: "leave", playbackId: f.receiver.state.player.playbackId! })).ok, true);
  await until(() => f.receiver.state.controls?.leave === false);
  assert.ok(other.state.outputs?.some(output => output.deviceId === other.id));
});

test("plaintext hello cannot claim another device behind an authenticated token", { timeout: 10_000 }, async t => {
  const f = await liveFixture();
  const identity = f.identities[1]!;
  const player = new SendspinCore({ playerId: f.identities[0]!.id, baseUrl: `${f.hub.origin}/api/audio/${identity.token}`, codecs: ["pcm"], reconnect: { maxAttempts: 0 } });
  let closed = false;
  player.onConnectionClose = () => { closed = true; };
  t.after(async () => { player.disconnect("user_request"); await f.close(); });
  await player.connect().catch(() => {});
  await until(() => closed);
  assert.equal(player.isConnected, false);
  assert.equal((await fetch(`${f.hub.origin}/api/audio/invalid-token/sendspin`)).status, 401);
});
