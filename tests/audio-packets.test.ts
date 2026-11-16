import { expect, test } from "bun:test";
import { tsOpusPackets } from "../src/server/audio-packets";

// One 188-byte TS packet; FFmpeg fills a short payload with adaptation-field stuffing.
const tsPacket = (pid: number, start: boolean, payload: Buffer) => {
  const stuffing = 184 - payload.length;
  const adaptation = stuffing
    ? Buffer.concat([Buffer.from([stuffing - 1]), Buffer.alloc(stuffing - 1, 0xff)])
    : Buffer.alloc(0);
  if (stuffing > 1) adaptation[1] = 0;
  const header = Buffer.from([
    0x47,
    (start ? 0x40 : 0) | (pid >> 8),
    pid & 0xff,
    stuffing ? 0x30 : 0x10,
  ]);
  return Buffer.concat([header, adaptation, payload]);
};
const pes = (units: Buffer) =>
  Buffer.concat([Buffer.from([0, 0, 1, 0xbd, 0, 0, 0x81, 0x80, 5, 0x21, 0, 1, 0, 1]), units]);
// The Opus mapping's control header: prefix 0x3ff, flags, size as 255s plus a remainder.
const unit = (data: Buffer, trim?: number) =>
  Buffer.concat([
    Buffer.from([0x7f, trim === undefined ? 0xe0 : 0xf0]),
    Buffer.from([...Array<number>(Math.floor(data.length / 255)).fill(255), data.length % 255]),
    trim === undefined ? Buffer.alloc(0) : Buffer.from([trim >> 8, trim & 0xff]),
    data,
  ]);

test("MPEG-TS Opus packets come out whole, with the first packet's pre-skip", () => {
  const first = Buffer.alloc(300, 1),
    second = Buffer.alloc(90, 2);
  const firstPes = pes(unit(first, 120));
  const stream = Buffer.concat([
    tsPacket(0, true, Buffer.alloc(184, 0xff)),
    tsPacket(0x100, true, firstPes.subarray(0, 184)),
    tsPacket(0x100, false, firstPes.subarray(184)),
    tsPacket(0x100, true, pes(unit(second))),
  ]);
  const packets: [Buffer, number][] = [];
  const parse = tsOpusPackets(0x100, (packet, trim) => packets.push([packet, trim]));
  // Pipes split data anywhere.
  for (let at = 0; at < stream.length; at += 77) parse(stream.subarray(at, at + 77));
  expect(packets).toEqual([
    [first, 120],
    [second, 0],
  ]);
});

test("a stream that loses MPEG-TS sync is refused", () => {
  const parse = tsOpusPackets(0x100, () => {});
  expect(() => parse(Buffer.alloc(188))).toThrow("broken MPEG-TS");
});
