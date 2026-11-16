// UxPlay forwards each AirPlay session's decoded sound as L16 RTP (RFC 3551: 16-bit
// big-endian PCM, here 44.1 kHz stereo) and Couch's -artp pipeline frames every packet
// with a 16-bit length (rtpstreampay, RFC 4571) on a private pipe. This turns that into
// one continuous PCM stream, each part with its time on Core's clock: the RTP timestamps place each
// sample, gaps and pauses become silence, and nothing it sends can grow memory.
// Couch's UxPlay patch (native/airplay/uxplay-sender-time.patch) sends a stream that keeps the
// sender's timing (audio-only AirPlay) as payload type 97: each RTP timestamp is when the sender
// means that packet to be heard, on this computer's wall clock in units of 1/44100 s modulo 2^32.
// Any other stream (mirroring) is 96, timed by its arrival, and so is a 97 stream whose times
// Couch can't use (see lead below).
export const sampleRate = 44_100;
export const bytesPerSample = 4; // one stereo frame of two 16-bit samples
const payloadType = 96;
const timedPayloadType = 97;
const maxPacket = 4096; // rtpL16pay's MTU is 1400 bytes
const prebuffer = sampleRate / 4; // what a packet may arrive late by and still play
const capacity = sampleRate * 2; // the furthest ahead of playout a packet may be
const maxTick = sampleRate * 2; // an event-loop stall skips time rather than buffering it
// UxPlay times each packet from the sender's latest sync packet with a sample period rounded to
// whole nanoseconds, so consecutive packets meet within a couple of samples of each other; a lost
// packet leaves a whole frame (352 samples). Within this, a packet continues the previous one.
const seam = sampleRate / 1000;
// Once a sender has sent nothing for longer than a packet may be late, silence goes out this far
// ahead of its time, the relaxed floor (scheduled-audio.ts), so speakers keep playing. Its sound
// arrives about 1.75 s ahead (UxPlay's lib/raop_rtp.c), so silence doesn't take its place.
const quietAfter = (prebuffer * 1000) / sampleRate,
  quietAhead = sampleRate;
// How far ahead of now a sender's time may be for Couch to play at it. A Mac's ALAC arrives
// 1.6-1.75 s ahead (77175 samples between a sync packet's RTP times); older RAOP senders state
// 2 s (88200). 3 s keeps a second of margin above that and bounds what Core holds ahead of now.
// Below a second, the silence a quiet sender gets would cover its sound; a sender that never answers
// UxPlay's clock requests has its sound due as it arrives, about 0 ahead. Outside this, a stream
// is timed by its arrival, and so a sender's time never runs Core's stream faster than real time.
const lead = { min: quietAhead, max: sampleRate * 3 };

export type RtpPacket = {
  sequence: number;
  timestamp: number;
  ssrc: number;
  timed: boolean;
  payload: Buffer;
};

export function parseRtp(packet: Buffer): RtpPacket | null {
  const type = packet[1]! & 0x7f;
  if (
    packet.length < 12 ||
    packet[0]! >> 6 !== 2 ||
    (type !== payloadType && type !== timedPayloadType)
  )
    return null;
  let start = 12 + (packet[0]! & 0x0f) * 4,
    end = packet.length;
  if (packet[0]! & 0x10) {
    if (start + 4 > end) return null;
    start += 4 + packet.readUInt16BE(start + 2) * 4;
  }
  if (packet[0]! & 0x20) end -= packet[end - 1]!;
  if (start >= end || (end - start) % bytesPerSample) return null;
  return {
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    timed: type === timedPayloadType,
    payload: packet.subarray(start, end),
  };
}

// The pipe's RFC 4571 framing, in any chunking: each 16-bit length, then that many bytes of RTP.
// It holds at most one partial frame. null: the framing is broken.
export function createFramer() {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk: Buffer): { packets: RtpPacket[]; invalid: number } | null => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const packets: RtpPacket[] = [];
    let invalid = 0;
    while (pending.length >= 2) {
      const length = pending.readUInt16BE(0);
      if (!length || length > maxPacket) {
        pending = Buffer.alloc(0);
        return null;
      }
      if (pending.length < 2 + length) break;
      const packet = parseRtp(pending.subarray(2, 2 + length));
      pending = pending.subarray(2 + length);
      if (packet) packets.push(packet);
      else invalid++;
    }
    // Keep only the partial frame, not the chunk it arrived in.
    if (pending.length) pending = Buffer.from(pending);
    return { packets, invalid };
  };
}

// tick() hands on the PCM due since the last call with the time of its first sample, in ms on now()'s
// clock. A sender-timed stream's time is when the sender means it to be heard: it goes out as soon as
// it arrives, contiguous, its time following the sender's clock. Any other stream's is when it goes
// out, a quarter second after it arrived, on Core's clock.
export function createAudioIngress(options: { now?: () => number; wall?: () => number } = {}) {
  const now = options.now ?? (() => performance.now());
  const wall = options.wall ?? (() => Date.now());
  const frame = createFramer();
  // Packets by their unwrapped timestamp, in order; `next` is the first sample not yet played.
  // `latest` is the newest RTP sequence number placed: a packet after it is in order.
  let packets: { at: number; payload: Buffer }[] = [];
  let ssrc: number | undefined,
    stamped = false,
    timed = false,
    last = 0,
    latest: number | undefined,
    unwrapped = 0,
    next: number | undefined;
  let startedAt: number | undefined,
    emitted = 0;
  // A sender-timed stream: its wall clock less now()'s, read once so its times don't jitter; how far
  // the sender's time runs ahead of the samples placed one after another (its clock's drift); and
  // where the latest packet ended, in the sender's time and as placed.
  let wallOffset = 0,
    drift = 0,
    senderEnd: number | undefined,
    placedEnd = 0,
    arrivedAt = 0;
  const stats = { packets: 0, invalid: 0, late: 0, resyncs: 0 };
  const resync = (at: number) => {
    packets = [];
    next = timed ? at : at - prebuffer;
    stats.resyncs++;
  };
  // A sender-timed timestamp is the sample time nearest now with those low 32 bits; usable if its
  // lead fits.
  const sender = (timestamp: number, offset: number) => {
    const current = Math.round(((now() + offset) * sampleRate) / 1000),
      time = current + ((timestamp - current) | 0);
    return { time, usable: time >= current + lead.min && time <= current + lead.max };
  };

  // False: the packet belongs to a stream timed otherwise (the sender's time against arrival), which
  // is another source; it isn't placed. A new pipeline decides its timing from its first packet;
  // a sender-timed stream whose time leaves the lead window is timed by arrival from then on.
  const place = (packet: RtpPacket) => {
    const samples = packet.payload.length / bytesPerSample;
    // A new pipeline (UxPlay restarts it for another audio format) starts its own clock.
    const pipeline = packet.ssrc !== ssrc || packet.timed !== stamped,
      offset = pipeline ? wall() - now() : wallOffset,
      time = packet.timed ? sender(packet.timestamp, offset) : undefined,
      usable = !!time?.usable && (pipeline || timed);
    if (ssrc !== undefined && usable !== timed) return false;
    if (pipeline) {
      if (ssrc !== undefined) {
        packets = [];
        next = undefined;
        stats.resyncs++;
      }
      ssrc = packet.ssrc;
      stamped = packet.timed;
      timed = usable;
      latest = undefined;
      wallOffset = offset;
      drift = 0;
      senderEnd = undefined;
      unwrapped = packet.timestamp;
    } else unwrapped += (packet.timestamp - last) | 0; // RTP timestamps wrap at 32 bits
    if (timed) unwrapped = time!.time;
    last = packet.timestamp;
    const step = latest === undefined ? 1 : (packet.sequence - latest) & 0xffff,
      inOrder = step > 0 && step < 0x8000;
    if (inOrder) latest = packet.sequence;
    if (timed) {
      arrivedAt = now();
      if (senderEnd !== undefined && Math.abs(unwrapped - senderEnd) <= seam)
        drift = unwrapped - placedEnd;
      senderEnd = unwrapped + samples;
      placedEnd = unwrapped - drift + samples;
    }
    const at = unwrapped - drift,
      end = at + samples;
    next ??= timed ? at : at - prebuffer;
    // A pause or seek moves the sender's clock past what may be buffered; a sender whose clock runs
    // slower than Core's, or steps back, arrives late in order: start again from it. A sender-timed
    // stream that steps back within the lead window drops only what overlaps what already went out,
    // so speakers play on without a gap at the sender's time; further back, it's timed by arrival.
    if (end > next + capacity || (!timed && end <= next && inOrder)) resync(at);
    if (end <= next) {
      stats.late++;
      return true;
    } // A straggler, after what already played
    let index = packets.length;
    while (index && packets[index - 1]!.at > at) index--;
    if (packets[index - 1]?.at === at) return true; // A repeat
    packets.splice(index, 0, { at, payload: Buffer.from(packet.payload) });
    stats.packets++;
    return true;
  };
  const pull = (samples: number) => {
    const output = Buffer.alloc(samples * bytesPerSample);
    if (next === undefined) return output;
    const until = next + samples;
    for (const packet of packets) {
      if (packet.at >= until) break;
      const from = Math.max(packet.at, next),
        to = Math.min(packet.at + packet.payload.length / bytesPerSample, until);
      if (to > from)
        packet.payload.copy(
          output,
          (from - next) * bytesPerSample,
          (from - packet.at) * bytesPerSample,
          (to - packet.at) * bytesPerSample,
        );
    }
    packets = packets.filter(
      (packet) => packet.at + packet.payload.length / bytesPerSample > until,
    );
    next = until;
    return output;
  };
  const received = () =>
    packets.at(-1) ? packets.at(-1)!.at + packets.at(-1)!.payload.length / bytesPerSample : next!;
  const none = { pcm: Buffer.alloc(0), at: 0 };
  // Everything that arrived, or once the sender is quiet, silence up to quietAhead of its time now.
  const tickTimed = (time: number) => {
    if (next === undefined) return none;
    const quiet =
      time - arrivedAt > quietAfter
        ? Math.round(((time + wallOffset) * sampleRate) / 1000) - drift + quietAhead
        : -Infinity;
    if (quiet - next > maxTick) next = quiet - maxTick;
    const due = Math.max(received(), quiet) - next;
    if (due <= 0) return none;
    const at = ((next + drift) * 1000) / sampleRate - wallOffset;
    return { pcm: pull(due), at };
  };

  return {
    stats,
    /** Bytes from the pipe, in any chunking. False when the framing is broken. Packets timed unlike
     * the stream are left out. */
    push(chunk: Buffer) {
      const framed = frame(chunk);
      if (!framed) return false;
      stats.invalid += framed.invalid;
      for (const packet of framed.packets) place(packet);
      return true;
    },
    /** A packet already taken from the pipe's framing. False: it starts a stream timed otherwise. */
    place,
    /** Whether the stream plays at the sender's time; false when timed by its arrival. */
    timed: () => timed,
    /** The PCM due since the last call, silence where nothing arrived in time, and its first sample's time. */
    tick() {
      const time = now();
      if (timed) return tickTimed(time);
      startedAt ??= time;
      let due = Math.floor(((time - startedAt) * sampleRate) / 1000) - emitted;
      if (due > maxTick) {
        emitted += due - maxTick;
        due = maxTick;
      }
      if (due <= 0) return none;
      const at = startedAt + (emitted * 1000) / sampleRate;
      emitted += due;
      return { pcm: pull(due), at };
    },
    /** Samples received ahead of playout. */
    buffered: () => (next === undefined ? 0 : Math.max(0, received() - next)),
  };
}
