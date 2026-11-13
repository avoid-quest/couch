import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import cp from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { AudioCodec, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { helper, startHelpers } from "../src/server/helpers";
import { liveFixture, until } from "./live-input.fixture";
import { executableName, nodeExecutables } from "./executable.fixture";

// Replace only the external extractor, retaining Hub, resolver selection, source
// preparation, protected relay, Session and the actual scheduled worker.
async function webFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-routing-extractor-"));
  const executables = nodeExecutables(directory);
  const previousPath = process.env.PATH,
    spawn = cp.spawn;
  for (const [name, version] of [
    ["yt-dlp", "2026.10.21"],
    ["qjs", "0.17.0"],
  ]) {
    writeFileSync(
      join(directory, executableName(name!)),
      `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`,
      { mode: 0o755 },
    );
  }
  const selections: string[] = [];
  t.mock.method(cp, "spawn", (file: string, args: string[], options: cp.SpawnOptions) => {
    if (!args.includes("--dump-single-json")) return spawn(file, args, options);
    const selection = args[args.indexOf("--format") + 1]!;
    selections.push(selection);
    const video = {
      url: "https://media.invalid/video-only.mp4",
      vcodec: "avc1.640028",
      acodec: "none",
      protocol: "https",
    };
    const audio = {
      url: "https://media.invalid/audio.m4a",
      vcodec: "none",
      acodec: "mp4a.40.2",
      protocol: "https",
    };
    const requested = selection.replace(/^\(/, "");
    const selected = requested.startsWith("ba[")
      ? [audio]
      : requested.startsWith("bv[")
        ? [video]
        : [video, audio];
    const info = {
      id: "fixture",
      title: "Separate tracks",
      duration: 60,
      formats: [video, audio],
      requested_formats: selected,
    };
    const output = `process.stdout.write(${JSON.stringify(JSON.stringify(info))});`;
    return spawn(process.execPath, ["-e", output], options);
  });
  syncBuiltinESMExports();
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  const f = await liveFixture();
  // This ordinary-media decoder fixture reports a finite, seekable duration.
  // liveFixture's default decoder deliberately has no duration for captures.
  const decodeLog = join(directory, "decodes.jsonl");
  writeFileSync(
    f.executable,
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('-version')) { console.log('ffmpeg version 7.0'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(decodeLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stderr.write('Duration: 00:01:00.00\\n');
setInterval(() => fs.writeSync(3, Buffer.alloc(19200)), 100);
process.stdin.resume();
`,
    { mode: 0o755 },
  );
  startHelpers(join(directory, "helpers"));
  await Promise.all([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  return {
    ...f,
    selections,
    decodes: () =>
      existsSync(decodeLog)
        ? readFileSync(decodeLog, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
    close: async () => {
      const forcedPlayback = await f.close();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      const forcedExtractor = await executables.close();
      process.env.PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
      assert.deepEqual(
        forcedPlayback,
        { children: [], workers: [] },
        "playback children and workers must stop before forced cleanup",
      );
      assert.deepEqual(
        forcedExtractor,
        { children: [], workers: [] },
        "extractor fixture children must stop before forced cleanup",
      );
    },
  };
}

const upstream = (source: string) => new URL(source).searchParams.get("url") ?? source;

test(
  "private HLS keeps every sample when a shared programme loses a segment connection",
  { timeout: 35_000 },
  async (t) => {
    const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
    const directory = mkdtempSync(join(tmpdir(), "couch-routing-hls-"));
    let fixture: Awaited<ReturnType<typeof liveFixture>> | undefined;
    let client: SendspinClient | undefined;
    let origin: ReturnType<typeof createServer> | undefined;
    t.after(async () => {
      try {
        await client?.disconnect();
        if (fixture) assert.deepEqual(await fixture.close(), { children: [], workers: [] });
      } finally {
        origin?.closeAllConnections();
        if (origin) await new Promise<void>((resolve) => origin!.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    });
    cp.execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "10",
      "-ac",
      "2",
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
      join(directory, "tone.m3u8"),
    ]);
    const expected = cp.execFileSync(
      ffmpeg,
      ["-v", "error", "-i", join(directory, "tone.m3u8"), "-f", "s16le", "pipe:1"],
      { maxBuffer: 4_000_000 },
    );
    let interrupted = false;
    let resumed = false;
    let release: (() => void) | undefined;
    const server = createServer((request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      const complete = readFileSync(join(directory, path));
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const from = range ? Number(range[1]) : 0;
      const to = range?.[2] ? Number(range[2]) : complete.length - 1;
      const bytes = complete.subarray(from, to + 1);
      if (range) {
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${from}-${to}/${complete.length}`);
      }
      response.setHeader("ETag", JSON.stringify(path));
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader(
        "Content-Type",
        path.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
      );
      response.setHeader("Content-Length", bytes.length);
      if (path.endsWith("segment06.ts") && !interrupted) {
        interrupted = true;
        // Twenty-four transport packets pass the relay sniff before the connection drops.
        response.write(bytes.subarray(0, 4512));
        release = () => response.destroy();
      } else {
        if (path.endsWith("segment06.ts") && from === 4512) resumed = true;
        response.end(bytes);
      }
    });
    origin = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const source = `http://127.0.0.1:${address.port}/tone.m3u8`;
    const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
    fixture = f;
    const identity = f.identities[1]!;
    const frames: Buffer[] = [];
    let received = 0;
    const speaker = new SendspinClient(identity.id, "Programme speaker", [Roles.PLAYER], {
      playerSupport: {
        supported_formats: [
          { codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 },
        ],
        buffer_capacity: 2_000_000,
        supported_commands: [],
      },
    });
    client = speaker;
    speaker.addAudioChunkListener((_timestamp, bytes) => {
      received += bytes.length;
      frames.push(Buffer.from(bytes));
    });
    await speaker.connect(
      `${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`,
      { timeoutMs: 3_000 },
    );
    await f.receiver.command({
      type: "enqueue",
      entry: { id: "first", title: "Private HLS", source },
      playNow: true,
      deviceId: f.receiver.id,
    });
    await until(() => !!f.receiver.load());
    f.receiver.report({ position: 0, duration: 10, seekable: true });
    await until(() => f.receiver.state.player.status === "playing");
    const other = await f.connect(2, "&video=1&audio=1");
    assert.equal(
      (await f.receiver.command({ type: "output", deviceId: other.id, picture: true })).ok,
      true,
    );
    // Exercise both a direct programme becoming shared and a new programme on that shared route.
    for (const id of ["first", "next"]) {
      if (id === "next") {
        frames.length = 0;
        received = 0;
        interrupted = false;
        resumed = false;
        release = undefined;
        assert.equal(
          (
            await f.receiver.command({
              type: "enqueue",
              entry: { id, title: "Next private HLS", source },
              playNow: true,
            })
          ).ok,
          true,
        );
      }
      await until(() => !!release);
      await until(() => frames.length > 0);
      release!();
      const deadline = Date.now() + 15_000;
      while (received < expected.length) {
        assert.notEqual(f.receiver.state.player.status, "error", f.receiver.state.player.error);
        assert.ok(
          Date.now() < deadline,
          `the recovered programme did not finish: ${JSON.stringify({ status: f.receiver.state.player.status, bytes: received, expected: expected.length, resumed })}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(resumed, true, "the missing segment bytes must be requested");
      assert.ok(
        Buffer.concat(frames).equals(expected),
        "shared HLS lost or repeated decoded samples",
      );
    }
  },
);

test(
  "a picture-only group re-resolves omitted audio when its first speaker joins",
  { timeout: 15_000 },
  async (t) => {
    const f = await webFixture(t);
    try {
      await f.receiver.command({
        type: "enqueue",
        entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` },
        playNow: true,
        deviceId: f.receiver.id,
      });
      await until(() => !!f.receiver.load());
      f.receiver.report();
      await until(() => f.receiver.state.player.status === "playing");
      await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 });
      await f.receiver.command({
        type: "enqueue",
        entry: {
          id: "programme",
          title: "Separate tracks",
          source: "web:https://www.youtube.com/watch?v=fixture",
        },
        playNow: true,
      });
      await until(
        () =>
          f.receiver.load()?.playbackId === f.receiver.state.player.playbackId &&
          f.receiver.state.currentEntryId === "programme",
      );
      f.receiver.report({ position: 13, duration: 60, seekable: true });
      await until(() => f.receiver.state.player.position === 13);
      const playbackId = f.receiver.state.player.playbackId!;
      const other = await f.connect(2, "&video=1&audio=1");
      await f.receiver.command({ type: "output", deviceId: other.id, picture: true });
      await until(() => f.receiver.state.player.timeline?.mapping === "media");
      assert.equal(
        f.receiver.state.outputs?.some((output) => output.sound),
        false,
      );
      const resolutions = f.selections.length;
      await f.speaker(2);
      const joined = await f.receiver.command({ type: "output", deviceId: other.id, level: 80 });
      assert.equal(joined.ok, true, joined.error ?? "");
      await until(() => f.selections.length > resolutions);
      assert.match(f.selections.at(-1)!, /bv\*/);
      await until(() => f.heard(2) > 0);
      assert.equal(f.receiver.state.player.playbackId, playbackId);
      assert.ok(f.receiver.state.player.position >= 13);
      const paused = await f.receiver.command({ type: "pause", playbackId, paused: true });
      assert.equal(paused.ok, true, paused.error ?? "");
      await until(() => f.receiver.state.player.status === "paused");
    } finally {
      await f.close();
    }
  },
);

for (const restored of ["sound", "picture"] as const)
  test(
    `restoring omitted ${restored} re-resolves separate tracks without losing programme state`,
    { timeout: 15_000 },
    async (t) => {
      const f = await webFixture(t);
      try {
        await f.receiver.command({
          type: "enqueue",
          entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` },
          playNow: true,
          deviceId: f.receiver.id,
        });
        await until(() => !!f.receiver.load());
        f.receiver.report();
        await until(() => f.receiver.state.player.status === "playing");
        await f.receiver.command({
          type: "output",
          deviceId: f.receiver.id,
          ...(restored === "sound" ? { level: 0 } : { picture: false }),
        });
        await f.receiver.command({
          type: "enqueue",
          entry: {
            id: "programme",
            title: "Separate tracks",
            source: "web:https://www.youtube.com/watch?v=fixture",
          },
          playNow: true,
        });
        await until(
          () =>
            f.receiver.load()?.playbackId === f.receiver.state.player.playbackId &&
            f.receiver.state.currentEntryId === "programme",
        );
        const loaded = f.receiver.load()!,
          playback = f.receiver.state.playback;
        assert.equal(
          upstream(loaded.source),
          restored === "sound"
            ? "https://media.invalid/video-only.mp4"
            : "https://media.invalid/audio.m4a",
        );
        assert.equal(loaded.audioSource, undefined);
        f.receiver.report({
          status: "paused",
          position: 13,
          duration: 60,
          seekable: true,
          speed: 1.5,
          subtitleDelay: 0.25,
          tracks: [
            {
              id: "a0",
              kind: "audio",
              index: 0,
              label: "English",
              language: "en",
              selected: false,
            },
            { id: "a1", kind: "audio", index: 1, label: "Italian", language: "it", selected: true },
            {
              id: "s0",
              kind: "subtitle",
              index: 0,
              label: "English",
              language: "en",
              selected: true,
            },
          ],
        });
        await until(() => f.receiver.state.player.status === "paused");
        await f.receiver.command({
          type: "enqueue",
          entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` },
        });
        const queue = f.receiver.state.queue.map((entry) => entry.id),
          resolutions = f.selections.length;
        const result = await f.receiver.command({
          type: "output",
          deviceId: f.receiver.id,
          ...(restored === "sound" ? { level: 80 } : { picture: true }),
        });
        assert.equal(result.ok, true, result.error ?? "");
        const fresh = f.receiver.load()!;
        assert.equal(
          f.selections.length,
          resolutions + 1,
          "a resolver cannot restore a channel it was never asked for",
        );
        assert.equal(upstream(fresh.source), "https://media.invalid/video-only.mp4");
        assert.equal(upstream(fresh.audioSource!), "https://media.invalid/audio.m4a");
        assert.deepEqual(fresh.output, { picture: true, sound: true });
        assert.equal(fresh.playbackId, loaded.playbackId);
        assert.equal(fresh.startPosition, 13);
        assert.equal(fresh.paused, true);
        assert.equal(fresh.preferences?.speed, 1.5);
        assert.equal(fresh.audioTrack, 1);
        assert.equal(fresh.subtitleTrack, 0);
        assert.equal(fresh.subtitleDelay, 0.25);
        assert.equal(f.receiver.state.playback, playback);
        assert.deepEqual(
          f.receiver.state.queue.map((entry) => entry.id),
          queue,
        );
      } finally {
        await f.close();
      }
    },
  );
