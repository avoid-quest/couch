import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs, type SessionUpdateMetadata } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { physical } from "../packaging/tv/evidence.js";
import { writeEvidence } from "./evidence";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 6_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// An eight-segment live window advances at wall-clock speed. This locks the age
// of samples at their scheduled play time, not just startup speed or group routing.
for (const silent of [false, true]) test(`live HLS ${silent ? "silence" : "sound"} starts near capture time on both speakers`, { timeout: 15_000, skip: !available && "Set COUCH_TEST_FFMPEG to run real-media latency coverage." }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-live-latency-"));
  const clients: SendspinClient[] = [], keys = [Identity.generate(), Identity.generate()];
  const core = createSendspin({ name: "Latency fixture", admit: id => keys.some(key => key.peerId === id), changed() {}, ffmpeg: async () => ffmpeg });
  const group = core.group("live-latency", () => {});
  let began = Date.now();
  const latest = () => 13 + Math.floor((Date.now() - began) / 1000);
  const server = createServer((request, response) => {
    const file = new URL(request.url!, "http://localhost").pathname.slice(1);
    if (file === "stream") {
      const end = latest();
      response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      response.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${end - 7}\n#EXT-X-INDEPENDENT-SEGMENTS\n` + Array.from({ length: 8 }, (_, index) => `#EXTINF:1.000000,\nsegment${end - 7 + index}.ts\n`).join(""));
    } else if (/^segment\d+\.ts$/.test(file)) {
      response.setHeader("Content-Type", "video/mp2t");
      response.end(readFileSync(join(directory, file)));
    } else response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server, path: "/sendspin" });
  sockets.on("connection", (socket, request) => core.accept(socket, request));
  t.after(async () => {
    group.close(); core.close();
    await Promise.all(clients.map(client => client.disconnect()));
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10", "-f", "lavfi", "-i", silent ? "anullsrc=r=48000:cl=stereo" : "sine=frequency=440:sample_rate=48000", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "10", "-c:a", "aac", "-ac", "2", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_filename", join(directory, "segment%d.ts"), join(directory, "source.m3u8")], { stdio: "pipe" });
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-copyts", "-i", join(directory, "segment0.ts"), "-map", "0:v:0", "-vf", "showinfo", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const pts = /Parsed_showinfo.*?\bn:\s*0\s.*?pts_time:([\d.]+)/.exec(probe.stderr); assert.ok(pts);
  const capturePosition = () => Number(pts[1]) + 14 + (Date.now() - began) / 1000;
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const receivers = await Promise.all(keys.map(async (key, index) => {
    const frames: { timestamp: number; received: number; capturePosition: number; data: Buffer }[] = [], metadata: SessionUpdateMetadata[] = [];
    const client = new SendspinClient(key.peerId, `Receiver ${index}`, [Roles.PLAYER, Roles.METADATA], { playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48_000, channels: 2, bit_depth: 16 }], buffer_capacity: 2_000_000, supported_commands: [] } });
    clients.push(client);
    client.addAudioChunkListener((timestamp, data) => frames.push({ timestamp, received: serverNowUs(), capturePosition: capturePosition(), data: Buffer.from(data) }));
    client.addMetadataListener(payload => { if (payload.metadata) metadata.push(payload.metadata); });
    await client.connect(origin.replace("http:", "ws:") + "/sendspin", { timeoutMs: 3_000 });
    return { frames, metadata };
  }));
  group.members(keys.map(key => ({ deviceId: key.peerId, level: 100 }))); group.screens(keys.map(key => key.peerId));
  began = Date.now();
  group.send({ type: "load", playbackId: "live-latency", source: origin + "/stream", live: true });
  await until(() => receivers.every(receiver => receiver.frames.length >= 10 && receiver.metadata.some(item => item.progress?.playback_speed === 1000)), "Live audio and its clock did not start");
  const [first, second] = receivers;
  const original = new Map(first!.frames.map(frame => [frame.timestamp, frame.data]));
  const common = second!.frames.filter(frame => original.has(frame.timestamp));
  assert.ok(common.length >= 10, "receivers must share packet timestamps");
  for (const frame of common) assert.deepEqual(original.get(frame.timestamp), frame.data, "receivers must get identical packets on the shared clock");
  for (let index = 1; index < first!.frames.length; index++) assert.equal(first!.frames[index]!.timestamp - first!.frames[index - 1]!.timestamp, 60_000, "the audio clock must remain continuous");
  const frame = first!.frames[0]!, point = first!.metadata.find(item => item.progress?.playback_speed === 1000)!;
  const sourcePosition = point.progress!.track_progress / 1000 + (frame.timestamp - point.timestamp) / 1e6;
  const age = frame.capturePosition + (frame.timestamp - frame.received) / 1e6 - sourcePosition;
  t.diagnostic(`Capture age at scheduled playback: ${age.toFixed(3)}s; ${common.length} matching shared packets.`);
  await writeEvidence(`live-latency-${silent ? "silence" : "sound"}`, {
    input: `FFmpeg ${execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }).split("\n")[0]!.split(" ")[2]} live HLS over loopback to two Node Sendspin receivers; first packet at startup`,
    measured: { captureAgeS: age, sharedPackets: common.length },
    untested: ["steady-state age after startup", "browser players", "network between devices", ...physical],
  });
  assert.ok(age < 3, `Live audio is ${age.toFixed(2)}s old when scheduled; expected less than 3s.`);
});

// The live edge/probe options belong only to identified live HLS. The executable
// boundary catches accidental application to radio, finite HLS and raw MPEG-TS.
for (const kind of ["live-hls", "vod-hls", "radio-hls", "live-mpegts"] as const) test(`Sendspin scopes live HLS options for ${kind}`, { timeout: 5_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-options-")), argumentsPath = join(directory, "arguments.json"), executable = join(directory, "ffmpeg");
  writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv.slice(2))); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", kind === "live-mpegts" ? "video/mp2t" : "application/vnd.apple.mpegurl");
    response.end(kind === "live-mpegts" ? Buffer.from([0x47, 0x40, 0x11, 0x10]) : "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n");
  });
  const core = createSendspin({ name: "Options fixture", admit: () => false, changed() {}, ffmpeg: async () => executable });
  const group = core.group("options", () => {});
  group.members([{ deviceId: "speaker", level: 100 }]);
  t.after(async () => { group.close(); core.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  group.send({ type: "load", playbackId: "options", source: `http://127.0.0.1:${address.port}/opaque-stream`, live: kind !== "vod-hls", radio: kind === "radio-hls" });
  await until(() => existsSync(argumentsPath), "FFmpeg was not started");
  const args = JSON.parse(readFileSync(argumentsPath, "utf8")) as string[];
  for (const [flag, value] of [["-live_start_index", "-1"], ["-probesize", "32768"], ["-analyzeduration", "100000"]]) {
    const index = args.indexOf(flag!);
    if (kind === "live-hls") { assert.ok(index >= 0 && index < args.indexOf("-i"), `${flag} must apply to the live HLS input`); assert.equal(args[index + 1], value); }
    else assert.equal(index, -1, `${flag} must not change ${kind}`);
  }
});
