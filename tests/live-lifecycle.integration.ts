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
// Its right channel counts the 5 ms PCM chunks (240 samples), so a listener's chunk says which it is.
const counted =
  (level: number) =>
  (position: number, channel: number): number =>
    channel ? Math.floor(position / 240) / 32768 : level;
type Frame = { at: number; bytes: Buffer };
// How long after its capture each counted frame plays, by its count rather than its place
// among the frames received: one the host skipped under load doesn't shift the others.
const delays = (frames: Frame[], origin = 0) =>
  frames.map((frame) => frame.at - origin - frame.bytes.readInt16LE(2) * 5_000);
// Where a listener's delay changes: it moved to another step.
const moves = (frames: Frame[]) =>
  delays(frames).flatMap((delay, i, all) => (i && delay !== all[i - 1] ? [i] : []));

async function fixture(t: TestContext) {
  const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
  const clients: SendspinClient[] = [];
  t.after(async () => {
    await Promise.all(clients.map((client) => client.disconnect()));
    await f.close();
  });
  const host = await f.connect(-1);
  // minBufferMs null: a player that never declares one (the Node SDK always does, so it's left out).
  const listener = async (
    index: number,
    codec = AudioCodec.PCM,
    minBufferMs: number | null = 150,
  ) => {
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
    if (minBufferMs === null) {
      const declaring = client as unknown as { fullPlayerState(): Record<string, unknown> };
      const full = declaring.fullPlayerState.bind(client);
      declaring.fullPlayerState = () => ({ ...full(), min_buffer_ms: undefined });
    }
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
    if (minBufferMs !== null) await client.sendPlayerState({ min_buffer_ms: minBufferMs });
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
  "each Receiver plays at its own step; one Receiver's need, or its leaving, moves nobody else",
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
    const input = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    await until(() => Math.min(fast.frames.length, slow.frames.length) > 20);
    // Each hears nothing until Core has measured the input side, then starts at its step.
    assert.deepEqual(moves(fast.frames), []);
    assert.deepEqual(moves(slow.frames), []);
    const [fastStep] = delays(fast.frames, input.origin),
      [slowStep] = delays(slow.frames, input.origin);
    // 65 ms, and 150 + 10 ms of Sync, each with the input side, rounded up to a whole step.
    assert.ok(fastStep! > 65_000 && fastStep! % 5_000 === 0, `its own step, not ${fastStep} µs`);
    assert.ok(slowStep! >= fastStep! + 75_000 && slowStep! % 5_000 === 0, `not ${slowStep} µs`);
    assert.ok(
      [...fast.frames, ...slow.frames].every((frame) => frame.bytes.readInt16LE(0) === 8192),
      "the same samples, stamped by each listener's step",
    );

    await fast.client.sendPlayerState({ min_buffer_ms: 205 });
    await until(() => moves(fast.frames).length > 0);
    assert.deepEqual(moves(slow.frames), [], "one Receiver's need moves nobody else");

    assert.equal(
      (await f.receiver.command({ type: "leave", playbackId: f.receiver.state.player.playbackId! }))
        .ok,
      true,
    );
    const before = slow.frames.length;
    await until(() => slow.frames.length > before + 20);
    assert.deepEqual(moves(slow.frames), [], "leaving moves nobody else");
  },
);

test(
  "a listener that connects again starts at its new need, not the step its last session reached",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.listener(1, AudioCodec.PCM, 205);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    const input = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    await until(() => first.frames.length > 20);
    const earlier = delays(first.frames, input.origin)[0]!;
    // A reloaded page: its player starts again with no late steps and declares only its need.
    await first.client.disconnect();
    const again = await f.listener(1, AudioCodec.PCM, 65);
    await until(() => again.frames.length > 20);
    const step = delays(again.frames, input.origin).at(-1)!;
    assert.ok(step <= earlier - 100_000, `its new step, not ${step} µs after ${earlier} µs`);
  },
);

test(
  "two Live shares keep distinct samples, audiences and buffers when one publisher crashes",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      secondHost = await f.connect(-1),
      other = await f.connect(2);
    const first = await f.listener(1, AudioCodec.PCM, 100),
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
    const input = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    const otherInput = await f.streamCapture(secondHost, "other-concert", -1, counted(-0.5));
    await until(() => Math.min(first.frames.length, second.frames.length) > 20);
    assert.notEqual(f.receiver.state.playback, other.state.playback);
    assert.deepEqual(
      f.receiver.state.outputs?.map((output) => output.deviceId),
      [f.receiver.id],
    );
    assert.deepEqual(
      other.state.outputs?.map((output) => output.deviceId),
      [other.id],
    );
    const firstStep = delays(first.frames, input.origin)[0]!,
      step = delays(second.frames, otherInput.origin).at(-1)!;
    assert.deepEqual(moves(first.frames), []);
    assert.ok(firstStep < 400_000, "another share's larger buffer does not delay this audience");
    assert.ok(step > 400_000 && step % 5_000 === 0, `its own step, not ${step} µs`);
    assert.ok(first.frames.every((frame) => frame.bytes.readInt16LE(0) === 8192));
    assert.ok(second.frames.every((frame) => frame.bytes.readInt16LE(0) === -16384));
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
    assert.deepEqual(moves(second.frames.slice(before - 1)), []);
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
  "a listener measures before it plays, then plays at its own step, and the Playback waits for audio until one plays",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      other = await f.connect(2),
      // Couch's own listener declares nothing until it has measured its output and how late its
      // chunks arrive.
      measuring = await f.listener(2, AudioCodec.PCM, 0);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id })).ok,
      true,
    );
    const input = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    // It gets every chunk to measure, stamped a second past the input side, and plays none: the
    // Playback still waits for audio.
    await until(() => measuring.frames.length > 200);
    assert.deepEqual(moves(measuring.frames), []);
    const measured = delays(measuring.frames, input.origin)[0]!;
    assert.ok(measured > 1_000_000 && measured % 5_000 === 0, `not ${measured} µs`);
    assert.ok(
      other.state.player.status !== "playing" || other.state.player.buffering,
      "nobody plays yet",
    );
    const listener = await f.listener(1, AudioCodec.PCM, 65);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    await until(() => listener.frames.length > 20);
    assert.deepEqual(moves(listener.frames), []);
    const step = delays(listener.frames, input.origin)[0]!;
    assert.ok(step > 65_000 && step % 5_000 === 0, `its own step, not ${step} µs`);
    await until(
      () => f.receiver.state.player.status === "playing" && !f.receiver.state.player.buffering,
    );
    // It declares its need: Core clears what it measured, and the same need plays together.
    const clears = measuring.clears;
    await measuring.client.sendPlayerState({ min_buffer_ms: 65 });
    await until(() => measuring.frames.filter((frame) => frame.clears > clears).length > 20);
    assert.equal(measuring.clears, clears + 1);
    const placed = measuring.frames.filter((frame) => frame.clears > clears);
    assert.deepEqual(moves(placed), []);
    assert.equal(delays(placed, input.origin)[0], step);
    // Its first sound is announced: its output no longer joins.
    await until(
      () =>
        other.state.playbacks
          ?.flatMap((playback) => playback.outputs)
          .find((output) => output.deviceId === other.id)?.state === "playing",
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
    await f.streamCapture(f.host, "concert", -1, () => -0.5);
    await until(() => player.frames.filter((frame) => frame.clears > clears).length > 20);
    const resumed = player.frames.filter((frame) => frame.clears > clears);
    assert.equal(player.ends, 0, "replacing a transport does not end the publication");
    assert.equal(player.clears, clears + 1);
    assert.ok(
      resumed.every(
        (frame) => frame.bytes.readInt16LE(0) === -16384 && frame.bytes.readInt16LE(2) === -16384,
      ),
    );
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.player.error, null);
  },
);

test(
  "a player that declares no buffer plays at Core's input side",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      player = await f.listener(1, AudioCodec.PCM, null);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    const input = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    await until(() => player.frames.length > 20);
    const step = delays(player.frames, input.origin)[0]!;
    assert.ok(step > 0 && step % 5_000 === 0, `a step for its input side, not ${step} µs`);
  },
);

test(
  "a replaced upload keeps each listener at its step while Core measures again",
  { timeout: 15_000 },
  async (t) => {
    const f = await fixture(t),
      player = await f.listener(1, AudioCodec.PCM, 65);
    assert.equal((await f.host.command(publication)).ok, true);
    assert.equal(
      (await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id }))
        .ok,
      true,
    );
    const first = await f.streamCapture(f.host, "concert", -1, counted(0.25));
    await until(() => player.frames.length > 20);
    const step = delays(player.frames, first.origin)[0]!,
      clears = player.clears;
    const closed = once(first.upload, "close");
    first.upload.terminate();
    await closed;
    const second = await f.streamCapture(f.host, "concert", -1, counted(-0.25));
    await until(() => player.frames.filter((frame) => frame.clears > clears).length > 20);
    const resumed = player.frames.filter((frame) => frame.clears > clears);
    // At 0 every chunk would be late: without the last input side it hears nothing
    // until the new one is measured, about two seconds (400 chunks of 5 ms).
    assert.ok(resumed[0]!.bytes.readInt16LE(2) < 120, "it resumes with the new capture's start");
    assert.equal(delays(resumed, second.origin)[0], step);
  },
);
