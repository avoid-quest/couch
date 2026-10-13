import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, type SessionUpdateMetadata } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Real HLS decoding and encrypted Sendspin clients: these assertions lock the shared
// media clock, not just output routing. No sound is emitted by these SDK receivers.
for (const codec of [AudioCodec.PCM, AudioCodec.OPUS]) test(`live ${codec} shares audio timestamps and picture PTS across joins`, { timeout: 20_000, skip: !available && "Set COUCH_TEST_FFMPEG to run the real-media clock test." }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-live-clock-"));
  const clients: SendspinClient[] = [];
  const keys = [Identity.generate(), Identity.generate()];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Clock fixture", admit: id => keys.some(key => key.peerId === id), changed: () => {}, ffmpeg: async () => ffmpeg });
  const group = core.group("live-clock", () => {});
  const server = createServer((request, response) => {
    const name = new URL(request.url!, "http://localhost").pathname.slice(1);
    if (!/^(?:index\.m3u8|segment\d+\.ts)$/.test(name)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", name.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
    response.end(readFileSync(join(directory, name)));
  });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  t.after(async () => {
    group.close(); core.close();
    await Promise.all(clients.map(client => client.disconnect()));
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  // A nonzero source timestamp catches pictures incorrectly anchored to zero. The
  // fixture has real video and stereo audio in the same MPEG-TS presentation clock.
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "10", "-c:a", "aac", "-ac", "2", "-output_ts_offset", "7", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_filename", join(directory, "segment%d.ts"), join(directory, "index.m3u8")], { stdio: "pipe" });
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-copyts", "-i", join(directory, "segment0.ts"), "-vf", "showinfo", "-af", "ashowinfo", "-frames:v", "1", "-frames:a", "1", "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const firstPts = (filter: string) => {
    const match = new RegExp(`Parsed_${filter}.*?\\bn:\\s*0\\s.*?pts_time:([\\d.]+)`).exec(probe.stderr);
    assert.ok(match, `Missing ${filter} source timestamp`);
    return Number(match[1]);
  };
  const audioPts = firstPts("ashowinfo"), videoPts = firstPts("showinfo");
  assert.ok(audioPts > 7 && Math.abs(videoPts - audioPts) < 0.05, "fixture audio/video must share a nonzero presentation clock");
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  async function receiver(index: number) {
    const key = keys[index]!;
    const frames: { timestamp: number; bytes: Buffer }[] = [], metadata: SessionUpdateMetadata[] = [], groups: string[] = [];
    let starts = 0, ends = 0, clears = 0;
    const client = new SendspinClient(key.peerId, `Receiver ${index}`, [Roles.PLAYER, Roles.METADATA], {
      encryption: { identity: key },
      playerSupport: { supported_formats: [{ codec, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 2_000_000, supported_commands: [] },
    });
    clients.push(client);
    client.addAudioChunkListener((timestamp, bytes) => frames.push({ timestamp, bytes: Buffer.from(bytes) }));
    client.addMetadataListener(payload => { if (payload.metadata) metadata.push(payload.metadata); });
    client.addGroupUpdateListener(payload => { if (payload.group_id) groups.push(payload.group_id); });
    client.addStreamStartListener(() => starts++);
    client.addStreamEndListener(() => ends++);
    client.addStreamClearListener(() => clears++);
    await client.connect(`${origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
    return { id: key.peerId, frames, metadata, groups, get starts() { return starts; }, get ends() { return ends; }, get clears() { return clears; } };
  }
  const first = await receiver(0);
  group.members([{ deviceId: first.id, level: 100 }]);
  group.screens([first.id]);
  group.send({ type: "load", playbackId: "live-clock", source: `${origin}/index.m3u8`, live: true });
  await until(() => first.frames.length >= 15, "First receiver received no decoded audio");
  assert.ok(first.frames.some(frame => frame.bytes.some(byte => byte !== 0)), "real fixture must contain audible samples");
  const second = await receiver(1);
  const both = [{ deviceId: first.id, level: 100 }, { deviceId: second.id, level: 50 }];
  group.members(both); group.screens([first.id, second.id]);
  await until(() => second.frames.length >= 8 && first.frames.at(-1)!.timestamp >= second.frames.at(-1)!.timestamp && second.metadata.some(item => item.progress?.playback_speed === 1000), "Late receiver did not join the live clock");
  const assertShared = () => {
    const original = new Map(first.frames.map(frame => [frame.timestamp, frame.bytes]));
    for (const frame of second.frames) assert.deepEqual(original.get(frame.timestamp), frame.bytes, "both devices must receive identical samples with identical play times");
    assert.equal(first.groups.at(-1), "live-clock");
    assert.equal(second.groups.at(-1), "live-clock");
  };
  assertShared();
  // Metadata's timestamp maps picture PTS to exactly the audio packet clock.
  // Opus's initial decoder pre-skip is below this 30 ms bound; PCM has no pre-skip.
  for (const receiver of [first, second]) {
    const point = receiver.metadata.findLast(item => item.progress?.playback_speed === 1000)!;
    const expectedPts = audioPts + (point.timestamp - first.frames[0]!.timestamp) / 1_000_000;
    assert.ok(Math.abs(point.progress!.track_progress / 1000 - expectedPts) < 0.03, "picture metadata must track source PTS on the shared audio clock");
  }
  group.members(both.slice(0, 1));
  await until(() => second.ends === 1, "Leaving receiver was not stopped");
  const leftAt = second.frames.length, firstAt = first.frames.length;
  await until(() => first.frames.length >= firstAt + 5, "Remaining receiver stopped when another left");
  assert.equal(second.frames.length, leftAt);
  group.members(both);
  await until(() => second.frames.length >= leftAt + 5 && first.frames.at(-1)!.timestamp >= second.frames.at(-1)!.timestamp, "Returning receiver did not rejoin");
  assertShared();
  assert.equal(first.starts, 1, "membership changes must not restart existing sound");
  assert.equal(first.clears, 0, "membership changes must not reset the shared clock");
  assert.equal(second.starts, 2);
  const interval = codec === AudioCodec.PCM ? 100_000 : 60_000;
  for (let index = 1; index < first.frames.length; index++) assert.equal(first.frames[index]!.timestamp - first.frames[index - 1]!.timestamp, interval, "the existing receiver's clock must remain continuous across joins");
  const pictureBefore = first.metadata.at(-1)!.progress!.track_progress;
  group.members([]);
  await until(() => (first.metadata.at(-1)?.progress?.track_progress ?? 0) > pictureBefore + 100, "Pictures lost their timeline when all speakers left");
  assert.equal(first.metadata.at(-1)!.progress!.playback_speed, 1000);
  t.diagnostic(`${codec}: ${first.frames.length} original / ${second.frames.length} joined packets matched; source audio PTS ${audioPts}s, video PTS ${videoPts}s; shared metadata stayed within 30 ms.`);
});
