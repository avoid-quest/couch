import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import {
  AudioCodec,
  Identity,
  Roles,
  SendspinClient,
  type SessionUpdateMetadata,
} from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Real HLS decoding and encrypted Sendspin clients: these assertions lock the shared
// media clock, not just output routing. No sound is emitted by these SDK receivers.
for (const codec of [AudioCodec.PCM, AudioCodec.OPUS])
  test(
    `live ${codec} shares audio timestamps and picture PTS across joins`,
    {
      timeout: 20_000,
      skip: !available && "Set COUCH_TEST_FFMPEG to run the real-media clock test.",
    },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), "couch-live-clock-"));
      const clients: SendspinClient[] = [];
      const keys = [Identity.generate(), Identity.generate()];
      const core = createSendspin({
        name: "Clock fixture",
        admit: (id) => keys.some((key) => key.peerId === id),
        changed: () => {},
        ffmpeg: async () => ffmpeg,
      });
      const group = core.group("live-clock", () => {});
      const server = createServer((request, response) => {
        const name = new URL(request.url!, "http://localhost").pathname.slice(1);
        if (!/^(?:index\.m3u8|segment\d+\.ts)$/.test(name)) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader(
          "Content-Type",
          name.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
        );
        response.end(readFileSync(join(directory, name)));
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
      // A nonzero source timestamp catches pictures incorrectly anchored to zero. The
      // fixture has real video and stereo audio in the same MPEG-TS presentation clock.
      execFileSync(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=64x64:rate=10",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000",
          "-t",
          "12",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "10",
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-output_ts_offset",
          "7",
          "-f",
          "hls",
          "-hls_time",
          "1",
          "-hls_list_size",
          "0",
          "-hls_segment_filename",
          join(directory, "segment%d.ts"),
          join(directory, "index.m3u8"),
        ],
        { stdio: "pipe" },
      );
      // One probe per stream: a joint probe can stop at the first video frame before audio's is logged.
      const firstPts = (filter: "showinfo" | "ashowinfo") => {
        const stream = filter === "showinfo" ? "v" : "a";
        const probe = spawnSync(
          ffmpeg,
          [
            "-hide_banner",
            "-copyts",
            "-i",
            join(directory, "segment0.ts"),
            "-map",
            `0:${stream}`,
            `-${stream}f`,
            filter,
            `-frames:${stream}`,
            "1",
            "-f",
            "null",
            "-",
          ],
          { encoding: "utf8" },
        );
        assert.equal(probe.status, 0, probe.stderr);
        const match = new RegExp(`Parsed_${filter}.*?\\bn:\\s*0\\s.*?pts_time:([\\d.]+)`).exec(
          probe.stderr,
        );
        assert.ok(match, `Missing ${filter} source timestamp`);
        return Number(match[1]);
      };
      const audioPts = firstPts("ashowinfo"),
        videoPts = firstPts("showinfo");
      assert.ok(
        audioPts > 7 && Math.abs(videoPts - audioPts) < 0.05,
        "fixture audio/video must share a nonzero presentation clock",
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const origin = `http://127.0.0.1:${address.port}`;
      async function receiver(index: number) {
        const key = keys[index]!;
        const frames: { timestamp: number; bytes: Buffer }[] = [],
          metadata: SessionUpdateMetadata[] = [],
          groups: string[] = [];
        let starts = 0,
          ends = 0,
          clears = 0;
        const client = new SendspinClient(
          key.peerId,
          `Receiver ${index}`,
          [Roles.PLAYER, Roles.METADATA],
          {
            playerSupport: {
              supported_formats: [{ codec, channels: 2, sample_rate: 48_000, bit_depth: 16 }],
              buffer_capacity: 2_000_000,
              supported_commands: [],
            },
          },
        );
        clients.push(client);
        client.addAudioChunkListener((timestamp, bytes) =>
          frames.push({ timestamp, bytes: Buffer.from(bytes) }),
        );
        client.addMetadataListener((payload) => {
          if (payload.metadata) metadata.push(payload.metadata);
        });
        client.addGroupUpdateListener((payload) => {
          if (payload.group_id) groups.push(payload.group_id);
        });
        client.addStreamStartListener(() => starts++);
        client.addStreamEndListener(() => ends++);
        client.addStreamClearListener(() => clears++);
        await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
        return {
          id: key.peerId,
          frames,
          metadata,
          groups,
          get starts() {
            return starts;
          },
          get ends() {
            return ends;
          },
          get clears() {
            return clears;
          },
        };
      }
      const first = await receiver(0);
      group.members([{ deviceId: first.id, level: 100 }]);
      group.screens([first.id]);
      group.send({
        type: "load",
        playbackId: "live-clock",
        source: `${origin}/index.m3u8`,
        live: true,
      });
      await until(() => first.frames.length >= 15, "First receiver received no decoded audio");
      assert.ok(
        first.frames.some((frame) => frame.bytes.some((byte) => byte !== 0)),
        "real fixture must contain audible samples",
      );
      const second = await receiver(1);
      const both = [
        { deviceId: first.id, level: 100 },
        { deviceId: second.id, level: 50 },
      ];
      group.members(both);
      group.screens([first.id, second.id]);
      await until(
        () =>
          second.frames.length >= 8 &&
          first.frames.at(-1)!.timestamp >= second.frames.at(-1)!.timestamp &&
          [first, second].every((receiver) =>
            receiver.metadata.some((item) => item.progress?.playback_speed === 1000),
          ),
        "Late receiver did not join the live clock",
      );
      const assertShared = () => {
        const original = new Map(first.frames.map((frame) => [frame.timestamp, frame.bytes]));
        for (const frame of second.frames)
          assert.deepEqual(
            original.get(frame.timestamp),
            frame.bytes,
            "both devices must receive identical samples with identical play times",
          );
        assert.equal(first.groups.at(-1), "live-clock");
        assert.equal(second.groups.at(-1), "live-clock");
      };
      assertShared();
      // Metadata's timestamp maps picture PTS to exactly the audio packet clock.
      // Opus's initial decoder pre-skip is below this 30 ms bound; PCM has no pre-skip.
      for (const receiver of [first, second]) {
        const point = receiver.metadata.findLast((item) => item.progress?.playback_speed === 1000)!;
        const expectedPts = audioPts + (point.timestamp - first.frames[0]!.timestamp) / 1_000_000;
        assert.ok(
          Math.abs(point.progress!.track_progress / 1000 - expectedPts) < 0.03,
          "picture metadata must track source PTS on the shared audio clock",
        );
      }
      group.members(both.slice(0, 1));
      await until(() => second.ends === 1, "Leaving receiver was not stopped");
      // The fixture is shorter than Core's send-ahead, so the remaining receiver already holds it all.
      const leftAt = second.frames.length;
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(first.ends, 0, "Remaining receiver stopped when another left");
      assert.equal(second.frames.length, leftAt);
      group.members(both);
      await until(
        () =>
          second.frames.length >= leftAt + 5 &&
          first.frames.at(-1)!.timestamp >= second.frames.at(-1)!.timestamp,
        "Returning receiver did not rejoin",
      );
      assertShared();
      assert.equal(first.starts, 1, "membership changes must not restart existing sound");
      assert.equal(first.clears, 0, "membership changes must not reset the shared clock");
      assert.equal(second.starts, 2);
      const interval = codec === AudioCodec.PCM ? 100_000 : 60_000;
      for (let index = 1; index < first.frames.length; index++)
        assert.equal(
          first.frames[index]!.timestamp - first.frames[index - 1]!.timestamp,
          interval,
          "the existing receiver's clock must remain continuous across joins",
        );
      const pictureBefore = first.metadata.at(-1)!.progress!.track_progress;
      const metadataBefore = first.metadata.length;
      group.members([]);
      await until(
        () => (first.metadata.at(-1)?.progress?.track_progress ?? 0) > pictureBefore + 100,
        "Pictures lost their timeline when all speakers left",
      );
      assert.equal(first.metadata.at(-1)!.progress!.playback_speed, 1000);
      assert.ok(
        first.metadata
          .slice(metadataBefore)
          .filter((item) => item.progress)
          .every((item) => item.progress!.playback_speed === 1000),
        "removing the last speaker must not pause the pictures' running clock",
      );
      t.diagnostic(
        `${codec}: ${first.frames.length} original / ${second.frames.length} joined packets matched; source audio PTS ${audioPts}s, video PTS ${videoPts}s; shared metadata stayed within 30 ms.`,
      );
    },
  );

// Plays index.m3u8 from `directory` as an endless stream to one PCM speaker and screen: whether it
// hears sound at a given second of the shared timeline, and the clock its pictures were sent.
async function heard(t: TestContext, directory: string, seconds: number) {
  const key = Identity.generate();
  const core = createSendspin({
    name: "Stream fixture",
    admit: (id) => id === key.peerId,
    changed: () => {},
    ffmpeg: async () => ffmpeg,
  });
  const group = core.group("stream", () => {});
  const server = createServer((request, response) => {
    const name = new URL(request.url!, "http://localhost").pathname.slice(1);
    if (!/^[\w-]+\.(?:m3u8|m4s|mp4|ts)$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    response.end(readFileSync(join(directory, name)));
  });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  const frames: { timestamp: number; bytes: Buffer }[] = [];
  const metadata: SessionUpdateMetadata[] = [];
  const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER, Roles.METADATA], {
    playerSupport: {
      supported_formats: [
        { codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 },
      ],
      buffer_capacity: 2_000_000,
      supported_commands: [],
    },
  });
  t.after(async () => {
    group.close();
    core.close();
    await client.disconnect();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  client.addAudioChunkListener((timestamp, bytes) =>
    frames.push({ timestamp, bytes: Buffer.from(bytes) }),
  );
  client.addMetadataListener((payload) => {
    if (payload.metadata) metadata.push(payload.metadata);
  });
  await client.connect(`ws://127.0.0.1:${address.port}/sendspin`, { timeoutMs: 3_000 });
  group.members([{ deviceId: key.peerId, level: 100 }]);
  group.screens([key.peerId]);
  group.send({
    type: "load",
    playbackId: "stream",
    source: `http://127.0.0.1:${address.port}/index.m3u8`,
    live: true,
  });
  await until(
    () => frames.length >= 2 && frames.at(-1)!.timestamp - frames[0]!.timestamp >= seconds * 1e6,
    "The stream's last segment never played",
  );
  const audible = (second: number) =>
    frames
      .find(
        (frame) =>
          frame.timestamp - frames[0]!.timestamp <= second * 1e6 &&
          frame.timestamp - frames[0]!.timestamp + 100_000 > second * 1e6,
      )!
      .bytes.some((byte) => byte !== 0);
  return { audible, metadata };
}
const tone = (directory: string, name: string, frequency: number, offset: number, fmp4: boolean) =>
  execFileSync(
    ffmpeg,
    [
      ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
      ...["-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${fmp4 ? 6 : 2}`],
      ...["-c:a", "aac", "-ac", "2", "-output_ts_offset", String(offset)],
      ...(fmp4
        ? [
            ...["-f", "hls", "-hls_time", "2", "-hls_segment_type", "fmp4", "-hls_list_size", "0"],
            ...["-hls_segment_filename", join(directory, `${name}%d.m4s`)],
            ...["-hls_fmp4_init_filename", `${name}-init.mp4`, join(directory, `${name}.m3u8`)],
          ]
        : ["-f", "mpegts", join(directory, `${name}.ts`)]),
    ],
    { stdio: "pipe" },
  );
const playlist = (directory: string, lines: string[]) =>
  writeFileSync(
    join(directory, "index.m3u8"),
    ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:2", ...lines, ""].join("\n"),
  );

// A Twitch ad: fMP4 segments whose timestamps restart lower, which FFmpeg's HLS reader drops. The
// shared sound keeps the source's time: silence where the ad was, then the programme at its own time.
test(
  "an endless stream keeps the source's time across an ad FFmpeg drops",
  {
    timeout: 20_000,
    skip: !available && "Set COUCH_TEST_FFMPEG to run the real-media clock test.",
  },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "couch-stream-ad-"));
    tone(directory, "programme", 440, 7, true);
    tone(directory, "ad", 880, 0, true);
    // The ad replaces the programme's second segment, as Twitch's stitched ads do.
    playlist(directory, [
      '#EXT-X-MAP:URI="programme-init.mp4"',
      ...["#EXTINF:2.0,", "programme0.m4s", "#EXT-X-DISCONTINUITY"],
      ...['#EXT-X-MAP:URI="ad-init.mp4"', "#EXTINF:2.0,", "ad0.m4s", "#EXT-X-DISCONTINUITY"],
      ...['#EXT-X-MAP:URI="programme-init.mp4"', "#EXTINF:2.0,", "programme2.m4s"],
      "#EXT-X-ENDLIST",
    ]);
    const { audible } = await heard(t, directory, 5.8);
    assert.ok(audible(1), "the programme plays before the ad");
    assert.ok(!audible(3), "the ad's time is silence");
    assert.ok(audible(5), "the programme returns at its own time, two seconds later");
  },
);

// An encoder restart sends timestamps back: every sample still plays, in order, and a gap after it
// is still silence.
test(
  "an endless stream whose timestamps go back keeps all of its sound and later gaps",
  {
    timeout: 20_000,
    skip: !available && "Set COUCH_TEST_FFMPEG to run the real-media clock test.",
  },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "couch-stream-restart-"));
    tone(directory, "before", 440, 20, false);
    tone(directory, "after", 880, 10, false);
    tone(directory, "later", 440, 14, false);
    playlist(directory, [
      ...["#EXTINF:2.0,", "before.ts", "#EXT-X-DISCONTINUITY"],
      ...["#EXTINF:2.0,", "after.ts", "#EXTINF:2.0,", "later.ts"],
      "#EXT-X-ENDLIST",
    ]);
    const { audible } = await heard(t, directory, 7.8);
    for (const second of [1, 3, 7]) assert.ok(audible(second), `silence at ${second}s`);
    assert.ok(!audible(5), "the two seconds missing after the restart are silence");
  },
);

// A Twitch VOD of a stream still running: an EVENT playlist FFmpeg reports as six seconds long,
// whose timestamps start at 7 s. The shared clock runs past both instead of stopping at its length.
test(
  "an endless stream's clock isn't capped by the length its recording has so far",
  {
    timeout: 20_000,
    skip: !available && "Set COUCH_TEST_FFMPEG to run the real-media clock test.",
  },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "couch-stream-recording-"));
    for (const [index, offset] of [7, 9, 11].entries())
      tone(directory, `part${index}`, 440, offset, false);
    playlist(directory, [
      "#EXT-X-PLAYLIST-TYPE:EVENT",
      ...[0, 1, 2].flatMap((index) => ["#EXTINF:2.0,", `part${index}.ts`]),
    ]);
    const { metadata } = await heard(t, directory, 3.8);
    const latest = () =>
      metadata.findLast((item) => item.progress?.playback_speed === 1000)?.progress;
    await until(
      () => (latest()?.track_progress ?? 0) > 11_000,
      `The clock stopped at ${latest()?.track_progress} ms`,
    );
    assert.equal(latest()!.track_duration, 0, "a recording still in progress has no length");
  },
);
