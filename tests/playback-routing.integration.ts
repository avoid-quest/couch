import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import cp from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { helper, startHelpers } from "../src/server/helpers";
import { liveFixture, until } from "./live-input.fixture";

// Replace only the external extractor, retaining Hub, resolver selection, source
// preparation, protected relay, Session and the actual scheduled worker.
async function webFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-routing-extractor-"));
  const previousPath = process.env.PATH, spawn = cp.spawn;
  for (const [name, version] of [["yt-dlp", "2026.10.21"], ["qjs", "0.17.0"]]) {
    writeFileSync(join(directory, name!), `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
  }
  const selections: string[] = [];
  let holdNext = false, failHeld = false, failNext = false, release: (() => Promise<void>) | undefined;
  t.mock.method(cp, "spawn", (file: string, args: string[], options: cp.SpawnOptions) => {
    if (!args.includes("--dump-single-json")) return spawn(file, args, options);
    const selection = args[args.indexOf("--format") + 1]!;
    selections.push(selection);
    if (failNext) {
      failNext = false;
      return spawn(process.execPath, ["-e", "process.stderr.write('Fixture extraction unavailable'); process.exit(1);"], options);
    }
    const video = { url: "https://media.invalid/video-only.mp4", vcodec: "avc1.640028", acodec: "none", protocol: "https" };
    const audio = { url: "https://media.invalid/audio.m4a", vcodec: "none", acodec: "mp4a.40.2", protocol: "https" };
    const requested = selection.replace(/^\(/, "");
    const selected = requested.startsWith("ba[") ? [audio] : requested.startsWith("bv[") ? [video] : [video, audio];
    const info = { id: "fixture", title: "Separate tracks", duration: 60, formats: [video, audio], requested_formats: selected };
    const output = `process.stdout.write(${JSON.stringify(JSON.stringify(info))});`;
    if (holdNext) {
      holdNext = false;
      const held = { ...info, requested_formats: selected.map(format => ({ ...format, url: `${format.url}?held=1` })) };
      const heldOutput = failHeld ? "process.stderr.write('Old generation extraction failed'); process.exit(1);" : `process.stdout.write(${JSON.stringify(JSON.stringify(held))});`;
      failHeld = false;
      const child = spawn(process.execPath, ["-e", `process.stdin.once('data', () => { ${heldOutput} });`], { ...options, stdio: ["pipe", "pipe", "pipe"] });
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      release = () => { release = undefined; child.stdin!.end("release"); return closed; };
      return child;
    }
    return spawn(process.execPath, ["-e", output], options);
  });
  syncBuiltinESMExports();
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  const f = await liveFixture();
  // This ordinary-media decoder fixture reports a finite, seekable duration.
  // liveFixture's default decoder deliberately has no duration for captures.
  const decodeLog = join(directory, "decodes.jsonl");
  writeFileSync(join(process.env.PATH.split(delimiter)[0]!, "ffmpeg"), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('-version')) { console.log('ffmpeg version 7.0'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(decodeLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stderr.write('Duration: 00:01:00.00\\n');
setInterval(() => fs.writeSync(3, Buffer.alloc(19200)), 100);
process.stdin.resume();
`, { mode: 0o755 });
  startHelpers(join(directory, "helpers"));
  await Promise.all([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  return { ...f, selections, decodes: () => existsSync(decodeLog) ? readFileSync(decodeLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]) : [], failNext: () => { failNext = true; }, holdNext: (fail = false) => { holdNext = true; failHeld = fail; }, get held() { return !!release; }, release: () => release?.(), close: async () => {
    release?.();
    await f.close();
    t.mock.restoreAll(); syncBuiltinESMExports();
    process.env.PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  } };
}

const upstream = (source: string) => new URL(source).searchParams.get("url") ?? source;

for (const edit of [false, true]) test(`cached full A/V preparation ${edit ? "is replaced after an output generation change" : "survives an unchanged reconciliation"}`, { timeout: 15_000 }, async t => {
  let hold = false, release: (() => void) | undefined;
  const requests: string[] = [];
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,URI="/audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"\n/video.m3u8\n';
  const leaf = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n';
  const server = createServer((request, response) => {
    requests.push(request.url!);
    const answer = () => { response.setHeader("Content-Type", "application/vnd.apple.mpegurl"); response.end(request.url === "/master.m3u8" ? master : leaf); };
    if (request.url === "/master.m3u8" && hold) { hold = false; release = () => { release = undefined; answer(); }; }
    else answer();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const source = `http://127.0.0.1:${(server.address() as { port: number }).port}/master.m3u8`;
  const f = await webFixture(t);
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Full A/V", source }, playNow: true, deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    assert.deepEqual(f.receiver.load()!.output, { picture: true, sound: true });
    f.receiver.report({ position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(2);
    hold = true;
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
    await until(() => !!release);
    assert.equal(f.decodes().length, 0, "sound selection is still pending despite the full A/V cache");
    const masters = requests.filter(url => url === "/master.m3u8").length;
    if (edit) {
      assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 21 })).ok, true);
      assert.equal((await f.receiver.command({ type: "speed", playbackId, speed: 1.25 })).ok, true);
      assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, picture: true })).ok, true);
    } else {
      // This supported legacy setting reconciles without changing the output
      // generation. Its pending preparation must keep its in-flight selection.
      assert.equal((await f.receiver.command({ type: "inSync", inSync: false })).ok, true);
      release!();
    }
    await until(() => f.heard(2) > 0 && f.receiver.state.player.status === "playing" && f.receiver.state.controls?.seek === true);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    await until(() => f.receiver.state.player.status === "paused");
    const position = f.receiver.state.player.position, outputs = f.receiver.state.outputs;
    release?.();
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "barrier", title: "Barrier", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => f.receiver.state.queue.some(entry => entry.id === "barrier"));
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.equal(f.receiver.state.player.status, "paused");
    assert.equal(f.receiver.state.player.error, null);
    assert.equal(f.receiver.state.player.position, position);
    assert.equal(f.receiver.state.player.speed, edit ? 1.25 : 1.5);
    assert.deepEqual(f.receiver.state.outputs, outputs);
    assert.equal(f.receiver.state.currentEntryId, "programme");
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["programme", "barrier"]);
    const args = f.decodes().at(-1)!;
    assert.equal(upstream(args[args.indexOf("-i") + 1]!), source.replace("master", "audio"));
    assert.equal(args[args.indexOf("-ss") + 1], edit ? "21" : "13");
    assert.match(args[args.indexOf("-filter_complex") + 1]!, edit ? /atempo=1\.25/ : /atempo=1\.5/);
    if (!edit) assert.equal(requests.filter(url => url === "/master.m3u8").length, masters, "an unchanged generation reuses its pending selection");
  } finally {
    release?.();
    await f.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

for (const fails of [true, false]) test(`a superseded group preparation ${fails ? "failure" : "success"} preserves the newer successful paused generation`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(2);
    f.holdNext(fails);
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
    await until(() => f.held);
    assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 21 })).ok, true);
    assert.equal((await f.receiver.command({ type: "speed", playbackId, speed: 1.25 })).ok, true);
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, picture: true })).ok, true);
    await until(() => f.heard(2) > 0 && f.receiver.state.player.status === "playing" && f.receiver.state.controls?.seek === true);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    await until(() => f.receiver.state.player.status === "paused");
    assert.equal(f.receiver.state.player.error, null);
    const position = f.receiver.state.player.position, outputs = f.receiver.state.outputs, before = f.receiver.messages.length;
    await f.release();
    // Wait for the retired external process to exit, then force a fresh public
    // snapshot. This observes the failure callback without an arbitrary sleep.
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => f.receiver.state.queue.some(entry => entry.id === "next"));
    const errors = f.receiver.messages.slice(before).filter(message => message.type === "state" && message.state.player.status === "error");
    assert.equal(errors.length, 0, "an older failed extraction must not publish an error for the newer successful generation");
    assert.equal(f.receiver.state.player.status, "paused");
    assert.equal(f.receiver.state.player.error, null);
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.equal(f.receiver.state.player.position, position);
    assert.equal(f.receiver.state.player.speed, 1.25);
    assert.ok(position >= 21 && position < 23, "the newer generation must carry the accepted pending seek");
    assert.equal(f.receiver.state.playback, playback);
    assert.deepEqual(f.receiver.state.outputs, outputs);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["seed", "programme", "next"]);
    assert.equal(f.receiver.state.currentEntryId, "programme");
    assert.equal(f.receiver.state.controls?.seek, true);
    const heard = f.heard(2), decodes = f.decodes().length;
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: false })).ok, true);
    await until(() => f.heard(2) > heard && f.decodes().length > decodes && f.receiver.state.player.status === "playing");
    assert.equal(f.decodes().some(args => args.some(arg => arg.includes("held=1"))), false, "the retired successful extraction must not replace the newer decoder source");
  } finally { await f.close(); }
});

for (const paused of [false, true]) test(`pending group preparation retains the latest ${paused ? "pause" : "resume"}, seek and speed`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ status: paused ? "playing" : "paused", position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(2);
    f.holdNext();
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
    await until(() => f.held);
    for (const action of [
      { type: "pause", playbackId, paused: !paused }, { type: "seek", playbackId, position: 19 }, { type: "speed", playbackId, speed: 1.75 },
      { type: "pause", playbackId, paused }, { type: "seek", playbackId, position: 21 }, { type: "speed", playbackId, speed: 1.25 },
    ] as const) assert.equal((await f.receiver.command(action)).ok, true);
    assert.equal(f.decodes().length, 0, "transport commands must wait for the selected source");
    await f.release();
    if (paused) {
      await until(() => f.receiver.state.player.tracks?.some(track => track.kind === "audio") === true);
      assert.equal(f.receiver.state.player.status, "paused");
      assert.equal(f.receiver.state.player.position, 21);
      assert.equal(f.receiver.state.player.speed, 1.25);
      assert.equal(f.decodes().length, 0, "a pending pause must prevent decoding on admission");
      assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: false })).ok, true);
    }
    await until(() => f.heard(2) > 0 && f.receiver.state.player.status === "playing");
    const args = f.decodes().at(-1)!;
    assert.equal(args[args.indexOf("-ss") + 1], "21");
    assert.match(args.join(" "), /atempo=1\.25/);
    assert.equal(upstream(args[args.indexOf("-i") + 1]!), "https://media.invalid/audio.m4a?held=1");
    assert.equal(f.receiver.state.player.speed, 1.25);
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.currentEntryId, "programme");
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["seed", "programme"]);
  } finally { await f.close(); }
});

test("Next clears pending transport intent before a retired preparation succeeds", { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(2);
    f.holdNext();
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
    await until(() => f.held);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 21 })).ok, true);
    assert.equal((await f.receiver.command({ type: "speed", playbackId, speed: 1.25 })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: "web:https://www.youtube.com/watch?v=next" } })).ok, true);
    assert.equal((await f.receiver.command({ type: "next", playbackId })).ok, true);
    await until(() => f.receiver.state.currentEntryId === "next" && f.receiver.state.player.status === "playing" && f.heard(2) > 0);
    const nextId = f.receiver.state.player.playbackId;
    assert.notEqual(nextId, playbackId);
    await f.release();
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "barrier", title: "Barrier", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => f.receiver.state.queue.some(entry => entry.id === "barrier"));
    assert.equal(f.receiver.state.player.playbackId, nextId);
    assert.equal(f.receiver.state.player.status, "playing");
    assert.equal(f.receiver.state.player.error, null);
    assert.equal(f.receiver.state.player.speed, 1);
    assert.ok(f.receiver.state.player.position < 2, "the new item must not inherit the retired seek");
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["seed", "programme", "next", "barrier"]);
    const args = f.decodes().at(-1)!;
    assert.doesNotMatch(args[args.indexOf("-filter_complex") + 1]!, /atempo=/, "normal speed needs no tempo filter");
    assert.equal(args.includes("-ss"), false, "the new decoder starts at the beginning");
    assert.equal(upstream(args[args.indexOf("-i") + 1]!), "https://media.invalid/audio.m4a");
    assert.equal(f.decodes().some(args => args.some(arg => arg.includes("held=1"))), false);
  } finally { await f.close(); }
});

for (const fails of [true, false]) test(`a compressor edit retains the current group preparation ${fails ? "failure" : "success"}`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true })).ok, true);
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ status: "paused", position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.status === "paused");
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    const other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(2);
    f.holdNext(fails);
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80 })).ok, true);
    await until(() => f.held);
    const attempts = f.selections.length;
    assert.equal((await f.receiver.command({ type: "compressor", playbackId, settings: { enabled: true, threshold: -24 } })).ok, true);
    await f.release();
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => f.receiver.state.queue.some(entry => entry.id === "next"));
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.currentEntryId, "programme");
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["seed", "programme", "next"]);
    assert.equal(f.receiver.state.compressor?.enabled, true);
    assert.equal(f.receiver.state.compressor?.threshold, -24);
    assert.equal(f.selections.length, attempts, "a settings edit does not need another source extraction");
    if (fails) {
      assert.equal(f.receiver.state.player.status, "error", "the current extraction failure must remain actionable after a settings edit");
      assert.equal(f.receiver.state.player.error, "Couldn't open this page. It may be unsupported.");
      assert.equal(f.heard(2), 0);
      assert.equal(f.decodes().length, 0);
    } else {
      // The Direct snapshot was already paused; wait for the worker to publish
      // its admitted audio load before sending resume to that new renderer.
      await until(() => f.receiver.state.player.tracks?.filter(track => track.kind === "audio").length === 1);
      assert.equal(f.receiver.state.player.status, "paused");
      assert.equal(f.receiver.state.player.error, null);
      assert.equal(f.receiver.state.player.position, 13);
      assert.equal(f.receiver.state.player.speed, 1.5);
      assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: false })).ok, true);
      await until(() => f.heard(2) > 0 && f.receiver.state.player.status === "playing");
      const args = f.decodes().at(-1)!;
      assert.match(args.join(" "), /acompressor=threshold=0\.06309573444801933/);
      assert.match(args.join(" "), /atempo=1\.5/);
      assert.equal(upstream(args[args.indexOf("-i") + 1]!), "https://media.invalid/audio.m4a?held=1");
    }
  } finally { await f.close(); }
});

test("a stale Move here preserves source caches and the next joined group remains controllable", { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    const other = await f.connect(2, "&audio=1&video=1");
    await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report({ position: 13, duration: 60, seekable: true });
    await until(() => f.receiver.state.player.position === 13);
    await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    const outputs = f.receiver.state.outputs, queue = f.receiver.state.queue.map(entry => entry.id), resolutions = f.selections.length;
    f.holdNext();
    const moving = f.receiver.command({ type: "solo", deviceId: other.id });
    await until(() => f.held);
    await f.connect(2, "&audio=1&video=1");
    f.release();
    const rejected = await moving;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error ?? "", /Playback or destination changed/);
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.equal(f.receiver.state.playback, playback);
    assert.deepEqual(f.receiver.state.outputs, outputs);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
    await f.speaker(2);
    const joined = await f.receiver.command({ type: "output", deviceId: other.id, level: 80 });
    assert.equal(joined.ok, true, joined.error);
    await until(() => f.heard(2) > 0);
    await until(() => f.receiver.state.controls?.seek === true);
    assert.equal(f.selections.length, resolutions + 1, "a rejected prospective load must not replace the active source cache");
    assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 20 })).ok, true);
    await until(() => f.receiver.state.player.position >= 20);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    await until(() => f.receiver.state.player.status === "paused");
    assert.equal((await f.receiver.command({ type: "speed", playbackId, speed: 1.5 })).ok, true);
    await until(() => f.receiver.state.player.speed === 1.5);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: false })).ok, true);
    await until(() => f.receiver.state.player.status === "playing");
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
  } finally { await f.close(); }
});

test("a picture-only group re-resolves omitted audio when its first speaker joins", { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 });
    await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true });
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ position: 13, duration: 60, seekable: true });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!;
    const other = await f.connect(2, "&video=1&audio=1");
    await f.receiver.command({ type: "output", deviceId: other.id, picture: true });
    await until(() => f.receiver.state.player.timeline?.mapping === "media");
    assert.equal(f.receiver.state.outputs?.some(output => output.sound), false);
    const resolutions = f.selections.length;
    await f.speaker(2);
    const joined = await f.receiver.command({ type: "output", deviceId: other.id, level: 80 });
    assert.equal(joined.ok, true, joined.error);
    await until(() => f.selections.length > resolutions);
    assert.match(f.selections.at(-1)!, /bv\*/);
    await until(() => f.heard(2) > 0);
    assert.equal(f.receiver.state.player.playbackId, playbackId);
    assert.ok(f.receiver.state.player.position >= 13);
    const paused = await f.receiver.command({ type: "pause", playbackId, paused: true });
    assert.equal(paused.ok, true, paused.error);
    await until(() => f.receiver.state.player.status === "paused");
  } finally { await f.close(); }
});

for (const restored of ["sound", "picture"] as const) test(`restoring omitted ${restored} re-resolves separate tracks without losing programme state`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    await f.receiver.command({ type: "output", deviceId: f.receiver.id, ...restored === "sound" ? { level: 0 } : { picture: false } });
    await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true });
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    const loaded = f.receiver.load()!, playback = f.receiver.state.playback;
    assert.equal(upstream(loaded.source), restored === "sound" ? "https://media.invalid/video-only.mp4" : "https://media.invalid/audio.m4a");
    assert.equal(loaded.audioSource, undefined);
    f.receiver.report({ status: "paused", position: 13, duration: 60, seekable: true, speed: 1.5, subtitleDelay: 0.25,
      tracks: [{ id: "a0", kind: "audio", index: 0, label: "English", language: "en", selected: false },
        { id: "a1", kind: "audio", index: 1, label: "Italian", language: "it", selected: true },
        { id: "s0", kind: "subtitle", index: 0, label: "English", language: "en", selected: true }] });
    await until(() => f.receiver.state.player.status === "paused");
    await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    const queue = f.receiver.state.queue.map(entry => entry.id), resolutions = f.selections.length;
    const result = await f.receiver.command({ type: "output", deviceId: f.receiver.id, ...restored === "sound" ? { level: 80 } : { picture: true } });
    assert.equal(result.ok, true, result.error);
    const fresh = f.receiver.load()!;
    assert.equal(f.selections.length, resolutions + 1, "a resolver cannot restore a channel it was never asked for");
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
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
  } finally { await f.close(); }
});

for (const pictureOnly of [true, false]) test(`${pictureOnly ? "picture-only" : "full A/V"} Direct collapses from a group to selected sound-only media`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    if (pictureOnly) await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 });
    await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true });
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    assert.equal(upstream(f.receiver.load()!.source), "https://media.invalid/video-only.mp4");
    assert.equal(!!f.receiver.load()!.audioSource, !pictureOnly);
    f.receiver.report({ position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.position === 13);
    const playbackId = f.receiver.state.player.playbackId!, playback = f.receiver.state.playback;
    await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    const queue = f.receiver.state.queue.map(entry => entry.id);
    const other = await f.connect(2, "&audio=1&video=1", true);
    await f.speaker(2);
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 80, picture: false })).ok, true);
    await until(() => f.heard(2) > 0 && f.receiver.state.controls?.seek === true);
    assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: true })).ok, true);
    await until(() => f.receiver.state.player.status === "paused");
    const position = f.receiver.state.player.position;
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0, picture: false })).ok, true);
    await until(() => other.load()?.follow === undefined && other.load()?.playbackId === playbackId);
    const loaded = other.load()!;
    assert.equal(upstream(loaded.source), "https://media.invalid/audio.m4a");
    assert.equal(new URL(loaded.source).origin, "https://receiver.example");
    assert.equal(loaded.audioSource, undefined);
    assert.deepEqual(loaded.output, { picture: false, sound: true });
    assert.equal(loaded.paused, true);
    assert.equal(loaded.startPosition, position);
    assert.equal(loaded.preferences?.speed, 1.5);
    assert.equal(other.state.playback, playback);
    assert.deepEqual(other.state.queue.map(entry => entry.id), queue);
    assert.deepEqual(other.state.outputs?.map(output => output.deviceId), [other.id]);
  } finally { await f.close(); }
});

for (const restored of ["sound", "picture"] as const) test(`failed omitted ${restored} restoration leaves its output and source retryable`, { timeout: 15_000 }, async t => {
  const f = await webFixture(t);
  try {
    await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    await f.receiver.command({ type: "output", deviceId: f.receiver.id, ...restored === "sound" ? { level: 0 } : { picture: false } });
    await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Separate tracks", source: "web:https://www.youtube.com/watch?v=fixture" }, playNow: true });
    await until(() => f.receiver.load()?.playbackId === f.receiver.state.player.playbackId && f.receiver.state.currentEntryId === "programme");
    f.receiver.report({ status: "paused", position: 13, duration: 60, seekable: true, speed: 1.5 });
    await until(() => f.receiver.state.player.status === "paused");
    const original = f.receiver.load()!, outputs = f.receiver.state.outputs, playback = f.receiver.state.playback;
    const action = { type: "output", deviceId: f.receiver.id, ...restored === "sound" ? { level: 80 } : { picture: true } } as const;
    f.failNext();
    const rejected = await f.receiver.command(action);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "Couldn't open this page. It may be unsupported.");
    assert.deepEqual(f.receiver.load(), original);
    // A queue change publishes state after the failure; this observes Core's
    // output intent, rather than relying on a snapshot from before rejection.
    await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    await until(() => f.receiver.state.queue.some(entry => entry.id === "next"));
    assert.deepEqual(f.receiver.state.outputs, outputs);
    const queue = f.receiver.state.queue.map(entry => entry.id);
    const attempts = f.selections.length;
    const retried = await f.receiver.command(action);
    assert.equal(retried.ok, true, retried.error);
    assert.equal(f.selections.length, attempts + 1);
    const loaded = f.receiver.load()!;
    assert.equal(upstream(loaded.source), "https://media.invalid/video-only.mp4");
    assert.equal(upstream(loaded.audioSource!), "https://media.invalid/audio.m4a");
    assert.deepEqual(loaded.output, { picture: true, sound: true });
    assert.equal(loaded.playbackId, original.playbackId);
    assert.equal(loaded.startPosition, 13);
    assert.equal(loaded.paused, true);
    assert.equal(loaded.preferences?.speed, 1.5);
    assert.equal(f.receiver.state.playback, playback);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
  } finally { await f.close(); }
});

test("idle Core permits ordinary queue intake and playback defaults before the first programme", async () => {
  const f = await liveFixture();
  try {
    assert.equal(f.receiver.state.playback, null);
    assert.equal(f.receiver.state.controls?.queue, true);
    assert.equal(f.receiver.state.controls?.programme, true);
    assert.equal(f.receiver.state.controls?.speed, true);
    assert.equal(f.receiver.state.controls?.seek, false);
    assert.equal(f.receiver.state.controls?.leave, false);
    const defaults = await f.receiver.command({ type: "preferences", profileId: f.receiver.state.activeProfile.id,
      preferences: { autoplay: false, audioLanguage: "it", subtitleLanguage: "en", subtitles: "off", speed: 1.5 } });
    assert.equal(defaults.ok, true, defaults.error);
    await until(() => f.receiver.state.preferences?.profile.speed === 1.5);
    assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "first", title: "First", source: `${f.hub.origin}/api/health` } })).ok, true);
    assert.equal(f.receiver.state.player.playbackId, null);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), ["first"]);
    assert.equal(f.receiver.state.preferences?.profile.autoplay, false);
    assert.equal(f.receiver.state.preferences?.profile.audioLanguage, "it");
  } finally { await f.close(); }
});
