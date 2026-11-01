import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { AudioCodec, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const publication = {
  type: "publishLive",
  sourceId: "concert",
  uploadToken: "1".repeat(64),
  kind: "microphone",
  audio: true,
  video: false,
  audioDelivery: "pcm",
  intent: "live",
} as const;
const signal = (_position: number, channel: number) => (channel ? -0.25 : 0.25);

async function fixture(t: TestContext) {
  const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
  const clients: SendspinClient[] = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.disconnect()));
    await f.close();
  });
  const host = await f.connect(-1);
  const listener = async (index: number, codec = AudioCodec.PCM, minBufferMs = 150) => {
    const identity = f.identities[index]!;
    const client = new SendspinClient(identity.id, "Lifecycle listener", [Roles.PLAYER], {
      encryption: { identity: identity.key, suite: "25519_AESGCM_SHA256" },
      playerSupport: {
        supported_formats: [{ codec, channels: 2, sample_rate: 48000, bit_depth: 16 }],
        buffer_capacity: 1 << 20,
        supported_commands: [],
      },
    });
    clients.push(client);
    const frames: { at: number; bytes: Buffer; codec: AudioCodec; clears: number }[] = [];
    let starts = 0,
      clears = 0,
      ends = 0;
    client.addStreamStartListener(() => starts++);
    client.addStreamClearListener(() => clears++);
    client.addStreamEndListener(() => ends++);
    client.addAudioChunkListener((at, bytes, format) =>
      frames.push({ at, bytes: Buffer.from(bytes), codec: format.codec, clears }),
    );
    await client.connect(
      `${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`,
      { timeoutMs: 3000 },
    );
    await client.sendPlayerState({ min_buffer_ms: minBufferMs });
    return {
      client,
      frames,
      get starts() {
        return starts;
      },
      get clears() {
        return clears;
      },
      get ends() {
        return ends;
      },
    };
  };
  return {
    ...f,
    get hub() {
      return f.hub;
    },
    host,
    listener,
  };
}

test(
  "different Receiver buffers produce one shared Live lead and report the Receiver that set it",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      other = await f.connect(2);
    const fast = await f.listener(1, AudioCodec.PCM, 65),
      slow = await f.listener(2, AudioCodec.PCM, 150);
    await slow.client.sendPlayerState({ static_delay_ms: 10 });
    assert.equal((await f.host.command(publication)).ok, true);
    for (const receiver of [f.receiver, other])
      assert.equal(
        (await receiver.command({ type: "playLive", sourceId: "concert", deviceId: receiver.id }))
          .ok,
        true,
      );
    const input = await f.streamCapture(f.host, "concert", -1, signal);
    await until(() => fast.frames.length > 20 && slow.frames.length > 20);
    assert.equal(fast.frames[0]!.at, input.origin + 160_000);
    assert.deepEqual(
      fast.frames.slice(0, 20),
      slow.frames.slice(0, 20),
      "every Receiver gets identical samples at identical timestamps",
    );
    const lead = () =>
      f.host.state.playbacks?.find((playback) => playback.liveSourceId === "concert")?.liveLead;
    assert.deepEqual(lead(), { ms: 160, deviceId: other.id });

    await fast.client.sendPlayerState({ min_buffer_ms: 205 });
    await until(() =>
      fast.frames.some((frame, i, frames) => i > 0 && frame.at - frames[i - 1]!.at === 50_000),
    );
    await until(() => lead()?.ms === 205);
    assert.deepEqual(lead(), { ms: 205, deviceId: f.receiver.id });
    await until(() => slow.frames.length >= fast.frames.length);
    assert.deepEqual(
      fast.frames,
      slow.frames.slice(0, fast.frames.length),
      "raising either declaration moves the whole audience together",
    );

    assert.equal(
      (await f.receiver.command({ type: "leave", playbackId: f.receiver.state.player.playbackId! }))
        .ok,
      true,
    );
    const before = slow.frames.length;
    await until(() => slow.frames.length > before + 20);
    assert.deepEqual(
      lead(),
      { ms: 205, deviceId: f.receiver.id },
      "leaving retains the lead and its attribution until the input restarts",
    );
  },
);

test(
  "two Live shares keep distinct samples, audiences and buffers when one publisher crashes",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      secondHost = await f.connect(-1),
      other = await f.connect(2);
    const first = await f.listener(1),
      second = await f.listener(2, AudioCodec.PCM, 400);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await secondHost.command({ ...publication, sourceId: "other-concert" })).ok,
      true,
    );
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    assert.equal(
      (await other.command({ type: "playLive", sourceId: "other-concert", deviceId: other.id })).ok,
      true,
    );
    const input = await f.streamCapture(f.host, "concert", -1, signal);
    const otherInput = await f.streamCapture(
      secondHost,
      "other-concert",
      -1,
      (_position, channel) => (channel ? 0.5 : -0.5),
    );
    await until(() => first.frames.length > 20 && second.frames.length > 20);
    assert.notEqual(f.receiver.state.playback, other.state.playback);
    assert.deepEqual(
      f.receiver.state.outputs?.map((output) => output.deviceId),
      [f.receiver.id],
    );
    assert.deepEqual(
      other.state.outputs?.map((output) => output.deviceId),
      [other.id],
    );
    assert.equal(first.frames[0]!.at, input.origin + 150_000);
    assert.equal(
      second.frames[0]!.at,
      otherInput.origin + 400_000,
      "another share's larger buffer does not delay this audience",
    );
    assert.ok(
      first.frames.every(
        (frame) => frame.bytes.readInt16LE(0) === 8192 && frame.bytes.readInt16LE(2) === -8192,
      ),
    );
    assert.ok(
      second.frames.every(
        (frame) => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === 16384,
      ),
    );
    const before = second.frames.length,
      clears = second.clears,
      playback = other.state.playback;
    f.host.socket.terminate(); // A crashed publisher sends no endLive command.
    await until(
      () =>
        first.ends === 1 &&
        !f.receiver.state.liveSources?.some((source) => source.id === "concert"),
    );
    const stopped = first.frames.length;
    await until(() => second.frames.length > before + 40);
    assert.equal(
      first.frames.length,
      stopped,
      "no samples arrive after the crashed publication ends",
    );
    assert.equal(second.clears, clears);
    assert.equal(second.ends, 0);
    assert.equal(second.starts, 1);
    assert.ok(
      second.frames.every((frame, i, frames) => i === 0 || frame.at - frames[i - 1]!.at === 5000),
    );
    assert.equal(other.state.playback, playback);
    assert.deepEqual(
      other.state.liveSources?.map((source) => source.id),
      ["other-concert"],
    );
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      false,
    );
  },
);

test(
  "stopping a Live share before its listener connects cannot enroll it in a replacement publication",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      other = await f.connect(2),
      healthy = await f.listener(2);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    await until(() =>
      f.receiver.messages.some((message) => message.type === "sendspin" && message.listen),
    );
    // The page has received Join but has not opened its audio connection yet (e.g. Tap to hear).
    assert.equal((await f.host.command({ type: "endLive", sourceId: "concert" })).ok, true);
    const late = await f.listener(1);
    assert.equal((await f.host.command(publication)).ok, true); // Reuse the public ID, with a fresh upload grant.
    assert.equal(
      (await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id })).ok,
      true,
    );
    await f.streamCapture(f.host, "concert", -1, signal);
    await until(() => healthy.frames.length > 40);
    assert.equal(
      late.frames.length,
      0,
      "a delayed connection cannot retain the ended publication's audience grant",
    );
    assert.equal(late.starts, 0);
    assert.equal(
      f.receiver.state.queue.some((entry) => entry.liveSourceId === "concert"),
      false,
    );
    assert.equal(f.receiver.state.controls?.leave, false);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    await until(() => late.frames.length > 20);
    assert.equal(
      f.receiver.state.playback,
      other.state.playback,
      "an explicit new Join still works",
    );
  },
);

test(
  "an abruptly dropped upload can be replaced without changing its Live audience",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      player = await f.listener(1);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    const first = await f.streamCapture(f.host, "concert", -1, signal);
    await until(() => player.frames.length > 20);
    const playback = f.receiver.state.playback,
      clears = player.clears;
    const closed = once(first.upload, "close");
    first.upload.terminate();
    await closed;
    const second = await f.streamCapture(f.host, "concert", -1, () => -0.5);
    await until(() => player.frames.filter((frame) => frame.clears > clears).length > 20);
    const resumed = player.frames.filter((frame) => frame.clears > clears);
    assert.equal(player.ends, 0, "replacing a transport does not end the publication");
    assert.equal(player.clears, clears + 1);
    assert.equal(resumed[0]!.at, second.origin + 150_000);
    assert.ok(
      resumed.every(
        (frame) => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === -16384,
      ),
    );
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.player.error, null);
  },
);
