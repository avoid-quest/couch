import { expect, test } from "bun:test";
import { decodeCapturePacket, validateCapturePacket, type CaptureAudioPacket } from "../src/server/capture-audio";
const packet: CaptureAudioPacket = { generation: "capture-1", sequence: 0, samplePosition: 0, capturedAtUs: 1_000_000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) };

test("malformed and oversized capture samples fail before encoding", () => {
  for (const pcm of [new Float32Array(8194), new Float32Array([NaN, 0])]) expect(() => validateCapturePacket({ ...packet, pcm })).toThrow();
  expect(() => decodeCapturePacket(Buffer.alloc(80), "generation", 0)).toThrow();
});

test("capture timestamps preceding the upload worker origin map to the server clock", () => {
  const data = Buffer.alloc(40 + 960 * 4);
  data.writeUInt32LE(0x31414343, 0); data.writeUInt8(2, 4); data.writeUInt8(1, 5);
  data.writeUInt16LE(40, 6); data.writeUInt32LE(48000, 8); data.writeBigInt64LE(-150_000n, 24); data.writeUInt32LE(480, 32);
  expect(decodeCapturePacket(data, "source-realm", 1_000_000).capturedAtUs).toBe(850_000);
});
