import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createLiveStreams } from "../src/server/live-stream";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const run = (args: string[]) => new Promise<Buffer>((resolve, reject) => execFile(ffmpeg, args, { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
const decodedFrames = (input: Buffer) => {
  const decoded = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:v:0", "-an", "-vf", "scale=2:2", "-pix_fmt", "gray", "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"], { input });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  return decoded.stdout.length / 4;
};
const videoPts = (input: Buffer) => {
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-copyts", "-i", "pipe:0", "-map", "0:v:0", "-vf", "showinfo", "-frames:v", "1", "-f", "null", "-"], { input });
  assert.equal(probe.status, 0, String(probe.stderr));
  const match = /Parsed_showinfo[^\n]+n:\s*0\s+pts:\s*\d+\s+pts_time:([\d.]+)/.exec(String(probe.stderr));
  assert.ok(match, "the picture must retain its MPEG-TS presentation clock");
  return Number(match[1]);
};
async function until(check: () => Promise<boolean>, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error("Live input did not reach the expected state."); await new Promise(resolve => setTimeout(resolve, 25)); }
}

async function fixture(t: TestContext, executable?: () => Promise<string>) {
  const directory = await mkdtemp(join(tmpdir(), "couch-live-stream-test-"));
  const marker = join(directory, "encoder"), wrapper = join(directory, "ffmpeg");
  await writeFile(wrapper, `#!/bin/sh\nprintf '%s\\n%s\\n' "$$" "$PWD/av/stream.m3u8" > ${quote(marker)}\nexec ${quote(ffmpeg)} "$@"\n`, { mode: 0o755 });
  const failures: string[] = [];
  const streams = createLiveStreams({ ffmpeg: executable ?? (async () => wrapper), failed: (_sourceId, error) => failures.push(error) });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 65_536 });
  await once(server, "listening");
  const clients: WebSocket[] = [];
  const upload = async (sourceId: string) => {
    const connected = once(server, "connection");
    const address = server.address();
    assert.ok(typeof address !== "string");
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    clients.push(client);
    const messages: { type: string; error?: string }[] = [];
    client.on("message", data => messages.push(JSON.parse(String(data))));
    await once(client, "open");
    const [socket] = await connected as [WebSocket];
    const accepted = streams.accept(sourceId, socket);
    if (!accepted) socket.close();
    return { client, socket, messages, accepted };
  };
  t.after(async () => {
    await streams.close();
    for (const client of clients) client.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { streams, upload, failures, marker };
}

// MediaRecorder's timeslices form one recording, not independently playable
// files. Feed continuous WebM in many small ordered WebSocket frames and leave
// the upload open: HLS must become playable before EOF.
test("one continuous upload becomes bounded HLS with real audio and video before EOF", { skip: !hasFfmpeg, timeout: 25_000 }, async t => {
  const f = await fixture(t);
  const recording = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "18", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-g", "10", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
  await f.streams.start("screen", { audio: true, video: true });
  const uploader = await f.upload("screen");
  assert.equal(uploader.accepted, true);
  for (let at = 0; at < recording.length; at += 16_384) uploader.client.send(recording.subarray(at, at + 16_384));
  await f.streams.ready("screen", AbortSignal.timeout(10_000));
  await until(async () => uploader.messages.some(message => message.type === "ready"));
  assert.equal(uploader.client.readyState, WebSocket.OPEN);
  let playlist = "";
  await until(async () => {
    playlist = await (await f.streams.response("screen", "stream.m3u8")).text();
    return Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(playlist)?.[1]) > 5;
  });
  const segments = playlist.split("\n").filter(line => line.endsWith(".ts"));
  assert.ok(segments.length > 0 && segments.length <= 8);
  assert.equal((await f.streams.response("screen", "segment-000000000.ts")).status, 404);
  assert.equal((await f.streams.response("screen", "../stream.m3u8")).status, 404);
  assert.equal((await f.streams.response("screen", "stream.m3u8.tmp")).status, 404);
  const segment = await f.streams.response("screen", segments.at(-1)!);
  assert.equal(segment.status, 200);
  assert.equal(segment.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await segment.arrayBuffer());
  assert.equal(decodedFrames(bytes), 10, "Lower capture rates must not be raised to the 30 fps maximum");
  const decoded = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { input: bytes });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  for (const rendition of ["audio", "video"] as const) {
    const filtered = await (await f.streams.response("screen", "stream.m3u8", rendition)).text();
    const name = filtered.split("\n").filter(line => line.endsWith(".ts")).at(-1)!;
    const input = Buffer.from(await (await f.streams.response("screen", name, rendition)).arrayBuffer());
    const included = rendition === "audio" ? "a" : "v", excluded = rendition === "audio" ? "v" : "a";
    assert.equal(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", `0:${included}:0`, "-f", "null", "-"], { input }).status, 0);
    assert.notEqual(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", `0:${excluded}:0`, "-f", "null", "-"], { input }).status, 0, `${rendition} output must omit the unselected captured track`);
    if (rendition === "video") {
      const combined = Buffer.from(await (await f.streams.response("screen", name)).arrayBuffer());
      assert.equal(videoPts(input), videoPts(combined), "In sync picture must keep Core's exact source PTS");
    }
  }
  assert.deepEqual(f.failures, []);
  const [pid, path] = (await readFile(f.marker, "utf8")).trim().split("\n");
  f.streams.end("screen");
  await f.streams.close();
  assert.equal((await f.streams.response("screen", "stream.m3u8")).status, 404);
  await assert.rejects(access(dirname(path!)));
  assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" });
});

test("audio-only input uses the same HLS path without a video track", { skip: !hasFfmpeg, timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const recording = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
  await f.streams.start("audio", { audio: true, video: false });
  const uploader = await f.upload("audio");
  for (let at = 0; at < recording.length; at += 16_384) uploader.client.send(recording.subarray(at, at + 16_384));
  await f.streams.ready("audio", AbortSignal.timeout(10_000));
  for (const rendition of ["av", "audio"] as const) {
    const playlist = await (await f.streams.response("audio", "stream.m3u8", rendition)).text();
    const name = playlist.split("\n").find(line => line.endsWith(".ts"))!;
    const bytes = Buffer.from(await (await f.streams.response("audio", name, rendition)).arrayBuffer());
    assert.equal(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-f", "null", "-"], { input: bytes }).status, 0);
    assert.notEqual(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:v:0", "-f", "null", "-"], { input: bytes }).status, 0);
  }
  assert.equal((await f.streams.response("audio", "stream.m3u8", "video")).status, 404);
});

test("misleading WebM frame-rate metadata cannot multiply captured frames", { skip: !hasFfmpeg, timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const recording = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "4", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-g", "30", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
  // A MediaRecorder WebM can advertise 1000 fps while delivering 30 timestamped
  // frames per second. Change only the Matroska DefaultDuration element; every
  // packet and its audio/video timestamps remain those of the real recording.
  const duration = recording.indexOf(Buffer.from("23e38384", "hex"));
  assert.ok(duration > 0);
  assert.equal(recording.readUInt32BE(duration + 4), 33_333_333);
  recording.writeUInt32BE(1_000_000, duration + 4);
  assert.equal(decodedFrames(recording), 120);
  await f.streams.start("misleading-fps", { audio: true, video: true });
  const uploader = await f.upload("misleading-fps");
  for (let at = 0; at < recording.length; at += 16_384) uploader.client.send(recording.subarray(at, at + 16_384));
  await f.streams.ready("misleading-fps", AbortSignal.timeout(10_000));
  const playlist = await (await f.streams.response("misleading-fps", "stream.m3u8")).text();
  const name = playlist.split("\n").find(line => line.endsWith(".ts"))!;
  const seconds = Number(/#EXTINF:([\d.]+)/.exec(playlist)?.[1]);
  const segment = Buffer.from(await (await f.streams.response("misleading-fps", name)).arrayBuffer());
  const frames = decodedFrames(segment);
  assert.ok(frames >= 29 && frames <= Math.ceil(seconds * 30) + 1, `${frames} encoded frames in a ${seconds}s HLS segment exceeds the capture rate`);
  const timing = spawnSync(ffmpeg, ["-hide_banner", "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0", "-vf", "showinfo", "-af", "ashowinfo", "-fps_mode", "passthrough", "-f", "null", "-"], { input: segment });
  assert.equal(timing.status, 0, String(timing.stderr));
  const output = String(timing.stderr);
  const videoPts = [...output.matchAll(/Parsed_showinfo[^\n]+n:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.]+)/g)].map(match => Number(match[1]));
  const audioPts = [...output.matchAll(/Parsed_ashowinfo[^\n]+n:\d+\s+pts:\d+\s+pts_time:([\d.]+)/g)].map(match => Number(match[1]));
  assert.ok(videoPts.length > 1 && audioPts.length > 1, "Both encoded tracks must retain timestamps");
  assert.ok(Math.abs(videoPts[0]! - audioPts[0]!) < 0.05, "Picture and sound must start within 50 ms");
  assert.ok(Math.abs(videoPts.at(-1)! - audioPts.at(-1)!) < 0.05, "Picture and sound must finish within 50 ms");
  assert.ok(Math.abs(videoPts.at(-1)! - videoPts[0]! - (seconds - 1 / 30)) < 0.02, "The frame limit must preserve the one-second media timeline");
  t.diagnostic(`${frames} frames/${seconds}s; video PTS ${videoPts[0]}–${videoPts.at(-1)}, audio PTS ${audioPts[0]}–${audioPts.at(-1)}`);
});

test("duplicate, textual and disconnected uploads cannot leave a live encoder", { skip: !hasFfmpeg, timeout: 10_000 }, async t => {
  const f = await fixture(t);
  await f.streams.start("bad", { audio: true, video: false });
  const first = await f.upload("bad");
  const second = await f.upload("bad");
  assert.equal(second.accepted, false);
  first.client.send("not binary media");
  await until(async () => f.failures.length === 1);
  await assert.rejects(f.streams.ready("bad"), /stopped/);
  assert.equal((await f.streams.response("bad", "stream.m3u8")).status, 404);
  await f.streams.start("gone", { audio: true, video: false });
  const gone = await f.upload("gone");
  gone.client.close();
  await until(async () => f.failures.length === 2);
  assert.match(f.failures[1]!, /stopped sharing/);
});

test("picture-only input includes a silent clock track for shared playback", { skip: !hasFfmpeg, timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const recording = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-t", "4", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-g", "10", "-an", "-f", "webm", "pipe:1"]);
  await f.streams.start("picture", { audio: false, video: true });
  const uploader = await f.upload("picture");
  for (let at = 0; at < recording.length; at += 16_384) uploader.client.send(recording.subarray(at, at + 16_384));
  await f.streams.ready("picture", AbortSignal.timeout(10_000));
  const playlist = await (await f.streams.response("picture", "stream.m3u8")).text();
  const name = playlist.split("\n").find(line => line.endsWith(".ts"))!;
  const bytes = Buffer.from(await (await f.streams.response("picture", name)).arrayBuffer());
  const audio = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-f", "s16le", "pipe:1"], { input: bytes });
  assert.equal(audio.status, 0, String(audio.stderr));
  assert.ok(audio.stdout.length > 0);
  assert.equal(audio.stdout.some(value => value !== 0), false);
  assert.equal(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:v:0", "-f", "null", "-"], { input: bytes }).status, 0);
  const picture = Buffer.from(await (await f.streams.response("picture", name, "video")).arrayBuffer());
  assert.equal(videoPts(picture), videoPts(bytes), "picture-only capture keeps Core's silent reference clock");
  assert.notEqual(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-f", "null", "-"], { input: picture }).status, 0);
  assert.deepEqual(f.failures, []);
});

test("ending while the encoder helper is pending cannot start a process later", { timeout: 10_000 }, async t => {
  const pending = Promise.withResolvers<string>();
  const f = await fixture(t, () => pending.promise);
  const start = f.streams.start("canceled", { audio: true, video: false });
  const rejected = assert.rejects(start, /stopped/);
  const controller = new AbortController();
  const canceled = assert.rejects(f.streams.ready("canceled", controller.signal), /receiver left/);
  const waiting = assert.rejects(f.streams.ready("canceled"), /stopped/);
  controller.abort(new Error("receiver left"));
  await canceled;
  assert.equal(f.streams.has("canceled"), true, "one caller's cancellation leaves the shared stream intact");
  f.streams.end("canceled");
  await Promise.all([rejected, waiting]);
  pending.resolve(ffmpeg);
  await f.streams.close();
  await assert.rejects(access(f.marker));
  assert.deepEqual(f.failures, []);
});

test("a failed encoder lookup rejects and cleans the pending input", { timeout: 10_000 }, async t => {
  const f = await fixture(t, async () => { throw new Error("unavailable helper"); });
  await assert.rejects(f.streams.start("failed", { audio: true, video: false }), /unavailable helper/);
  assert.equal(f.failures.length, 1);
  await assert.rejects(f.streams.ready("failed"), /stopped/);
});

test("an input that sends no bytes expires and reports an upload error", { skip: !hasFfmpeg, timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const f = await fixture(t);
  await f.streams.start("silent", { audio: true, video: false });
  const uploader = await f.upload("silent");
  const waiting = assert.rejects(f.streams.ready("silent"), /stopped sending media/);
  t.mock.timers.tick(30_001);
  await waiting;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(f.failures.length, 1);
  assert.match(f.failures[0]!, /stopped sending media/);
  assert.equal(uploader.messages.filter(message => message.type === "error").length, 1);
  await assert.rejects(f.streams.ready("silent"), /stopped/);
});

test("a slow helper lookup does not consume the media startup deadline", { skip: !hasFfmpeg, timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const pending = Promise.withResolvers<string>();
  const f = await fixture(t, () => pending.promise);
  const start = f.streams.start("slow-helper", { audio: true, video: false });
  t.mock.timers.tick(35_000);
  pending.resolve(ffmpeg);
  await start;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(f.failures, []);
  await f.upload("slow-helper");
  t.mock.timers.tick(29_000);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(f.failures, []);
  t.mock.timers.tick(1001);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(f.failures.length, 1);
  assert.match(f.failures[0]!, /stopped sending media/);
});
