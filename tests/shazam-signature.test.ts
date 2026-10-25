import { expect, test } from "bun:test";
import { crc32 } from "node:zlib";
import { generateShazamSignature } from "../src/server/shazam-signature";

type Peak = [band: number, pass: number, magnitude: number, bin: number];

function syntheticPcm() {
  const pcm = Buffer.alloc(4 * 16000 * 2);
  for (let index = 0; index < pcm.length / 2; index++) {
    const t = index / 16000, phase = 2 * Math.PI;
    const envelope = .3 + .7 * Math.sin(phase * 1.3 * t) ** 2;
    const value = envelope * (5000 * Math.sin(phase * (320 * t + 8 * t * t))
      + 6000 * Math.sin(phase * (900 * t + 20 * t * t))
      + 4000 * Math.sin(phase * (2100 * t + 60 * t * t))
      + 3000 * Math.sin(phase * (4100 * t - 50 * t * t)));
    pcm.writeInt16LE(Math.round(value), index * 2);
  }
  return pcm;
}

function decode(uri: string) {
  expect(uri.startsWith("data:audio/vnd.shazam.sig;base64,")).toBe(true);
  const binary = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  const peaks: Peak[] = [];
  for (let offset = 56; offset < binary.length;) {
    const band = binary.readUInt32LE(offset) - 0x60030040;
    const length = binary.readUInt32LE(offset + 4), end = offset + 8 + length;
    offset += 8;
    let pass = 0;
    while (offset < end) {
      const delta = binary[offset++]!;
      if (delta === 255) { pass = binary.readUInt32LE(offset); offset += 4; continue; }
      pass += delta;
      peaks.push([band, pass, binary.readUInt16LE(offset), binary.readUInt16LE(offset + 2)]);
      offset += 4;
    }
    offset = end + (4 - length % 4) % 4;
  }
  return { binary, peaks };
}

test("synthetic chirps match independently captured Rust reference peaks in all four bands", async () => {
  // shazamio-core 2.0.0, not this implementation's output. Its WAV API also resamples,
  // so compare strong peaks with narrow quantization tolerances; provenance is in vendor/.
  const reference: Peak[] = [
    [0, 79, 32223, 2697], [0, 127, 32249, 2747], [0, 270, 32108, 2898], [0, 319, 32248, 2948], [0, 368, 32229, 3000],
    [1, 30, 32744, 7433], [1, 78, 32758, 7559], [1, 126, 32768, 7685], [1, 175, 32778, 7813], [1, 223, 32785, 7939],
    [1, 271, 32789, 8064], [1, 319, 32788, 8191], [1, 368, 32789, 8320], [1, 416, 32785, 8445],
    [2, 33, 31489, 17407], [2, 81, 31469, 17785], [2, 130, 31439, 18170], [2, 172, 31418, 18502], [2, 221, 31456, 18887],
    [2, 270, 31478, 19272], [2, 318, 31502, 19649], [2, 367, 31516, 20034], [2, 416, 31515, 20419],
    [3, 33, 30627, 33417], [3, 82, 30596, 33096], [3, 131, 30550, 32776], [3, 172, 30586, 32505], [3, 221, 30623, 32184],
    [3, 270, 30646, 31863], [3, 318, 30672, 31549], [3, 367, 30685, 31228], [3, 415, 30692, 30913],
  ];
  const result = await generateShazamSignature(syntheticPcm());
  expect(result.samplems).toBe(4000);
  const peaks = decode(result.uri).peaks.filter(peak => peak[2] > 20000);
  expect(peaks).toHaveLength(reference.length);
  for (let index = 0; index < reference.length; index++) {
    const actual = peaks[index]!, expected = reference[index]!;
    expect(actual[0]).toBe(expected[0]);
    expect(Math.abs(actual[1] - expected[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(actual[2] - expected[2])).toBeLessThanOrEqual(2);
    expect(Math.abs(actual[3] - expected[3])).toBeLessThanOrEqual(2);
  }
});

test("the signature carries sample rate, duration, lengths and CRC32 in the Shazam wire format", async () => {
  const result = await generateShazamSignature(syntheticPcm());
  const { binary, peaks } = decode(result.uri);
  expect(binary.readUInt32LE(0)).toBe(0xcafe2580);
  expect(binary.readUInt32LE(12)).toBe(0x94119c00);
  expect(binary.readUInt32LE(28)).toBe(3 << 27);
  expect(binary.readUInt32LE(40)).toBe(64000 + 3840);
  expect(binary.readUInt32LE(44)).toBe((15 << 19) + 0x40000);
  expect(binary.readUInt32LE(8)).toBe(binary.length - 48);
  expect(binary.readUInt32LE(52)).toBe(binary.length - 48);
  expect(binary.readUInt32LE(4)).toBe(crc32(binary.subarray(8)));
  expect(result.peakCount).toBe(peaks.length);
});

test("twelve seconds of silence produces no peaks so the caller can skip recognition", async () => {
  const result = await generateShazamSignature(Buffer.alloc(12 * 16000 * 2));
  expect(result.samplems).toBe(12000);
  expect(result.peakCount).toBe(0);
  expect(decode(result.uri).binary).toHaveLength(56);
});

test("a long silent lead-in preserves peaks beyond the one-byte time-delta range", async () => {
  const pcm = syntheticPcm();
  const original = decode((await generateShazamSignature(pcm)).uri).peaks;
  const delayed = decode((await generateShazamSignature(Buffer.concat([Buffer.alloc(3 * 16000 * 2), pcm]))).uri).peaks;
  expect(delayed).toEqual(original.map(([band, pass, magnitude, bin]) => [band, pass + 375, magnitude, bin]));
});

test("empty, incomplete and oversized PCM is rejected before processing", async () => {
  for (const sample of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(12 * 16000 * 2 + 2)]) {
    await expect(generateShazamSignature(sample)).rejects.toBeInstanceOf(RangeError);
  }
});

test("fingerprinting yields for other Core work and honors cancellation", async () => {
  const controller = new AbortController(), reason = new Error("Station changed");
  let completed = false;
  const result = generateShazamSignature(Buffer.alloc(12 * 16000 * 2), controller.signal)
    .finally(() => { completed = true; }).catch(error => error);
  expect(completed).toBe(false);
  controller.abort(reason);
  expect(await result).toBe(reason);
  await expect(generateShazamSignature(Buffer.alloc(2), controller.signal)).rejects.toBe(reason);
});
