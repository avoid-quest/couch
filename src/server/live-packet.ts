// A Live audio packet's 24-byte header (live-transport.ts has the whole contract).
export const pcmCodec = 1, opusCodec = 2;
const headerBytes = 24;

export function livePacket(codec: number, frames: number, seq: number, position: number, captureUs: number, payload: Uint8Array) {
  const out = Buffer.allocUnsafe(headerBytes + payload.length);
  out.writeUInt8(codec, 0); out.writeUInt8(2, 1); out.writeUInt16LE(frames, 2); out.writeUInt32LE(seq >>> 0, 4);
  out.writeDoubleLE(position, 8); out.writeDoubleLE(captureUs, 16); out.set(payload, headerBytes);
  return out;
}
export const readLivePacket = (data: Buffer) => ({ codec: data.readUInt8(0), channels: data.readUInt8(1), frames: data.readUInt16LE(2), seq: data.readUInt32LE(4),
  position: data.readDoubleLE(8), captureUs: data.readDoubleLE(16), payload: data.subarray(headerBytes) });
