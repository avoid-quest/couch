import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import {
  AudioCodec,
  Identity,
  Roles,
  SendspinClient,
  serverNowUs,
} from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { createPassThrough } from "../src/server/pass-through";
import type { PlayerState } from "../src/shared/protocol";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean, message: string, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Core and a WAV server for one test: receivers connect as Sendspin players with the codec they ask for.
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-ahead-"));
  const clients: SendspinClient[] = [];
  const keys = [Identity.generate(), Identity.generate()];
  const core = createSendspin({
    name: "Ahead fixture",
    admit: (id) => keys.some((key) => key.peerId === id),
    changed: () => {},
    ffmpeg: async () => ffmpeg,
  });
  const group = core.group("ahead", () => {});
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "audio/wav");
    response.end(readFileSync(join(directory, "tone.wav")));
  });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  t.after(async () => {
    group.close();
    core.close();
    await Promise.all(clients.map((client) => client.disconnect()));
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "30",
      "-ac",
      "2",
      join(directory, "tone.wav"),
    ],
    { stdio: "pipe" },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  async function receiver(index: number, codec: AudioCodec, capacity: number, interval: number) {
    const key = keys[index]!,
      frames: { timestamp: number; bytes: Buffer }[] = [],
      streams: string[] = [];
    let most = 0;
    const client = new SendspinClient(key.peerId, `Receiver ${index}`, [Roles.PLAYER], {
      playerSupport: {
        supported_formats: [{ codec, channels: 2, sample_rate: 48_000, bit_depth: 16 }],
        buffer_capacity: capacity,
        supported_commands: [],
      },
    });
    clients.push(client);
    client.addStreamStartListener(() => streams.push("start"));
    client.addStreamClearListener(() => streams.push("clear"));
    client.addStreamEndListener(() => streams.push("end"));
    client.addAudioChunkListener((timestamp, bytes) => {
      frames.push({ timestamp, bytes: Buffer.from(bytes) });
      // Held: chunks not yet played, with their 13-byte headers. A PCM chunk is 100 ms; Opus here is 60 ms.
      const now = serverNowUs();
      most = Math.max(
        most,
        frames.reduce(
          (sum, frame) => (frame.timestamp + interval > now ? sum + frame.bytes.length + 13 : sum),
          0,
        ),
      );
    });
    await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
    return {
      id: key.peerId,
      frames,
      streams,
      get most() {
        return most;
      },
    };
  }
  return { group, source: `${origin}/tone.wav`, receiver };
}
const skip = !available && "Set COUCH_TEST_FFMPEG to run the send-ahead test.";

// A locked Android phone runs its page's timers late and its Wi-Fi dozes. Speakers must hold
// seconds of sound, not one, and a speaker that joins late gets that sound too. A speaker never
// holds more than its buffer_capacity: 512 KiB is under 3 s of PCM.
const cases = [
  { codec: AudioCodec.OPUS, capacity: 2_000_000, lead: 5_000_000, interval: 60_000 },
  { codec: AudioCodec.PCM, capacity: 512 * 1024, lead: 2_000_000, interval: 100_000 },
];
for (const { codec, capacity, lead, interval } of cases)
  test(
    `synced ${codec} goes out seconds ahead, also to a late speaker`,
    { timeout: 20_000, skip },
    async (t) => {
      const { group, source, receiver } = await fixture(t);
      const first = await receiver(0, codec, capacity, interval);
      group.members([{ deviceId: first.id, level: 100 }]);
      group.send({ type: "load", playbackId: "ahead", source });
      await until(
        () => (first.frames.at(-1)?.timestamp ?? 0) - serverNowUs() > lead,
        "Speakers were not sent sound seconds ahead",
      );
      await until(
        () => serverNowUs() > first.frames[0]!.timestamp + 1_000_000,
        "The first speaker never started playing",
      );

      const second = await receiver(1, codec, capacity, interval);
      const joinedAt = serverNowUs();
      group.members([
        { deviceId: first.id, level: 100 },
        { deviceId: second.id, level: 100 },
      ]);
      await until(
        () => (second.frames.at(-1)?.timestamp ?? 0) - serverNowUs() > lead,
        "A late speaker was not sent the sound others hold",
      );
      assert.ok(
        second.frames[0]!.timestamp - joinedAt < 500_000,
        "a late speaker must start with the sound that plays next",
      );
      const original = new Map(first.frames.map((frame) => [frame.timestamp, frame.bytes]));
      for (const frame of second.frames)
        assert.deepEqual(
          original.get(frame.timestamp),
          frame.bytes,
          "both speakers must receive identical samples with identical play times",
        );
      for (let index = 1; index < second.frames.length; index++)
        assert.equal(
          second.frames[index]!.timestamp - second.frames[index - 1]!.timestamp,
          interval,
          "a late speaker's sound must have no gap",
        );
      for (const speaker of [first, second])
        assert.ok(
          speaker.most <= capacity,
          `a speaker held ${speaker.most} bytes, over its ${capacity}`,
        );
      t.diagnostic(
        `lead ${((first.frames.at(-1)!.timestamp - serverNowUs()) / 1e6).toFixed(1)} s; late speaker started ${((second.frames[0]!.timestamp - joinedAt) / 1e3).toFixed(0)} ms after joining`,
      );
    },
  );

for (const source of [
  "buffered WAV",
  "mixed buffered WAV",
  "stalled HLS",
  "disconnected WAV",
  "disconnected HLS",
  "private disconnected HLS",
  "unrecoverable HLS",
  "forbidden HLS",
])
  test(
    ["unrecoverable HLS", "forbidden HLS"].includes(source)
      ? `${source} reports failure and can be retried`
      : `${source} resumes its sound and picture clock without losing media`,
    { timeout: 30_000, skip: !available && "Set COUCH_TEST_FFMPEG to run the buffering test." },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-buffering-"));
      const hls = source.endsWith("HLS");
      const disconnectedHls = hls && source !== "stalled HLS";
      const unrecoverable = source === "unrecoverable HLS";
      const forbidden = source === "forbidden HLS";
      const publicNetwork = disconnectedHls && source !== "private disconnected HLS";
      const filename = hls ? "tone.m3u8" : "tone.wav";
      execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "10",
        "-ac",
        "2",
        ...(hls
          ? [
              "-c:a",
              "aac",
              "-f",
              "hls",
              "-hls_time",
              "1",
              "-hls_list_size",
              "0",
              "-hls_segment_filename",
              join(directory, "segment%02d.ts"),
            ]
          : []),
        join(directory, filename),
      ]);
      const key = Identity.generate();
      const opusKey = Identity.generate();
      let opus: SendspinClient | undefined;
      let opusFrames = 0;
      const frames: { timestamp: number; bytes: Buffer }[] = [];
      const states: (PlayerState & { at: number })[] = [];
      let release: (() => void) | undefined;
      const heldResponses: (() => void)[] = [];
      let heldAt = 0;
      let recovered = false;
      const server = createServer((request, response) => {
        const path = new URL(request.url!, "http://localhost").pathname.slice(1);
        const media = readFileSync(join(directory, path));
        if (forbidden && !recovered && path === "segment06.ts") {
          const reject = () => response.writeHead(403).end("Source expired");
          if (!heldAt) {
            heldAt = Date.now();
            release = reject;
          } else reject();
          return;
        }
        response.setHeader(
          "Content-Type",
          path.endsWith(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : hls
              ? "video/mp2t"
              : "audio/wav",
        );
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("ETag", JSON.stringify(path));
        const from = unrecoverable
          ? 0
          : Number(/^bytes=(\d+)-/.exec(request.headers.range ?? "")?.[1] ?? 0);
        response.setHeader("Content-Length", media.length - from);
        if (request.headers.range && !unrecoverable) {
          response.statusCode = 206;
          response.setHeader("Content-Range", `bytes ${from}-${media.length - 1}/${media.length}`);
        }
        if (
          (hls || request.headers["user-agent"]?.startsWith("Lavf")) &&
          (!heldAt || (!hls && !recovered)) &&
          (!hls || path === "segment06.ts")
        ) {
          heldAt ||= Date.now();
          // Six seconds lets FFmpeg finish probing, then its decoded sound runs out.
          // A partial TS response must reach the decoder before its socket drops.
          const prefix = disconnectedHls ? 24 * 188 : hls ? 0 : 6 * 192_000;
          response.flushHeaders();
          response.write(media.subarray(from, prefix));
          heldResponses.push(() => {
            if (response.destroyed) return;
            if (source === "disconnected WAV" || disconnectedHls) response.destroy();
            else if (source === "mixed buffered WAV") {
              response.write(media.subarray(prefix, 6.2 * 192_000));
              setTimeout(() => response.write(media.subarray(6.2 * 192_000, 6.4 * 192_000)), 800);
              setTimeout(() => response.end(media.subarray(6.4 * 192_000)), 1_600);
            } else response.end(media.subarray(prefix));
          });
          // FFmpeg may reopen a WAV after probing its header; that range must stall too.
          release = () => {
            recovered = true;
            for (const finish of heldResponses) finish();
          };
        } else response.end(media.subarray(from));
      });
      const core = createSendspin({
        name: "Buffering fixture",
        admit: (id) => id === key.peerId || id === opusKey.peerId,
        changed: () => {},
        ffmpeg: async () => ffmpeg,
      });
      // The fixture supplies local upstream media; the real relay and FFmpeg proxy still run.
      const relay = disconnectedHls ? createPassThrough(() => true, fetch) : undefined;
      const group = core.group("buffering", (state) =>
        states.push({ ...state, at: serverNowUs() }),
      );
      const sockets = new WebSocketServer({ server, path: "/sendspin" });
      sockets.on("connection", (socket, request) => core.accept(socket, request));
      const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER], {
        playerSupport: {
          supported_formats: [
            { codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 },
          ],
          buffer_capacity: 2_000_000,
          supported_commands: [],
        },
      });
      client.addAudioChunkListener((timestamp, bytes) =>
        frames.push({ timestamp, bytes: Buffer.from(bytes) }),
      );
      t.after(async () => {
        group.close();
        await client.disconnect();
        await opus?.disconnect();
        await core.close();
        await relay?.close();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const origin = `http://127.0.0.1:${address.port}`;
      await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
      if (source === "mixed buffered WAV") {
        opus = new SendspinClient(opusKey.peerId, "Opus receiver", [Roles.PLAYER], {
          playerSupport: {
            supported_formats: [
              { codec: AudioCodec.OPUS, channels: 2, sample_rate: 48_000, bit_depth: 16 },
            ],
            buffer_capacity: 2_000_000,
            supported_commands: [],
          },
        });
        opus.addAudioChunkListener(() => opusFrames++);
        opus.addStreamStartListener((message) =>
          assert.equal(message.payload.player?.codec, AudioCodec.OPUS),
        );
        await opus.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
      }
      group.members([
        { deviceId: key.peerId, level: 100 },
        ...(opus ? [{ deviceId: opusKey.peerId, level: 100 }] : []),
      ]);
      const media = relay
        ? await relay.prepare(
            "buffering",
            { source: `${origin}/${filename}`, publicNetwork },
            {},
            { origin: await relay.coreOrigin(), userAgent: "Couch" },
            AbortSignal.timeout(3_000),
            true,
          )
        : { source: `${origin}/${filename}` };
      group.send({
        type: "load",
        playbackId: "buffering",
        ...media,
        publicNetwork,
      });
      await until(() => frames.length > 0, "No sound arrived before the source stalled");
      await until(
        () => states.some((state) => state.buffering && state.position > 0),
        "The stalled source never entered buffering",
        8_000,
      );
      const stalled = states.at(-1)!;
      const boundary = frames.length;
      if (source === "stalled HLS") {
        // An eleven-second read stall must preserve the whole segment.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, heldAt + 11_000 - Date.now())),
        );
      }
      release!();
      if (unrecoverable || forbidden) {
        await until(
          () => ["ended", "error"].includes(states.at(-1)!.status),
          "The interrupted programme neither ended nor reported an error",
          8_000,
        );
        assert.equal(states.at(-1)!.status, "error", "An unreadable segment must not be skipped");
        assert.equal(states.at(-1)!.buffering, false);
        recovered = true;
        group.send({ type: "load", playbackId: "retry", ...media, publicNetwork });
        await until(
          () => states.at(-1)?.playbackId === "retry" && states.at(-1)?.status === "playing",
          "The failed programme could not be retried",
        );
        return;
      }
      await until(() => frames.length > boundary, "The source never supplied its remaining sound");
      const resumedAt = frames[boundary]!.timestamp;
      await until(
        () => states.at(-1)?.status === "playing",
        "The buffered programme never resumed playing",
      );
      const recovery = states.filter((state) => state.at >= stalled.at);
      assert.ok(
        recovery.every(
          (state, index) => state.position >= (recovery[index - 1]?.position ?? stalled.position),
        ),
        "Buffering recovery must not rewind the shared picture clock",
      );
      assert.ok(
        recovery.every((state) => state.status !== "playing" || state.at >= resumedAt),
        "The picture clock must stay stopped until resumed sound starts playing",
      );
      const expected = execFileSync(
        ffmpeg,
        ["-v", "error", "-i", join(directory, filename), "-f", "s16le", "pipe:1"],
        { maxBuffer: 4_000_000 },
      );
      await until(
        () => frames.reduce((bytes, frame) => bytes + frame.bytes.length, 0) >= expected.length,
        "The source lost sound while recovering",
      );
      assert.ok(
        Buffer.concat(frames.map((frame) => frame.bytes)).equals(expected),
        "All source samples must survive buffering exactly once",
      );
      if (opus) assert.ok(opusFrames > 0, "Both wire formats must participate in recovery");
      await until(() => states.at(-1)?.status === "ended", "The recovered programme never ended");
      const completeRecovery = states.filter((state) => state.at >= stalled.at);
      assert.ok(
        completeRecovery.every(
          (state, index) =>
            state.position >= (completeRecovery[index - 1]?.position ?? stalled.position),
        ),
        `The recovered clock must never rewind: ${completeRecovery.map((state) => state.position).join(", ")}`,
      );
      if (opus)
        for (const state of completeRecovery) {
          let heard = 0;
          for (const frame of frames) {
            if (state.at < frame.timestamp) break;
            const duration = frame.bytes.length / 192_000;
            const elapsed = (state.at - frame.timestamp) / 1e6;
            heard += Math.min(elapsed, duration);
            if (elapsed < duration) break;
          }
          // A buffered picture corrects errors above 25 ms; codec boundaries must not trigger it.
          assert.ok(
            Math.abs(state.position - heard) < 0.025,
            `The picture clock was ${state.position} while its sound was ${heard}`,
          );
        }
      assert.ok(
        Math.abs(states.at(-1)!.position - expected.length / 192_000) < 0.001,
        `Completion must report the final sound position: ${states.at(-1)!.position} != ${expected.length / 192_000}, duration ${states.at(-1)!.duration}`,
      );
    },
  );
// Firefox's player takes only PCM. Joining a Playback whose speakers take Opus must not restart their sound.
test(
  "a PCM speaker joins without restarting an Opus speaker",
  { timeout: 20_000, skip },
  async (t) => {
    const { group, source, receiver } = await fixture(t);
    const opus = await receiver(0, AudioCodec.OPUS, 2_000_000, 60_000);
    group.members([{ deviceId: opus.id, level: 100 }]);
    group.send({ type: "load", playbackId: "wires", source });
    await until(
      () => !!opus.frames.length && serverNowUs() > opus.frames[0]!.timestamp + 1_000_000,
      "The Opus speaker never started playing",
    );
    const pcm = await receiver(1, AudioCodec.PCM, 512 * 1024, 100_000);
    group.members([
      { deviceId: opus.id, level: 100 },
      { deviceId: pcm.id, level: 100 },
    ]);
    await until(
      () => !!pcm.frames.length && serverNowUs() > pcm.frames[0]!.timestamp + 1_000_000,
      "The PCM speaker never started playing",
    );
    for (let index = 1; index < opus.frames.length; index++)
      assert.equal(
        opus.frames[index]!.timestamp - opus.frames[index - 1]!.timestamp,
        60_000,
        "the Opus speaker's sound must run on, never restart",
      );
  },
);

// Clearing paused sound keeps the phone's audio element alive; Stop still ends the stream.
test(
  "pause clears buffered sound without ending the stream, and Stop ends it",
  { timeout: 20_000, skip },
  async (t) => {
    const { group, source, receiver } = await fixture(t);
    const speaker = await receiver(0, AudioCodec.OPUS, 2_000_000, 60_000);
    group.members([{ deviceId: speaker.id, level: 100 }]);
    group.send({ type: "load", playbackId: "pause", source });
    await until(() => speaker.frames.length > 0, "The speaker never got sound");
    group.send({ type: "pause", playbackId: "pause", paused: true });
    await until(() => speaker.streams.includes("clear"), "Pausing never cleared buffered sound");
    const pausedFrames = speaker.frames.length;
    group.send({ type: "pause", playbackId: "pause", paused: false });
    await until(() => speaker.frames.length > pausedFrames, "Playing again never supplied sound");
    // The SDK treats another start on an active stream as a format update.
    assert.deepEqual(speaker.streams, ["start", "clear"]);
    group.send({ type: "stop", playbackId: "pause" });
    await until(() => speaker.streams.includes("end"), "Stop never ended the stream");
    assert.deepEqual(speaker.streams, ["start", "clear", "end"]);
  },
);
