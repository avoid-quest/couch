import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { checkHelper, helper, startHelpers } from "../src/server/helpers";
import { liveFixture, until } from "./live-input.fixture";
import type { MediaTrack, PlaybackCommand } from "../src/shared/protocol";

type Load = Extract<PlaybackCommand, { type: "load" }>;
const tracks = (selected: number): MediaTrack[] => ["English", "Italian"].map((label, index) => ({ id: `audio-${index}`, index, kind: "audio", label, language: index ? "it" : "en", selected: index === selected }));
const upstream = (source: string): string => new URL(source).searchParams.get("url") ?? source;

async function fixture(t: TestContext, preference = "en", live = false) {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "group-language-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const requests: string[] = [], log = join(directory, "decoder.jsonl");
  writeFileSync(log, "");
  const media = createServer((request, response) => {
    requests.push(request.url!);
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    response.end(request.url === "/master.m3u8" ? ["#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="/en/index.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Italian",LANGUAGE="it",DEFAULT=NO,AUTOSELECT=YES,URI="/it/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a",CODECS="avc1.640028,mp4a.40.2"', "/picture/index.m3u8", ""].join("\n")
      : `#EXTM3U\n#EXT-X-TARGETDURATION:60\n#EXTINF:60,\nsegment.aac\n${live ? "" : "#EXT-X-ENDLIST\n"}`);
  });
  await new Promise<void>(resolve => media.listen(0, "127.0.0.1", resolve));
  t.after(async () => { media.closeAllConnections(); await new Promise<void>(resolve => media.close(() => resolve())); });
  const origin = `http://127.0.0.1:${(media.address() as { port: number }).port}`, source = `${origin}/master.m3u8`;
  const f = await liveFixture();
  t.after(() => f.close());
  const binary = process.env.PATH!.split(delimiter)[0]!, executable = join(binary, "ffmpeg");
  // Substitute only the external codec process. The real worker selects its
  // source, supplies transport filters and sends the paced PCM to an SDK client.
  writeFileSync(executable, `#!${process.execPath}\n${[
    "const fs = require('node:fs');",
    "if (process.argv.includes('-version')) { console.log('ffmpeg version 7.0'); process.exit(0); }",
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "process.stderr.write('Duration: 00:01:00.00\\n[Parsed_ashowinfo_0] n:0 pts:0 pts_time:0\\n');",
    "setInterval(() => fs.writeSync(3, Buffer.alloc(19200)), 100);",
  ].join("\n")}\n`, { mode: 0o755 });
  startHelpers(join(directory, "helpers"));
  const checked = await Promise.allSettled([helper("ffmpeg"), helper("qjs"), helper("yt-dlp"), checkHelper("mpv")]);
  assert.deepEqual(checked[0], { status: "fulfilled", value: executable });
  assert.equal((await f.receiver.command({ type: "preferences", profileId: f.receiver.state.activeProfile.id, preferences: { audioLanguage: preference } })).ok, true);
  const other = await f.connect(2, "&audio=1&video=1");
  await f.speaker(2);
  const invocations = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]);
  const decodedSource = (index = invocations().length - 1) => { const args = invocations()[index]!; return upstream(args[args.indexOf("-i") + 1]!); };
  const play = async (id = "programme") => {
    const previous = f.receiver.load();
    const reply = await f.receiver.command({ type: "enqueue", entry: { id, title: id, source }, playNow: true });
    assert.equal(reply.ok, true, reply.error);
    await until(() => f.receiver.state.currentEntryId === id && f.receiver.state.player.playbackId !== null);
    return previous;
  };
  const joinGroup = async () => {
    const reply = await f.receiver.command({ type: "output", deviceId: other.id, picture: false, level: 80 });
    assert.equal(reply.ok, true, reply.error);
    await until(() => f.receiver.state.playbacks?.find(playback => playback.id === f.receiver.state.playback)?.delivery === "scheduled");
  };
  return { ...f, other, origin, source, requests, play, joinGroup, invocations, decodedSource };
}

test("explicit Italian beats the English default through group seek/restart and returns to Direct; Next clears it", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.play();
  await until(() => !!f.receiver.load());
  const original = f.receiver.load()!;
  f.receiver.report({ position: 13, duration: 60, seekable: true, tracks: tracks(0), speed: 1.5 });
  await until(() => f.receiver.state.player.position === 13);
  assert.equal((await f.receiver.command({ type: "track", playbackId: original.playbackId, kind: "audio", index: 1 })).ok, true);
  f.receiver.report({ status: "paused", position: 13, duration: 60, seekable: true, tracks: tracks(1), speed: 1.5 });
  await until(() => f.receiver.state.player.status === "paused");
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: f.source } })).ok, true);
  const queue = f.receiver.state.queue.map(entry => entry.id), playback = f.receiver.state.playback;
  await f.joinGroup();
  await until(() => f.receiver.state.player.status === "paused" && f.receiver.state.player.tracks?.filter(track => track.kind === "audio").length === 1);
  assert.equal(f.receiver.state.player.position, 13);
  assert.equal(f.receiver.state.player.speed, 1.5);
  assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
  assert.equal(f.receiver.state.playback, playback);
  const trackReply = await f.receiver.command({ type: "track", playbackId: original.playbackId, kind: "audio", index: 1 });
  assert.equal(trackReply.ok, false, "the group must reject unsupported track-switch commands");
  assert.match(trackReply.error!, /Track selection is unavailable/);
  assert.equal((await f.receiver.command({ type: "pause", playbackId: original.playbackId, paused: false })).ok, true);
  await until(() => f.invocations().length > 0 && f.receiver.state.controls?.seek === true);
  assert.equal(f.decodedSource(), `${f.origin}/it/index.m3u8`, "takeover must decode the explicitly selected Italian stream");
  let before = f.invocations().length;
  assert.equal((await f.receiver.command({ type: "seek", playbackId: original.playbackId, position: 23 })).ok, true);
  await until(() => f.invocations().length > before);
  assert.equal(f.decodedSource(), `${f.origin}/it/index.m3u8`, "seek must retain explicit audio selection");
  assert.ok(f.invocations().at(-1)!.includes("23"));
  before = f.invocations().length;
  assert.equal((await f.receiver.command({ type: "speed", playbackId: original.playbackId, speed: 1.25 })).ok, true);
  await until(() => f.invocations().length > before);
  assert.equal(f.decodedSource(), `${f.origin}/it/index.m3u8`, "decoder restart must retain explicit audio selection");
  assert.match(f.invocations().at(-1)!.join(" "), /atempo=1\.25/);
  assert.equal((await f.receiver.command({ type: "pause", playbackId: original.playbackId, paused: true })).ok, true);
  await until(() => f.receiver.state.player.status === "paused");
  const position = f.receiver.state.player.position;
  const previous = f.receiver.load();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.other.id, picture: false, level: 0 })).ok, true);
  await until(() => f.receiver.load() !== previous && f.receiver.load()?.follow === undefined);
  const restored: Load = f.receiver.load()!;
  assert.equal(restored.audioTrack, 1, "the worker's single generic track must not replace the selected Direct identity");
  assert.equal(restored.playbackId, original.playbackId);
  assert.equal(restored.startPosition, position);
  assert.equal(restored.paused, true);
  assert.equal(restored.preferences?.speed, 1.25);
  assert.equal(restored.preferences?.audioLanguage, "en");
  assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
  assert.equal(f.receiver.state.currentEntryId, "programme");
  for (const field of ["audioSelection", "audioManifest", "headers", "credentialOrigin", "publicNetwork"]) assert.equal(field in restored, false);
  f.receiver.report({ status: "paused", position, speed: 1.25, tracks: tracks(1) });
  assert.equal((await f.receiver.command({ type: "next", playbackId: original.playbackId })).ok, true);
  await until(() => f.receiver.load()?.playbackId !== original.playbackId && f.receiver.state.currentEntryId === "next");
  assert.equal(f.receiver.load()!.audioTrack, undefined, "Next must not carry a previous item's explicit index");
  f.receiver.report({ playbackId: original.playbackId, tracks: tracks(1) });
  before = f.invocations().length;
  await f.joinGroup();
  await until(() => f.invocations().length > before);
  assert.equal(f.decodedSource(), `${f.origin}/en/index.m3u8`, "new-item takeover follows its own selection");
});

test("a broadcast retains explicit Italian through takeover and collapse without an early default-rendition cache", { timeout: 15_000 }, async t => {
  const f = await fixture(t, "en", true);
  await f.play();
  await until(() => !!f.receiver.load());
  const original = f.receiver.load()!;
  f.receiver.report({ tracks: tracks(1), seekable: false, duration: null });
  await until(() => f.receiver.state.player.status === "playing");
  await f.joinGroup();
  await until(() => f.invocations().length > 0 && f.heard(2) > 0);
  assert.equal(f.decodedSource(), `${f.origin}/it/index.m3u8`);
  assert.match(f.invocations().at(-1)!.join(" "), /\[0:a:0\]/, "the standalone Italian rendition has audio stream zero");
  assert.equal((await f.receiver.command({ type: "pause", playbackId: original.playbackId, paused: true })).ok, true);
  await until(() => f.receiver.state.player.status === "paused");
  const previous = f.receiver.load();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.other.id, picture: false, level: 0 })).ok, true);
  await until(() => f.receiver.load() !== previous && f.receiver.load()?.follow === undefined);
  assert.equal(f.receiver.load()!.audioTrack, 1);
  assert.equal(f.receiver.load()!.playbackId, original.playbackId);
  assert.equal(f.receiver.load()!.paused, true);
  assert.equal(f.receiver.load()!.startPosition, undefined);
});

for (const live of [false, true]) test(`an initial ${live ? "broadcast" : "VOD"} group decodes the Italian profile preference without video`, { timeout: 15_000 }, async t => {
  const f = await fixture(t, "it", live);
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
  await until(() => !!f.receiver.load());
  f.receiver.report();
  await until(() => f.receiver.state.player.status === "playing");
  await f.joinGroup();
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: false, level: 80 })).ok, true);
  const before = f.invocations().length;
  await f.play();
  await until(() => f.invocations().length > before && f.heard(2) > 0);
  assert.equal(f.decodedSource(), `${f.origin}/it/index.m3u8`);
  assert.equal(f.requests.some(path => path.startsWith("/picture/")), false, "sound-only groups must not fetch video");
  assert.equal(f.receiver.state.player.tracks?.filter(track => track.kind === "audio").length, 1, "the group only exposes its supported selected stream");
});
