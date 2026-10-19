// UxPlay forwards each AirPlay session's decoded sound as L16 RTP (RFC 3551: 16-bit
// big-endian PCM, here 44.1 kHz stereo) and Couch's -artp pipeline frames every packet
// with a 16-bit length (rtpstreampay, RFC 4571) on a private pipe. This turns that into
// one continuous PCM stream on Core's own clock: the sender's RTP timestamps place each
// sample, gaps and pauses become silence, and nothing it sends can grow memory.
export const sampleRate = 44_100;
export const bytesPerSample = 4; // one stereo frame of two 16-bit samples
export const payloadType = 96;
const maxPacket = 4096; // rtpL16pay's MTU is 1400 bytes
const prebuffer = sampleRate / 4; // what a packet may arrive late by and still play
const capacity = sampleRate * 2; // the furthest ahead of playout a packet may be
const maxTick = sampleRate * 2; // an event-loop stall skips time rather than buffering it

export type RtpPacket = { sequence: number; timestamp: number; ssrc: number; payload: Buffer };

export function parseRtp(packet: Buffer): RtpPacket | null {
  if (packet.length < 12 || packet[0]! >> 6 !== 2 || (packet[1]! & 0x7f) !== payloadType) return null;
  let start = 12 + (packet[0]! & 0x0f) * 4, end = packet.length;
  if (packet[0]! & 0x10) {
    if (start + 4 > end) return null;
    start += 4 + packet.readUInt16BE(start + 2) * 4;
  }
  if (packet[0]! & 0x20) end -= packet[end - 1]!;
  if (start >= end || (end - start) % bytesPerSample) return null;
  return { sequence: packet.readUInt16BE(2), timestamp: packet.readUInt32BE(4), ssrc: packet.readUInt32BE(8), payload: packet.subarray(start, end) };
}

export function createAudioIngress(options: { now?: () => number } = {}) {
  const now = options.now ?? (() => performance.now());
  let pending: Buffer = Buffer.alloc(0);
  // Packets by their unwrapped timestamp, in order; `next` is the first sample not yet played.
  let packets: { at: number; payload: Buffer }[] = [];
  let ssrc: number | undefined, last = 0, unwrapped = 0, newest = -Infinity, next: number | undefined;
  let startedAt: number | undefined, emitted = 0;
  const stats = { packets: 0, invalid: 0, late: 0, resyncs: 0 };
  const resync = (at: number) => { packets = []; next = at - prebuffer; stats.resyncs++; };

  const place = (packet: RtpPacket) => {
    // A new pipeline (UxPlay restarts it for another audio format) starts its own clock.
    if (packet.ssrc !== ssrc) {
      if (ssrc !== undefined) { packets = []; next = undefined; newest = -Infinity; stats.resyncs++; }
      ssrc = packet.ssrc;
      unwrapped = packet.timestamp;
    } else unwrapped += (packet.timestamp - last) | 0; // RTP timestamps wrap at 32 bits
    last = packet.timestamp;
    const at = unwrapped, end = at + packet.payload.length / bytesPerSample;
    next ??= at - prebuffer;
    // A pause or seek moves the sender's clock past what may be buffered, and a sender
    // whose clock runs slower than Core's eventually arrives late in order: start again from it.
    if (end > next + capacity || end <= next && at >= newest) resync(at);
    newest = Math.max(newest, at);
    if (end <= next) { stats.late++; return; } // A straggler, after what already played
    let index = packets.length;
    while (index && packets[index - 1]!.at > at) index--;
    if (packets[index - 1]?.at === at) return; // A repeat
    packets.splice(index, 0, { at, payload: Buffer.from(packet.payload) });
    stats.packets++;
  };
  const pull = (samples: number) => {
    const output = Buffer.alloc(samples * bytesPerSample);
    if (next === undefined) return output;
    const until = next + samples;
    for (const packet of packets) {
      if (packet.at >= until) break;
      const from = Math.max(packet.at, next), to = Math.min(packet.at + packet.payload.length / bytesPerSample, until);
      if (to > from) packet.payload.copy(output, (from - next) * bytesPerSample, (from - packet.at) * bytesPerSample, (to - packet.at) * bytesPerSample);
    }
    packets = packets.filter(packet => packet.at + packet.payload.length / bytesPerSample > until);
    next = until;
    return output;
  };

  return {
    stats,
    /** Bytes from the pipe, in any chunking. False when the framing is broken. */
    push(chunk: Buffer) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 2) {
        const length = pending.readUInt16BE(0);
        if (!length || length > maxPacket) { pending = Buffer.alloc(0); return false; }
        if (pending.length < 2 + length) break;
        const packet = parseRtp(pending.subarray(2, 2 + length));
        pending = pending.subarray(2 + length);
        if (packet) place(packet);
        else stats.invalid++;
      }
      return true;
    },
    /** The PCM due since the last call, silence where nothing arrived in time. */
    tick() {
      const time = now();
      startedAt ??= time;
      let due = Math.floor((time - startedAt) * sampleRate / 1000) - emitted;
      if (due > maxTick) { emitted += due - maxTick; due = maxTick; }
      if (due <= 0) return Buffer.alloc(0);
      emitted += due;
      return pull(due);
    },
    /** Samples received ahead of playout. */
    buffered: () => next === undefined ? 0 : Math.max(0, (packets.at(-1) ? packets.at(-1)!.at + packets.at(-1)!.payload.length / bytesPerSample : next) - next),
  };
}
