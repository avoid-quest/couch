/** Source-clock timestamps are integer microseconds; PCM is interleaved, never invented stereo. */
export type CaptureAudioPacket = {
  generation: string;
  sequence: number;
  samplePosition: number;
  capturedAtUs: number;
  sampleRate: number;
  channels: 1 | 2;
  pcm: Float32Array;
};
const maxFrames = 4096;

export function validateCapturePacket(packet: CaptureAudioPacket) {
  if (!packet || typeof packet.generation !== "string" || !/^[\w-]{1,64}$/.test(packet.generation)
    || ![packet.sequence, packet.samplePosition, packet.capturedAtUs].every(n => Number.isSafeInteger(n) && n >= 0)
    || ![44_100, 48_000, 96_000].includes(packet.sampleRate) || ![1, 2].includes(packet.channels)
    || !(packet.pcm instanceof Float32Array) || !packet.pcm.length || packet.pcm.length % packet.channels
    || packet.pcm.length / packet.channels > maxFrames) throw new Error("Invalid timestamped audio packet.");
  for (const sample of packet.pcm) if (!Number.isFinite(sample) || Math.abs(sample) > 8) throw new Error("Invalid captured sample.");
}

// Binary upload v1: 40-byte LE header and f32 interleaved samples. Generation is negotiated once.
// Capture time is signed: a frame can precede its upload worker's performance.timeOrigin.
export function decodeCapturePacket(data: Buffer, generation: string, clockOffsetUs: number): CaptureAudioPacket {
  if (data.length < 44 || data.length > 40 + maxFrames * 8 || data.readUInt32LE(0) !== 0x31414343 || data.readUInt16LE(6) !== 40) throw new Error("Invalid PCM upload frame.");
  const packet: CaptureAudioPacket = {
    generation, channels: data.readUInt8(4) as 1 | 2, sampleRate: data.readUInt32LE(8), sequence: data.readUInt32LE(12),
    samplePosition: Number(data.readBigUInt64LE(16)), capturedAtUs: Math.round(Number(data.readBigInt64LE(24)) + clockOffsetUs),
    pcm: new Float32Array(data.buffer.slice(data.byteOffset + 40, data.byteOffset + data.length)),
  };
  if (data.readUInt32LE(32) !== packet.pcm.length / packet.channels || data.readUInt8(5) !== 1 || data.readUInt32LE(36) !== 0) throw new Error("Invalid PCM upload header.");
  validateCapturePacket(packet);
  return packet;
}
