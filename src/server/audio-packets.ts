// An Opus packet's length from its TOC byte (RFC 6716 3.1), in microseconds.
export const opusDuration = (packet: Buffer) => {
  const config = packet[0]! >> 3, code = packet[0]! & 3;
  const frame = config < 12 ? [10, 20, 40, 60][config & 3]! : config < 16 ? [10, 20][config & 1]! : [2.5, 5, 10, 20][config & 3]!;
  return frame * 1000 * (code === 0 ? 1 : code === 3 ? packet[1]! & 0x3f : 2);
};
// Splits an Ogg stream into its packets (RFC 3533).
export function oggPackets(onPacket: (packet: Buffer) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let partial: Buffer[] = [];
  return (data: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    while (pending.length >= 27) {
      if (pending.toString("latin1", 0, 4) !== "OggS") throw new Error("FFmpeg sent a broken Ogg stream.");
      const segments = pending[26]!, header = 27 + segments;
      if (pending.length < header) return;
      let size = 0;
      for (let index = 0; index < segments; index++) size += pending[27 + index]!;
      if (pending.length < header + size) return;
      for (let index = 0, at = header; index < segments; index++) {
        const lace = pending[27 + index]!;
        partial.push(pending.subarray(at, at += lace));
        if (lace < 255) { onPacket(Buffer.concat(partial)); partial = []; }
      }
      pending = pending.subarray(header + size);
    }
  };
}
