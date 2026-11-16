import { expect, test } from "bun:test";
import {
  bytesPerSample,
  createAudioIngress,
  parseRtp,
  sampleRate,
} from "../src/server/airplay-audio";

// What rtpL16pay ! rtpstreampay writes: a 16-bit length, then RTP with payload type 96.
const rtp = (
  sequence: number,
  timestamp: number,
  samples: number,
  value: number,
  { ssrc = 0x1234, payloadType = 96, padding = 0, csrc = 0, extension = 0 } = {},
) => {
  const header = Buffer.alloc(12 + csrc * 4 + (extension ? 4 + extension * 4 : 0));
  header[0] = 0x80 | (padding ? 0x20 : 0) | (extension ? 0x10 : 0) | csrc;
  header[1] = payloadType;
  header.writeUInt16BE(sequence & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc, 8);
  if (extension) header.writeUInt16BE(extension, 12 + csrc * 4 + 2);
  const payload = Buffer.alloc(samples * bytesPerSample);
  for (let offset = 0; offset < payload.length; offset += 2) payload.writeInt16BE(value, offset);
  const pad = padding
    ? Buffer.concat([Buffer.alloc(padding - 1), Buffer.from([padding])])
    : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
};
const framed = (packet: Buffer) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(packet.length);
  return Buffer.concat([length, packet]);
};
const values = (pcm: Buffer) =>
  Array.from({ length: pcm.length / bytesPerSample }, (_, index) =>
    pcm.readInt16BE(index * bytesPerSample),
  );
const clock = () => {
  let time = 0;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
};
// 10 ms of samples at 44.1 kHz, so packet boundaries fall on whole samples.
const packet = 441;

test("parses RTP L16 with CSRCs, an extension and padding, and refuses anything else", () => {
  expect(
    values(parseRtp(rtp(7, 100, 2, 5, { csrc: 2, extension: 1, padding: 4 }))!.payload),
  ).toEqual([5, 5]);
  expect(parseRtp(rtp(7, 100, 2, 5))).toMatchObject({
    sequence: 7,
    timestamp: 100,
    ssrc: 0x1234,
    timed: false,
  });
  expect(parseRtp(rtp(7, 100, 2, 5, { payloadType: 97 }))).toMatchObject({ timed: true });
  expect(parseRtp(rtp(7, 100, 2, 5, { payloadType: 98 }))).toBeNull();
  expect(parseRtp(Buffer.concat([rtp(7, 100, 2, 5), Buffer.from([1, 2])]))).toBeNull(); // Not whole stereo samples
  const version = rtp(7, 100, 2, 5);
  version[0] = 0x40;
  expect(parseRtp(version)).toBeNull();
  expect(parseRtp(Buffer.alloc(8))).toBeNull();
});

test("reads frames in any chunking and rejects broken framing without buffering it", () => {
  const time = clock(),
    ingress = createAudioIngress({ now: time.now });
  const bytes = Buffer.concat([framed(rtp(0, 0, packet, 1)), framed(rtp(1, packet, packet, 2))]);
  ingress.tick();
  for (let offset = 0; offset < bytes.length; offset += 7)
    expect(ingress.push(bytes.subarray(offset, offset + 7))).toBe(true);
  expect(ingress.stats.packets).toBe(2);
  expect(ingress.push(Buffer.from([0xff, 0xff, 0]))).toBe(false); // Longer than any RTP packet UxPlay sends
  expect(ingress.push(Buffer.from([0, 0]))).toBe(false);
  expect(ingress.push(framed(Buffer.from("not rtp at all")))).toBe(true);
  expect(ingress.stats.invalid).toBe(1);
});

test("plays the sender's samples in timestamp order on Core's clock, a quarter second behind", () => {
  const time = clock(),
    ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  // Arrive out of order: the second packet first.
  ingress.push(framed(rtp(1, 1000 + packet, packet, 2)));
  ingress.push(framed(rtp(0, 1000, packet, 1)));
  // The first to arrive set the playout clock a quarter second behind it; the earlier one still plays first.
  time.advance(250);
  const first = values(ingress.tick().pcm);
  expect(first.length).toBe(sampleRate / 4);
  expect(first.slice(0, -packet).every((value) => value === 0)).toBe(true);
  expect(first.slice(-packet).every((value) => value === 1)).toBe(true);
  time.advance(10);
  expect(values(ingress.tick().pcm).every((value) => value === 2)).toBe(true);
  expect(ingress.stats.late).toBe(0);
});

test("emits exactly the elapsed samples, filling loss and pauses with silence", () => {
  const time = clock(),
    ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  let emitted = 0,
    nonzero = 0;
  for (let index = 0; index < 100; index++) {
    // Every tenth packet is lost.
    if (index % 10 !== 3) ingress.push(framed(rtp(index, index * packet, packet, 1000)));
    time.advance(10);
    const { pcm } = ingress.tick();
    emitted += pcm.length / bytesPerSample;
    nonzero += values(pcm).filter((value) => value !== 0).length;
  }
  // 75 packets' 10 ms played (the last 25 are still buffered), less the 8 lost among them.
  expect(nonzero).toBe((75 - 8) * packet);
  // A paused sender sends nothing: what was buffered plays, then Core's stream keeps its clock with silence.
  time.advance(1500);
  const paused = values(ingress.tick().pcm);
  emitted += paused.length;
  expect(emitted).toBe(Math.floor((2500 * sampleRate) / 1000));
  expect(paused.filter((value) => value !== 0).length).toBe((25 - 2) * packet);
  expect(paused.slice(25 * packet).every((value) => value === 0)).toBe(true);
});

test("follows 32-bit timestamp wrap and a new stream from another pipeline", () => {
  const time = clock(),
    ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  const start = 2 ** 32 - packet;
  ingress.push(framed(rtp(0, start, packet, 1)));
  ingress.push(framed(rtp(1, start + packet, packet, 2))); // Wraps to 0
  expect(ingress.stats.resyncs).toBe(0);
  expect(ingress.buffered()).toBe(sampleRate / 4 + 2 * packet);
  ingress.push(framed(rtp(0, 77, packet, 5, { ssrc: 0x9999 })));
  expect(ingress.stats.resyncs).toBe(1);
  time.advance(260);
  expect(values(ingress.tick().pcm).includes(5)).toBe(true);
});

test("never buffers more than two seconds ahead, and skips a stalled event loop instead of catching up without limit", () => {
  const time = clock(),
    ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  for (let index = 0; index < 1000; index++)
    ingress.push(framed(rtp(index, index * packet, packet, 1)));
  expect(ingress.buffered()).toBeLessThanOrEqual(sampleRate * 2);
  time.advance(60_000);
  expect(ingress.tick().pcm.length).toBe(sampleRate * 2 * bytesPerSample);
});

// Couch's UxPlay patch: payload type 97, each timestamp the sender's play time on the wall clock.
const wallClock = (wallAtZero: number) => {
  const time = clock();
  return { ...time, wall: () => wallAtZero + time.now() };
};
const senderTime = (wallMs: number) => Math.round((wallMs * sampleRate) / 1000) % 2 ** 32;
const end = ({ pcm, at }: { pcm: Buffer; at: number }) =>
  at + (pcm.length / bytesPerSample / sampleRate) * 1000;

test("hands a sender-timed stream on as it arrives, stamped when the sender means it heard", () => {
  const time = wallClock(1_800_000_000_000),
    ingress = createAudioIngress(time);
  const first = senderTime(time.wall() + 1750); // About 1.75 s ahead, as a sender's ALAC is
  // UxPlay rounds the sample period, so packets meet a sample early or late; the fourth is lost.
  const starts = [0, packet - 1, 2 * packet, 4 * packet, 5 * packet + 1];
  starts.forEach((start, index) =>
    ingress.push(framed(rtp(index, first + start, packet, 1000, { payloadType: 97 }))),
  );
  expect(ingress.timed()).toBe(true);
  const heard = ingress.tick();
  expect(heard.at).toBeCloseTo(1750, 1);
  const samples = values(heard.pcm);
  // Contiguous across the seams; the lost packet is silence of its own length.
  expect(samples.length).toBe(6 * packet);
  expect(samples.filter((value) => value === 0).length).toBe(packet);
  expect(samples.slice(3 * packet, 4 * packet).every((value) => value === 0)).toBe(true);
  // A quiet sender: silence goes out a second ahead, continuing the sender's timeline.
  time.advance(1000);
  const quiet = ingress.tick();
  expect(values(quiet.pcm).every((value) => value === 0)).toBe(true);
  expect(quiet.at).toBeCloseTo(end(heard), 1);
  expect(end(quiet)).toBeCloseTo(2000, 0);
  // Its sound after a pause arrives ahead of that silence and continues it.
  ingress.push(framed(rtp(9, senderTime(time.wall() + 1750), packet, 7, { payloadType: 97 })));
  const resumed = ingress.tick();
  expect(resumed.at).toBeCloseTo(end(quiet), 1);
  expect(
    values(resumed.pcm)
      .slice(-packet)
      .every((value) => value === 7),
  ).toBe(true);
  expect(end(resumed)).toBeCloseTo(2750 + (packet * 1000) / sampleRate, 0);
});

test("places a sender-timed timestamp at the time nearest now, across the 32-bit wrap", () => {
  // A wall clock where the sender's time 1.75 s ahead is 50 samples before a wrap.
  const time = wallClock(((2 ** 32 * 1000) / sampleRate) * 40_000 - 1750),
    ingress = createAudioIngress(time);
  const first = (senderTime(time.wall() + 1750) - 50 + 2 ** 32) % 2 ** 32;
  ingress.push(framed(rtp(0, first, packet, 3, { payloadType: 97 })));
  ingress.push(framed(rtp(1, (first + packet) % 2 ** 32, packet, 4, { payloadType: 97 })));
  const { pcm, at } = ingress.tick();
  expect(at).toBeCloseTo(1750 - (50 * 1000) / sampleRate, 1);
  expect(values(pcm)).toEqual([...Array(packet).fill(3), ...Array(packet).fill(4)]);
});

test("never covers a sender-timed stream that keeps arriving with silence, at the least lead it may have", () => {
  const time = wallClock(1_800_000_000_000),
    ingress = createAudioIngress(time);
  const first = senderTime(time.wall() + 1010); // Just above the second the quiet silence goes out
  let nonzero = 0;
  for (let index = 0; index < 100; index++) {
    ingress.push(framed(rtp(index, first + index * packet, packet, 1, { payloadType: 97 })));
    time.advance(10);
    nonzero += values(ingress.tick().pcm).filter((value) => value !== 0).length;
  }
  expect(ingress.timed()).toBe(true);
  expect(nonzero).toBe(100 * packet);
  expect(ingress.stats.late).toBe(0);
});

// What airplay.ts does with each packet: one the stream refuses, timed otherwise, starts another source.
const sources = (time: ReturnType<typeof wallClock>) => {
  const list = [createAudioIngress(time)];
  let sequence = 0;
  return {
    list,
    current: () => list.at(-1)!,
    // A packet the sender means heard `ms` from now on the wall clock.
    send(ms: number, value: number, samples = packet) {
      const parsed = parseRtp(
        rtp(sequence++, senderTime(time.wall() + ms), samples, value, { payloadType: 97 }),
      )!;
      if (list.at(-1)!.place(parsed)) return;
      list.push(createAudioIngress(time));
      list.at(-1)!.place(parsed);
    },
  };
};

test("plays a sender whose time isn't ahead by what a sender's is by its arrival, a quarter second behind", () => {
  const time = wallClock(1_800_000_000_000),
    stream = sources(time);
  time.advance(5_000); // Core has been up five seconds
  // Due as it arrives (a sender that never answers UxPlay's clock requests), an hour in the past
  // (further back than Core's uptime) and an hour ahead: none is a time Couch can play at.
  for (const ms of [0, -3_600_000, 3_600_000]) {
    const ingress = createAudioIngress(time);
    expect(
      ingress.place(
        parseRtp(rtp(0, senderTime(time.wall() + ms), packet, 1, { payloadType: 97 }))!,
      ),
    ).toBe(true);
    expect(ingress.timed()).toBe(false);
    ingress.tick();
    time.advance(250 + 10);
    const { pcm, at } = ingress.tick();
    expect(at).toBeGreaterThanOrEqual(0);
    expect(
      values(pcm)
        .slice(-packet)
        .every((value) => value === 1),
    ).toBe(true);
  }
  stream.send(0, 1);
  expect(stream.current().timed()).toBe(false);
});

test("a far-future sender time neither silences the sender, nor holds its sound, nor runs faster than real time", () => {
  const time = wallClock(1_800_000_000_000),
    stream = sources(time);
  for (let index = 0; index < 10; index++) {
    stream.send(1750, 1);
    time.advance(10);
    stream.current().tick();
  }
  expect(stream.current().timed()).toBe(true);
  // One packet an hour ahead: the stream is timed by arrival from then on, and the sender's next
  // packets play rather than wait an hour.
  stream.send(3_600_000, 9);
  expect(stream.list.length).toBe(2);
  let last = Buffer.alloc(0);
  for (let index = 0; index < 100; index++) {
    stream.send(1750, 2);
    time.advance(10);
    last = stream.current().tick().pcm;
  }
  expect(stream.list.length).toBe(2);
  expect(values(last).length).toBeGreaterThan(0);
  expect(values(last).every((value) => value === 2)).toBe(true);

  // A sender that stays an hour ahead plays in real time, holding no more than a packet may wait.
  const steady = sources(time);
  let emitted = 0;
  steady.current().tick();
  for (let index = 0; index < 300; index++) {
    steady.send(3_600_000, 3);
    time.advance(10);
    emitted += steady.current().tick().pcm.length / bytesPerSample;
    expect(steady.current().buffered()).toBeLessThanOrEqual(sampleRate / 4 + packet);
  }
  expect(steady.list.length).toBe(1);
  expect(emitted).toBe(300 * packet);

  // A sender racing ahead: each tick a small packet just under 2 s after the last.
  const racing = sources(time);
  let out = 0,
    ahead = 1750;
  const started = time.now();
  for (let index = 0; index < 100; index++) {
    racing.send(ahead, 4, 10);
    ahead += 1990 - 20;
    time.advance(20);
    for (const ingress of racing.list) out += ingress.tick().pcm.length / bytesPerSample;
  }
  // No more than what the time passed holds, and what the sender may be ahead by.
  expect(out).toBeLessThanOrEqual(((time.now() - started + 3000) * sampleRate) / 1000);
});

test("a sender clock that steps back plays on without a gap, at the sender's time", () => {
  const time = wallClock(1_800_000_000_000),
    stream = sources(time);
  let before = { pcm: Buffer.alloc(0), at: 0 };
  for (let index = 0; index < 20; index++) {
    stream.send(1750, 1);
    time.advance(10);
    before = stream.current().tick();
  }
  // Half a second back, still ahead by what a sender's is: the half second that overlaps the sound
  // already out is dropped, and the rest continues it.
  let until = end(before),
    played = 0;
  for (let index = 0; index < 100; index++) {
    stream.send(1250, 2);
    time.advance(10);
    const tick = stream.current().tick();
    if (!tick.pcm.length) continue;
    expect(tick.at).toBeCloseTo(until, 1);
    expect(values(tick.pcm).every((value) => value === 2)).toBe(true);
    until = end(tick);
    played += tick.pcm.length / bytesPerSample;
  }
  expect(stream.list.length).toBe(1);
  expect(stream.current().stats.late).toBe(50);
  expect(played).toBe(50 * packet);
  // Thirty seconds back, no longer ahead: timed by arrival, a quarter second after it arrives.
  stream.send(1250 - 30_000, 3);
  expect(stream.list.length).toBe(2);
  let heard = 0;
  stream.current().tick();
  for (let index = 0; index < 50; index++) {
    stream.send(1250 - 30_000, 3);
    time.advance(10);
    heard += values(stream.current().tick().pcm).filter((value) => value === 3).length;
  }
  expect(heard).toBe((50 - 25) * packet); // 500 ms out, less the quarter second before it
});
