import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { AudioCodec, Roles, SendspinClient, type SessionUpdateMetadata } from "@sonn-audio/node-sendspin";
import type { PlaybackCommand } from "../src/shared/protocol";
import type { liveFixture } from "./live-input.fixture";

export const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
export const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
export type Fixture = Awaited<ReturnType<typeof liveFixture>>;
export type Receiver = Fixture["receiver"];
export type Load = Extract<PlaybackCommand, { type: "load" }>;
export const loads = (receiver: Receiver) => receiver.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
export const ingests = (f: Fixture) => f.encoders().filter(encoder => encoder.args.includes("-f tee"));
export const positions = (metadata: SessionUpdateMetadata[]) => metadata.flatMap(point => typeof point.progress === "object" && point.progress ? [{ timestamp: point.timestamp, position: point.progress.track_progress / 1000 }] : []);
export const runMedia = (args: string[]) => new Promise<Buffer>((resolve, reject) => execFile(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
export const recording = (seconds = 24, audio = true) => runMedia(["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", ...audio ? ["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000"] : [], "-t", String(seconds), "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-g", "10", ...audio ? ["-c:a", "libopus", "-ac", "2"] : ["-an"], "-f", "webm", "pipe:1"]);

export async function segment(source: string, first = false) {
  const playlist = await fetch(source);
  assert.equal(playlist.status, 200);
  const text = await playlist.text();
  const names = text.split("\n").filter(line => line.endsWith(".ts"));
  assert.ok(names.length, "the authorized playlist must contain complete media");
  const url = new URL(first ? names[0]! : names.at(-1)!, source).href;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return { url, bytes: Buffer.from(await response.arrayBuffer()), text };
}

// Decode real output and retain its absolute MPEG-TS PTS. A fake playlist or
// successful HTTP response cannot satisfy these assertions.
export function decode(bytes: Buffer, audio: boolean) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-copyts", "-i", "pipe:0", "-map", "0:v:0", ...audio ? ["-map", "0:a:0", "-af", "ashowinfo"] : [], "-vf", "showinfo", "-f", "null", "-"], { input: bytes, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  const pts = (filter: string) => [...String(result.stderr).matchAll(new RegExp(`Parsed_${filter}[^\\n]+n:\\s*\\d+\\s+pts:\\s*-?\\d+\\s+pts_time:([\\d.-]+)`, "g"))].map(match => Number(match[1]));
  const videoPts = pts("showinfo"), audioPts = pts("ashowinfo");
  assert.ok(videoPts.length >= 9, "a full segment must decode captured frames");
  if (audio) {
    assert.ok(audioPts.length > 1, "fallback must decode sound too");
    assert.ok(Math.abs(videoPts[0]! - audioPts[0]!) < 0.05, "picture and sound retain the same source timeline");
    const pcm = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-f", "s16le", "pipe:1"], { input: bytes });
    assert.equal(pcm.status, 0, String(pcm.stderr));
    assert.ok(pcm.stdout.some(byte => byte !== 0), "the captured tone must survive decoding");
  } else {
    assert.notEqual(spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-f", "null", "-"], { input: bytes }).status, 0, "picture-only receivers must not download an audio track");
  }
  return { videoPts, audioPts };
}

export async function speaker(f: Fixture, index: number) {
  const identity = f.identities[index]!;
  const frames: { timestamp: number; bytes: Buffer }[] = [], metadata: SessionUpdateMetadata[] = [];
  let starts = 0, clears = 0;
  const client = new SendspinClient(identity.id, "R4 software speaker", [Roles.PLAYER, Roles.METADATA], { encryption: { identity: identity.key }, playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 2_000_000, supported_commands: [] } });
  client.addAudioChunkListener((timestamp, bytes) => frames.push({ timestamp, bytes: Buffer.from(bytes) }));
  client.addMetadataListener(payload => { if (payload.metadata) metadata.push(payload.metadata); });
  client.addStreamStartListener(() => starts++);
  client.addStreamClearListener(() => clears++);
  await client.connect(`${f.hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
  return { client, frames, metadata, get starts() { return starts; }, get clears() { return clears; } };
}

export async function start(f: Fixture) {
  await f.publish("screen");
  assert.equal((await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  const result = await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
  assert.equal(result.ok, true, result.error);
}
