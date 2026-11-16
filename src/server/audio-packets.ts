// An Opus packet's length from its TOC byte (RFC 6716 3.1), in microseconds.
export const opusDuration = (packet: Buffer) => {
  const config = packet[0]! >> 3,
    code = packet[0]! & 3;
  const frame =
    config < 12
      ? [10, 20, 40, 60][config & 3]!
      : config < 16
        ? [10, 20][config & 1]!
        : [2.5, 5, 10, 20][config & 3]!;
  return frame * 1000 * (code === 0 ? 1 : code === 3 ? packet[1]! & 0x3f : 2);
};
// Splits an Ogg stream into its packets (RFC 3533).
export function oggPackets(onPacket: (packet: Buffer) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let partial: Buffer[] = [];
  return (data: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    while (pending.length >= 27) {
      if (pending.toString("latin1", 0, 4) !== "OggS")
        throw new Error("FFmpeg sent a broken Ogg stream.");
      const segments = pending[26]!,
        header = 27 + segments;
      if (pending.length < header) return;
      let size = 0;
      for (let index = 0; index < segments; index++) size += pending[27 + index]!;
      if (pending.length < header + size) return;
      for (let index = 0, at = header; index < segments; index++) {
        const lace = pending[27 + index]!;
        partial.push(pending.subarray(at, (at += lace)));
        if (lace < 255) {
          onPacket(Buffer.concat(partial));
          partial = [];
        }
      }
      pending = pending.subarray(header + size);
    }
  };
}

// Splits an MPEG-TS stream into the Opus packets on one PID, with the start trim (pre-skip) in
// samples that the Opus mapping puts in its first packet's control header.
export function tsOpusPackets(pid: number, onPacket: (packet: Buffer, trim: number) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let payload: Buffer = Buffer.alloc(0);
  const broken = () => new Error("FFmpeg sent a broken MPEG-TS stream.");
  const accessUnits = () => {
    while (payload.length >= 2) {
      if (payload.readUInt16BE(0) >> 5 !== 0x3ff) throw broken();
      const flags = payload[1]!;
      let at = 2,
        size = 0,
        byte: number;
      do {
        if (at >= payload.length) return;
        byte = payload[at++]!;
        size += byte;
      } while (byte === 255);
      const trimAt = at;
      if (flags & 0x10) at += 2;
      if (flags & 0x08) at += 2;
      if (flags & 0x04) {
        if (at >= payload.length) return;
        at += 1 + payload[at]!;
      }
      if (at + size > payload.length) return;
      const trim = flags & 0x10 ? payload.readUInt16BE(trimAt) & 0x1fff : 0;
      onPacket(Buffer.from(payload.subarray(at, at + size)), trim);
      payload = payload.subarray(at + size);
    }
  };
  return (data: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    for (; pending.length >= 188; pending = pending.subarray(188)) {
      if (pending[0] !== 0x47) throw broken();
      if ((((pending[1]! & 0x1f) << 8) | pending[2]!) !== pid) continue;
      const control = (pending[3]! >> 4) & 3;
      if (!(control & 1)) continue;
      let at = control & 2 ? 5 + pending[4]! : 4;
      if (pending[1]! & 0x40) {
        // A new PES packet: the last one's access units must all have been whole.
        if (payload.length || pending.readUIntBE(at, 3) !== 1) throw broken();
        at += 9 + pending[at + 8]!;
      }
      if (at > 188) throw broken();
      payload = Buffer.concat([payload, pending.subarray(at, 188)]);
      accessUnits();
    }
  };
}
