import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { AudioCodec, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { SendspinCore, loadSendspinClientIdentity, type DecodedAudioChunk } from "@sendspin/sendspin-js";
import { liveFixture, until } from "./live-input.fixture";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const publication = { type: "publishLive", sourceId: "concert", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" } as const;
const signal = (_position: number, channel: number) => channel ? -.25 : .25;

async function fixture(t: TestContext) {
  const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
  const clients: SendspinClient[] = [];
  t.after(async () => { await Promise.all(clients.map(client => client.disconnect())); await f.close(); });
  const host = await f.connect(-1);
  const listener = async (index: number, codec = AudioCodec.PCM, minBufferMs = 150) => {
    const identity = f.identities[index]!;
    const client = new SendspinClient(identity.id, "Lifecycle listener", [Roles.PLAYER], {
      encryption: { identity: identity.key, suite: "25519_AESGCM_SHA256" },
      playerSupport: { supported_formats: [{ codec, channels: 2, sample_rate: 48000, bit_depth: 16 }], buffer_capacity: 1 << 20, supported_commands: [] },
    });
    clients.push(client);
    const frames: { at: number; bytes: Buffer; codec: AudioCodec; clears: number }[] = [];
    let starts = 0, clears = 0, ends = 0;
    client.addStreamStartListener(() => starts++);
    client.addStreamClearListener(() => clears++);
    client.addStreamEndListener(() => ends++);
    client.addAudioChunkListener((at, bytes, format) => frames.push({ at, bytes: Buffer.from(bytes), codec: format.codec, clears }));
    await client.connect(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`, { timeoutMs: 3000 });
    await client.sendPlayerState({ min_buffer_ms: minBufferMs });
    return { client, frames, get starts() { return starts; }, get clears() { return clears; }, get ends() { return ends; } };
  };
  return { ...f, get hub() { return f.hub; }, host, listener };
}

test("a new input generation clears queued audio and applies a lowered Live buffer without rejoining", { timeout: 15_000 }, async t => {
  const f = await fixture(t), player = await f.listener(1);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const first = await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => player.frames.length > 20);
  const playback = f.receiver.state.playback;
  assert.equal(player.frames[0]!.at, first.origin + 150_000);
  assert.equal(player.frames[0]!.bytes.readInt16LE(0), 8192);
  assert.equal(player.frames[0]!.bytes.readInt16LE(2), -8192);

  await player.client.sendPlayerState({ min_buffer_ms: 400 });
  await until(() => player.frames.some((frame, i) => i > 0 && frame.at - player.frames[i - 1]!.at === 255_000));
  await player.client.sendPlayerState({ min_buffer_ms: 150 });
  const lowered = player.frames.length;
  await until(() => player.frames.length > lowered + 20);
  assert.ok(player.frames.slice(lowered).every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000), "the running generation keeps its raised lead");

  const clears = player.clears;
  await first.stop();
  const second = await f.streamCapture(f.host, "concert", -1, () => .5, { sampleRate: 44100, channels: 1 });
  await until(() => player.frames.filter(frame => frame.clears > clears).length > 20);
  const changed = player.frames.filter(frame => frame.clears > clears);
  assert.equal(player.clears, clears + 1, "queued samples from the old input are discarded");
  assert.equal(changed[0]!.at, second.origin + 150_000, "a restarted input uses the lowered buffer");
  assert.ok(changed.every((frame, i) => i === 0 || frame.at - changed[i - 1]!.at === 5000));
  assert.ok(changed.slice(2).every(frame => frame.bytes.readInt16LE(0) === 11585 && frame.bytes.readInt16LE(2) === 11585), "only the new mono input, converted to stereo, reaches listeners");
  assert.equal(f.receiver.state.playback, playback);
  assert.equal(f.receiver.state.liveSources?.[0]?.id, "concert");
  assert.equal(f.receiver.state.player.error, null);
});

test("same-identity PCM and Opus players take over and reconnect without restarting another Live listener", { timeout: 15_000 }, async t => {
  const f = await fixture(t), other = await f.connect(2);
  const original = await f.listener(1), healthy = await f.listener(2);
  assert.equal((await f.host.command(publication)).ok, true);
  for (const receiver of [f.receiver, other]) assert.equal((await receiver.command({ type: "playLive", sourceId: "concert", deviceId: receiver.id })).ok, true);
  const input = await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => original.frames.length > 20 && healthy.frames.length > 20);
  const clears = healthy.clears, playback = other.state.playback;
  const originalClears = original.clears;

  const opus = await f.listener(1, AudioCodec.OPUS);
  await until(() => opus.frames.length > 20 && original.clears > originalClears);
  const retired = original.frames.length;
  await until(() => opus.frames.length > 40);
  assert.equal(original.frames.length, retired, "a superseded player receives no further audio");
  assert.ok(opus.frames.every(frame => frame.codec === AudioCodec.OPUS && frame.bytes.length > 0));
  assert.ok(opus.frames.every(frame => Number.isSafeInteger(frame.at) && (frame.at - input.origin - 150_000 + 2500) % 5000 === 0), "Opus keeps the running capture clock, including encoder pre-skip");

  await opus.client.disconnect();
  await until(() => original.frames.length > retired + 20);
  assert.ok(original.frames.slice(retired).every(frame => frame.codec === AudioCodec.PCM));
  await original.client.disconnect();
  const reconnected = await f.listener(1);
  await until(() => reconnected.frames.length > 20 && healthy.frames.at(-1)!.at >= reconnected.frames.at(-1)!.at);
  const uninterrupted = new Map(healthy.frames.map(frame => [frame.at, frame.bytes]));
  for (const frame of reconnected.frames) assert.deepEqual(frame.bytes, uninterrupted.get(frame.at), "reconnection rejoins the exact samples and timestamps already going to the audience");
  assert.equal(healthy.clears, clears);
  assert.equal(healthy.starts, 1);
  assert.equal(healthy.ends, 0);
  assert.ok(healthy.frames.every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000), "other listeners have no gaps or timeline changes");
  assert.equal(other.state.playback, playback);
  assert.equal(f.receiver.state.playback, playback);
  assert.equal(f.receiver.state.outputs?.length, 2, "replacement connections do not duplicate audience membership");
});

test("two Live shares keep distinct samples, audiences and buffers when one publisher crashes", { timeout: 15_000 }, async t => {
  const f = await fixture(t), secondHost = await f.connect(-1), other = await f.connect(2);
  const first = await f.listener(1), second = await f.listener(2, AudioCodec.PCM, 400);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await secondHost.command({ ...publication, sourceId: "other-concert" })).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  assert.equal((await other.command({ type: "playLive", sourceId: "other-concert", deviceId: other.id })).ok, true);
  const input = await f.streamCapture(f.host, "concert", -1, signal);
  const otherInput = await f.streamCapture(secondHost, "other-concert", -1, (_position, channel) => channel ? .5 : -.5);
  await until(() => first.frames.length > 20 && second.frames.length > 20);
  assert.notEqual(f.receiver.state.playback, other.state.playback);
  assert.deepEqual(f.receiver.state.outputs?.map(output => output.deviceId), [f.receiver.id]);
  assert.deepEqual(other.state.outputs?.map(output => output.deviceId), [other.id]);
  assert.equal(first.frames[0]!.at, input.origin + 150_000);
  assert.equal(second.frames[0]!.at, otherInput.origin + 400_000, "another share's larger buffer does not delay this audience");
  assert.ok(first.frames.every(frame => frame.bytes.readInt16LE(0) === 8192 && frame.bytes.readInt16LE(2) === -8192));
  assert.ok(second.frames.every(frame => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === 16384));
  const before = second.frames.length, clears = second.clears, playback = other.state.playback;
  f.host.socket.terminate(); // A crashed publisher sends no endLive command.
  await until(() => first.ends === 1 && !f.receiver.state.liveSources?.some(source => source.id === "concert"));
  const stopped = first.frames.length;
  await until(() => second.frames.length > before + 40);
  assert.equal(first.frames.length, stopped, "no samples arrive after the crashed publication ends");
  assert.equal(second.clears, clears);
  assert.equal(second.ends, 0);
  assert.equal(second.starts, 1);
  assert.ok(second.frames.every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000));
  assert.equal(other.state.playback, playback);
  assert.deepEqual(other.state.liveSources?.map(source => source.id), ["other-concert"]);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, false);
});

test("stopping a Live share before its listener connects cannot enroll it in a replacement publication", { timeout: 15_000 }, async t => {
  const f = await fixture(t), other = await f.connect(2), healthy = await f.listener(2);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  await until(() => f.receiver.messages.some(message => message.type === "sendspin" && message.listen));
  // The page has received Join but has not opened its audio connection yet (e.g. Tap to hear).
  assert.equal((await f.host.command({ type: "endLive", sourceId: "concert" })).ok, true);
  const late = await f.listener(1);
  assert.equal((await f.host.command(publication)).ok, true); // Reuse the public ID, with a fresh upload grant.
  assert.equal((await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id })).ok, true);
  await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => healthy.frames.length > 40);
  assert.equal(late.frames.length, 0, "a delayed connection cannot retain the ended publication's audience grant");
  assert.equal(late.starts, 0);
  assert.equal(f.receiver.state.queue.some(entry => entry.liveSourceId === "concert"), false);
  assert.equal(f.receiver.state.controls?.leave, false);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  await until(() => late.frames.length > 20);
  assert.equal(f.receiver.state.playback, other.state.playback, "an explicit new Join still works");
});

test("stopping and resharing applies a lowered buffer and rejects the previous upload grant", { timeout: 15_000 }, async t => {
  const f = await fixture(t), player = await f.listener(1);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const first = await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => player.frames.length > 20);
  await player.client.sendPlayerState({ min_buffer_ms: 400 });
  await until(() => player.frames.some((frame, i, frames) => i > 0 && frame.at - frames[i - 1]!.at === 255_000));
  await player.client.sendPlayerState({ min_buffer_ms: 150 });
  const lowered = player.frames.length;
  await until(() => player.frames.length > lowered + 20);
  assert.ok(player.frames.slice(lowered).every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000));

  assert.equal((await f.host.command({ type: "endLive", sourceId: "concert" })).ok, true);
  await until(() => player.ends === 1);
  const stopped = player.frames.length;
  assert.equal((await f.host.command(publication)).ok, true);
  const stale = await fetch(first.upload.url.replace("ws:", "http:"), { headers: { Origin: f.hub.origin } });
  assert.equal(stale.status, 403, "reusing a source ID does not revive old upload credentials");
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const second = await f.streamCapture(f.host, "concert", -1, () => .5);
  await until(() => player.frames.length > stopped + 20);
  assert.equal(player.frames[stopped]!.at, second.origin + 150_000, "the new share starts with the lower buffer");
  assert.ok(player.frames.slice(stopped).every(frame => frame.bytes.readInt16LE(0) === 16384 && frame.bytes.readInt16LE(2) === 16384));
});

test("an abruptly dropped upload can be replaced without changing its Live audience", { timeout: 15_000 }, async t => {
  const f = await fixture(t), player = await f.listener(1);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const first = await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => player.frames.length > 20);
  const playback = f.receiver.state.playback, clears = player.clears;
  const closed = once(first.upload, "close");
  first.upload.terminate(); await closed;
  const second = await f.streamCapture(f.host, "concert", -1, () => -.5);
  await until(() => player.frames.filter(frame => frame.clears > clears).length > 20);
  const resumed = player.frames.filter(frame => frame.clears > clears);
  assert.equal(player.ends, 0, "replacing a transport does not end the publication");
  assert.equal(player.clears, clears + 1);
  assert.equal(resumed[0]!.at, second.origin + 150_000);
  assert.ok(resumed.every(frame => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === -16384));
  assert.equal(f.receiver.state.playback, playback);
  assert.equal(f.receiver.state.player.error, null);
});

test("the browser SDK reconnects after Core restarts and a republished Live share gets a fresh timeline", { timeout: 15_000 }, async t => {
  const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } }), identity = f.identities[1]!;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  identity.id = loadSendspinClientIdentity(storage).clientId;
  let reconnects = 0;
  const player = new SendspinCore({ suite: "aesgcm", storage, baseUrl: `${f.hub.origin}/api/audio/${identity.token}`, codecs: ["pcm"], minBufferMs: 400,
    reconnect: { baseDelayMs: 50, maxDelayMs: 100, maxAttempts: 30, onReconnected: () => reconnects++ } });
  const chunks: DecodedAudioChunk[] = [];
  player.onAudioData = chunk => chunks.push(chunk);
  t.after(async () => { player.disconnect("user_request"); await f.close(); });
  let host = await f.connect(-1), receiver = await f.connect(1);
  await player.connect();
  assert.equal((await host.command(publication)).ok, true);
  assert.equal((await receiver.command({ type: "playLive", sourceId: "concert", deviceId: receiver.id })).ok, true);
  const first = await f.streamCapture(host, "concert", -1, signal);
  await until(() => chunks.length > 20);
  assert.ok(chunks.every(chunk => (chunk.serverTimeUs - first.origin - 400_000) % 5000 === 0));
  player.setMinBufferMs(150);
  const lowered = chunks.length;
  await until(() => chunks.length > lowered + 20);
  const address = f.hub.origin;
  await f.restart();
  host = await f.connect(-1);
  receiver = await f.connect(1);
  await until(() => reconnects > 0 && player.isConnected);
  assert.equal(f.hub.origin, address);
  assert.equal(player.clientId, identity.id);
  assert.deepEqual(receiver.state.liveSources, [], "capture and audience grants are runtime-only, so reconnect must not resurrect them");
  assert.equal(receiver.state.queue.some(entry => entry.liveSourceId), false);
  assert.equal((await receiver.command({ type: "playLive", sourceId: "concert", deviceId: receiver.id })).ok, false);

  assert.equal((await host.command(publication)).ok, true);
  assert.equal((await receiver.command({ type: "playLive", sourceId: "concert", deviceId: receiver.id })).ok, true);
  const before = chunks.length;
  // Each 5 ms block encodes its position in its amplitude, so skipped decoder startup
  // packets cannot hide an incorrect lead (150 and 400 ms both align to the packet grid).
  const second = await f.streamCapture(host, "concert", -1, (position, channel) => (1 + Math.floor(position / 240)) / 1024 * (channel ? -1 : 1));
  await until(() => chunks.length > before + 20);
  const restarted = chunks.slice(before);
  assert.ok(restarted[0]!.serverTimeUs >= second.origin + 150_000);
  for (const chunk of restarted) {
    const block = chunk.samples[0]![0]! * 1024 - 1;
    assert.ok(Number.isSafeInteger(block) && block >= 0);
    assert.equal(chunk.serverTimeUs, second.origin + block * 5000 + 150_000, "Core restart discards the old lead and capture clock");
    assert.ok(chunk.samples[0]!.every((value, i) => value === -chunk.samples[1]![i]!), "the new capture retains both channel polarities");
  }
  assert.equal(receiver.state.player.error, null);
  player.disconnect("user_request");
});

for (const failure of ["clock renegotiation", "capture stops sending"] as const) test(`a mid-share upload failure stays visible and isolated: ${failure}`, { timeout: 15_000 }, async t => {
  const f = await fixture(t), player = await f.listener(1), other = await f.connect(2), healthy = await f.listener(2);
  const otherHost = await f.connect(-1);
  assert.equal((await otherHost.command({ ...publication, sourceId: "unaffected" })).ok, true);
  assert.equal((await other.command({ type: "playLive", sourceId: "unaffected", deviceId: other.id })).ok, true);
  await f.streamCapture(otherHost, "unaffected", -1, signal);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const input = await f.streamCapture(f.host, "concert", -1, signal);
  await until(() => player.frames.length > 40 && healthy.frames.length > 40 && f.receiver.state.player.status === "playing");
  const closed = once(input.upload, "close");
  if (failure === "clock renegotiation") {
    // A restarted uploader must open a new socket; renegotiating the current clock is rejected.
    input.upload.send(JSON.stringify({ type: "start", generation: "invalid-restart", offsetUs: 0, rttUs: 0 }));
  } else input.pause(); // The socket stays open, but capture never supplies another frame.
  await closed;
  await until(() => !!f.receiver.state.player.error);
  const reason = failure === "clock renegotiation" ? /capture clock/i : /stopped sending audio/i;
  assert.match(f.receiver.state.player.error!, reason);
  await until(() => player.ends === 1);
  // A live group reports every second; none may replace its failure with "Waiting for audio".
  const before = healthy.frames.length, stopped = player.frames.length;
  await until(() => healthy.frames.length > before + 220);
  assert.equal(f.receiver.state.player.status, "error");
  assert.match(f.receiver.state.outputs?.[0]?.error ?? "", reason);
  assert.equal(player.frames.length, stopped);
  assert.equal(healthy.ends, 0);
  assert.equal(other.state.player.error, null);
  assert.ok(healthy.frames.every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000));

  assert.equal((await f.host.command({ type: "endLive", sourceId: "concert" })).ok, true);
  assert.equal((await f.host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id })).ok, true);
  const restarted = await f.streamCapture(f.host, "concert", -1, () => -.5);
  await until(() => player.frames.length > stopped + 20);
  const recovered = player.frames.slice(stopped);
  assert.equal(recovered[0]!.at, restarted.origin + 150_000);
  assert.ok(recovered.every(frame => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === -16384));
  assert.equal(f.receiver.state.player.error, null, "a failed upload cannot poison the replacement publication");
});
