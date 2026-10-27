import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import OpusScript from "opusscript";
import type { WebSocket } from "ws";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { createLiveTransport, createOpusEncoder } from "../src/server/live-transport";
import { livePacket, opusCodec, pcmCodec, readLivePacket } from "../src/server/live-packet";
import { defaultLiveAudioSettings } from "../src/shared/audio-settings";
import type { LiveAudioSettings } from "../src/shared/protocol";

const listener = () => Object.assign(new EventEmitter(), { readyState: 1, sent: [] as (Buffer | string)[], send(data: Buffer | string) { this.sent.push(data); }, close() {} });
const fixture = (settings: Partial<LiveAudioSettings> = {}) => {
  const transport = createLiveTransport({ sourceId: "source", epoch: "epoch", settings: { ...defaultLiveAudioSettings, ...settings }, changed() {}, log() {} });
  const socket = listener();
  transport.accept(socket as unknown as WebSocket, "device");
  const packets = () => socket.sent.filter(data => typeof data !== "string").map(data => readLivePacket(data as Buffer));
  const messages = () => socket.sent.filter(data => typeof data === "string").map(data => JSON.parse(data as string));
  return { transport, socket, packets, messages };
};
const capture = (generation: string, samplePosition: number, frames: number, capturedAtUs = serverNowUs() - 1000) => ({ generation, sequence: samplePosition, samplePosition, capturedAtUs,
  sampleRate: 48_000, channels: 2 as const, pcm: Float32Array.from({ length: frames * 2 }, (_, i) => i % 2 ? -.25 : .25) });

test("the packet header round-trips the prototype's layout", () => {
  const data = livePacket(opusCodec, 120, 2 ** 32 + 5, -120, 1234.5, Uint8Array.of(9, 8, 7));
  expect(data.length).toBe(27);
  expect([data[0], data[1], data.readUInt16LE(2), data.readUInt32LE(4), data.readDoubleLE(8), data.readDoubleLE(16)]).toEqual([2, 2, 120, 5, -120, 1234.5]);
  expect(readLivePacket(data)).toMatchObject({ codec: opusCodec, channels: 2, frames: 120, seq: 5, position: -120, captureUs: 1234.5 });
  expect([...readLivePacket(data).payload]).toEqual([9, 8, 7]);
});

test("PCM leaves in 128-frame packets numbered per codec, and a capture restart starts a new session at zero", () => {
  const { transport, packets, messages } = fixture();
  const first = messages().find(message => message.type === "hello");
  expect(first).toMatchObject({ leadMs: 100, codec: pcmCodec, opusFrames: 120 });
  const at = serverNowUs() - 1000;
  transport.write(capture("a", 0, 300, at));
  transport.write(capture("a", 300, 128, at + 300 / 48_000 * 1e6));
  expect(packets().map(p => [p.codec, p.frames, p.seq, p.position])).toEqual([[1, 128, 0, 0], [1, 128, 1, 128], [1, 44, 2, 256], [1, 128, 3, 300]]);
  expect(packets()[1]!.captureUs).toBeCloseTo(at + 128 / 48_000 * 1e6, 6);
  expect(packets()[0]!.payload.readInt16LE(0)).toBe(8192);
  expect(packets()[0]!.payload.readInt16LE(2)).toBe(-8192);
  const sessions = messages().filter(message => message.type === "hello").map(message => message.session);
  transport.write(capture("b", 0, 128));
  const restarted = messages().filter(message => message.type === "hello").at(-1)!.session;
  expect(new Set([...sessions, restarted]).size).toBe(sessions.length + 1);
  expect(packets().at(-1)).toMatchObject({ seq: 0, position: 0 });
  transport.close();
});

test("a packet that can no longer make its deadline is never sent", () => {
  const { transport, packets } = fixture({ lead: "fixed", leadMs: 20 });
  transport.write(capture("a", 0, 128, serverNowUs() - 25_000));
  expect(packets()).toEqual([]);
  transport.write(capture("a", 128, 128));
  expect(packets().map(p => p.position)).toEqual([128]);
  transport.close();
});

test("Opus frames are 2.5 ms, their position and time moved back by the encoder's own lookahead", () => {
  const lookahead = createOpusEncoder(192_000).lookahead;
  expect(lookahead).toBe(120);
  const { transport, packets } = fixture({ codec: "opus" });
  const at = serverNowUs() - 1000;
  transport.write(capture("a", 0, 200, at));
  transport.write(capture("a", 200, 160, at + 200 / 48_000 * 1e6));
  expect(packets().map(p => [p.codec, p.frames, p.seq, p.position])).toEqual([[2, 120, 0, -lookahead], [2, 120, 1, 120 - lookahead], [2, 120, 2, 240 - lookahead]]);
  expect(packets()[1]!.captureUs).toBeCloseTo(at + (120 - lookahead) / 48_000 * 1e6, 6);
  const decoder = new OpusScript(48_000, 2);
  expect(decoder.decode(packets()[0]!.payload).length).toBe(120 * 4);
  transport.close();
});
