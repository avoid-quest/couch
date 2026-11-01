import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import cp from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
