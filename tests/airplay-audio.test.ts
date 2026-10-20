import { expect, test } from "bun:test";
import { bytesPerSample, createAudioIngress, parseRtp, sampleRate } from "../src/server/airplay-audio";

// What rtpL16pay ! rtpstreampay writes: a 16-bit length, then RTP with payload type 96.
const rtp = (sequence: number, timestamp: number, samples: number, value: number, { ssrc = 0x1234, payloadType = 96, padding = 0, csrc = 0, extension = 0 } = {}) => {
  const header = Buffer.alloc(12 + csrc * 4 + (extension ? 4 + extension * 4 : 0));
  header[0] = 0x80 | (padding ? 0x20 : 0) | (extension ? 0x10 : 0) | csrc;
  header[1] = payloadType;
  header.writeUInt16BE(sequence & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc, 8);
  if (extension) header.writeUInt16BE(extension, 12 + csrc * 4 + 2);
  const payload = Buffer.alloc(samples * bytesPerSample);
  for (let offset = 0; offset < payload.length; offset += 2) payload.writeInt16BE(value, offset);
  const pad = padding ? Buffer.concat([Buffer.alloc(padding - 1), Buffer.from([padding])]) : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
};
const framed = (packet: Buffer) => { const length = Buffer.alloc(2); length.writeUInt16BE(packet.length); return Buffer.concat([length, packet]); };
const values = (pcm: Buffer) => Array.from({ length: pcm.length / bytesPerSample }, (_, index) => pcm.readInt16BE(index * bytesPerSample));
const clock = () => { let time = 0; return { now: () => time, advance: (ms: number) => { time += ms; } }; };
// 10 ms of samples at 44.1 kHz, so packet boundaries fall on whole samples.
const packet = 441;

test("parses RTP L16 with CSRCs, an extension and padding, and refuses anything else", () => {
  expect(values(parseRtp(rtp(7, 100, 2, 5, { csrc: 2, extension: 1, padding: 4 }))!.payload)).toEqual([5, 5]);
  expect(parseRtp(rtp(7, 100, 2, 5))).toMatchObject({ sequence: 7, timestamp: 100, ssrc: 0x1234 });
  expect(parseRtp(rtp(7, 100, 2, 5, { payloadType: 97 }))).toBeNull();
  expect(parseRtp(Buffer.concat([rtp(7, 100, 2, 5), Buffer.from([1, 2])]))).toBeNull(); // Not whole stereo samples
  const version = rtp(7, 100, 2, 5); version[0] = 0x40;
  expect(parseRtp(version)).toBeNull();
  expect(parseRtp(Buffer.alloc(8))).toBeNull();
});

test("reads frames in any chunking and rejects broken framing without buffering it", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  const bytes = Buffer.concat([framed(rtp(0, 0, packet, 1)), framed(rtp(1, packet, packet, 2))]);
  ingress.tick();
  for (let offset = 0; offset < bytes.length; offset += 7) expect(ingress.push(bytes.subarray(offset, offset + 7))).toBe(true);
  expect(ingress.stats.packets).toBe(2);
  expect(ingress.push(Buffer.from([0xff, 0xff, 0]))).toBe(false); // Longer than any RTP packet UxPlay sends
  expect(ingress.push(Buffer.from([0, 0]))).toBe(false);
  expect(ingress.push(framed(Buffer.from("not rtp at all")))).toBe(true);
  expect(ingress.stats.invalid).toBe(1);
});

test("plays the sender's samples in timestamp order on Core's clock, a quarter second behind", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  // Arrive out of order: the second packet first.
  ingress.push(framed(rtp(1, 1000 + packet, packet, 2)));
  ingress.push(framed(rtp(0, 1000, packet, 1)));
  // The first to arrive set the playout clock a quarter second behind it; the earlier one still plays first.
  time.advance(250);
  const first = values(ingress.tick());
  expect(first.length).toBe(sampleRate / 4);
  expect(first.slice(0, -packet).every(value => value === 0)).toBe(true);
  expect(first.slice(-packet).every(value => value === 1)).toBe(true);
  time.advance(10);
  expect(values(ingress.tick()).every(value => value === 2)).toBe(true);
  expect(ingress.stats.late).toBe(0);
});

test("emits exactly the elapsed samples, filling loss and pauses with silence", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  let emitted = 0, nonzero = 0;
  for (let index = 0; index < 100; index++) {
    // Every tenth packet is lost.
    if (index % 10 !== 3) ingress.push(framed(rtp(index, index * packet, packet, 1000)));
    time.advance(10);
    const pcm = ingress.tick();
    emitted += pcm.length / bytesPerSample;
    nonzero += values(pcm).filter(value => value !== 0).length;
  }
  // 75 packets' 10 ms played (the last 25 are still buffered), less the 8 lost among them.
  expect(nonzero).toBe((75 - 8) * packet);
  // A paused sender sends nothing: what was buffered plays, then Core's stream keeps its clock with silence.
  time.advance(1500);
  const paused = values(ingress.tick());
  emitted += paused.length;
  expect(emitted).toBe(Math.floor(2500 * sampleRate / 1000));
  expect(paused.filter(value => value !== 0).length).toBe((25 - 2) * packet);
  expect(paused.slice(25 * packet).every(value => value === 0)).toBe(true);
});

test("drops repeats and stragglers, and starts again from a sender whose clock jumped or fell behind", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  ingress.push(framed(rtp(0, 0, packet, 1)));
  ingress.push(framed(rtp(0, 0, packet, 1)));
  expect(ingress.stats.packets).toBe(1);
  ingress.push(framed(rtp(1, packet, packet, 1)));
  time.advance(600);
  ingress.tick();
  // An old packet arrives after newer ones already played.
  ingress.push(framed(rtp(9, -packet * 30, packet, 9)));
  expect(ingress.stats.late).toBe(1);
  // In order but behind Core's clock (a slow sender): it plays a quarter second later instead of never.
  ingress.push(framed(rtp(2, packet * 2, packet, 3)));
  expect(ingress.stats.resyncs).toBe(1);
  time.advance(260);
  expect(values(ingress.tick()).includes(3)).toBe(true);
  // A resumed sender ten seconds ahead: what was buffered is dropped, not held without limit.
  ingress.push(framed(rtp(3, sampleRate * 10, packet, 4)));
  expect(ingress.stats.resyncs).toBe(2);
  expect(ingress.buffered()).toBeLessThanOrEqual(sampleRate / 4 + packet);
});

test("a repeat of the newest packet that already played is dropped, never played again", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  ingress.push(framed(rtp(0, 0, packet, 1)));
  ingress.push(framed(rtp(1, packet, packet, 2)));
  // Both play: a quarter second of lead-in, then the two packets.
  time.advance(300);
  expect(values(ingress.tick()).filter(value => value === 2).length).toBe(packet);
  // The newest packet arrives again, as a network may repeat it.
  ingress.push(framed(rtp(1, packet, packet, 2)));
  expect(ingress.stats.resyncs).toBe(0);
  expect(ingress.stats.late).toBe(1);
  time.advance(300);
  expect(values(ingress.tick()).includes(2)).toBe(false);
  // The next new packet that is behind Core's clock still starts again from it.
  ingress.push(framed(rtp(2, packet * 2, packet, 3)));
  expect(ingress.stats.resyncs).toBe(1);
  time.advance(260);
  expect(values(ingress.tick()).includes(3)).toBe(true);
});

test("follows 32-bit timestamp wrap and a new stream from another pipeline", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  const start = 2 ** 32 - packet;
  ingress.push(framed(rtp(0, start, packet, 1)));
  ingress.push(framed(rtp(1, start + packet, packet, 2))); // Wraps to 0
  expect(ingress.stats.resyncs).toBe(0);
  expect(ingress.buffered()).toBe(sampleRate / 4 + 2 * packet);
  ingress.push(framed(rtp(0, 77, packet, 5, { ssrc: 0x9999 })));
  expect(ingress.stats.resyncs).toBe(1);
  time.advance(260);
  expect(values(ingress.tick()).includes(5)).toBe(true);
});

test("never buffers more than two seconds ahead, and skips a stalled event loop instead of catching up without limit", () => {
  const time = clock(), ingress = createAudioIngress({ now: time.now });
  ingress.tick();
  for (let index = 0; index < 1000; index++) ingress.push(framed(rtp(index, index * packet, packet, 1)));
  expect(ingress.buffered()).toBeLessThanOrEqual(sampleRate * 2);
  time.advance(60_000);
  expect(ingress.tick().length).toBe(sampleRate * 2 * bytesPerSample);
});
