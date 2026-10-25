/*! @license
MIT License

Copyright (c) 2024 dotX12 (shazamio-core)
Copyright (c) 2021 dotX12 (ShazamIO)
Copyright Fedor Indutny, 2017. (fft.js)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Narrow TypeScript port of shazamio-core's MIT fingerprinting and signature encoding.
// Upstream d7608768ab274c1b149f0d9086b75db2e661b9bb; see vendor/shazam-signature/README.md.
import FFT from "fft.js";
import { setImmediate } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { hanningWindow } from "./shazam-hanning";

type Peak = { pass: number; magnitude: number; bin: number };
const f32 = Math.fround;
const frequencyNeighbors = [-10, -7, -4, -3, 1, 2, 5, 8];
const timeNeighbors = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const magnitude = (power: number) => f32(f32(Math.max(f32(Math.log(power)), 1 / 64) * f32(1477.3)) + 6144);

function encode(peaks: Peak[][], samples: number): string {
  const parts: Buffer[] = [];
  for (let band = 0; band < peaks.length; band++) {
    const entries = peaks[band]!;
    if (!entries.length) continue;
    const data = Buffer.alloc(entries.length * 10);
    let offset = 0, previousPass = 0;
    for (const peak of entries) {
      if (peak.pass - previousPass >= 255) {
        data[offset++] = 255;
        data.writeUInt32LE(peak.pass, offset);
        offset += 4;
        previousPass = peak.pass;
      }
      data[offset++] = peak.pass - previousPass;
      data.writeUInt16LE(peak.magnitude, offset);
      data.writeUInt16LE(peak.bin, offset + 2);
      offset += 4;
      previousPass = peak.pass;
    }
    const header = Buffer.alloc(8);
    header.writeUInt32LE(0x60030040 + band);
    header.writeUInt32LE(offset, 4);
    parts.push(header, data.subarray(0, offset), Buffer.alloc((4 - offset % 4) % 4));
  }
  const header = Buffer.alloc(56);
  header.writeUInt32LE(0xcafe2580);
  header.writeUInt32LE(0x94119c00, 12);
  header.writeUInt32LE(3 << 27, 28); // 16 kHz sample-rate ID.
  header.writeUInt32LE(samples + 3840, 40); // The format adds 240 ms.
  header.writeUInt32LE((15 << 19) + 0x40000, 44);
  header.writeUInt32LE(0x40000000, 48);
  const binary = Buffer.concat([header, ...parts]);
  binary.writeUInt32LE(binary.length - 48, 8);
  binary.writeUInt32LE(binary.length - 48, 52);
  binary.writeUInt32LE(crc32(binary.subarray(8)), 4);
  return `data:audio/vnd.shazam.sig;base64,${binary.toString("base64")}`;
}

/** PCM16LE, mono, 16 kHz only. FFmpeg owns decoding and resampling before this boundary. */
export async function generateShazamSignature(pcm: Buffer, signal?: AbortSignal): Promise<{ uri: string; samplems: number; peakCount: number }> {
  signal?.throwIfAborted();
  if (!pcm.length || pcm.length % 2 || pcm.length > 12 * 16000 * 2) throw new RangeError("Expected at most 12 seconds of mono 16 kHz PCM16LE audio.");
  const samples = pcm.length / 2;
  const ring = new Int16Array(2048), windowed = new Float32Array(2048);
  const fft = new FFT(2048), spectrum = new Float64Array(4096);
  const outputs = Array.from({ length: 256 }, () => new Float32Array(1025));
  const spreadOutputs = Array.from({ length: 256 }, () => new Float32Array(1025));
  const peaks: Peak[][] = [[], [], [], []];
  let ringIndex = 0, fftIndex = 0, spreadIndex = 0, passes = 0;

  for (let sample = 0; sample + 128 <= samples; sample += 128) {
    // Core also clocks playback and serves streams; leave it available while fingerprinting.
    if (sample && sample % (128 * 128) === 0) { await setImmediate(); signal?.throwIfAborted(); }
    for (let index = 0; index < 128; index++) ring[ringIndex + index] = pcm.readInt16LE((sample + index) * 2);
    ringIndex = (ringIndex + 128) & 2047;
    for (let index = 0; index < 2048; index++) windowed[index] = ring[(index + ringIndex) & 2047]! * hanningWindow[index]!;
    fft.realTransform(spectrum, windowed);
    const power = outputs[fftIndex]!;
    for (let index = 0; index <= 1024; index++) {
      const real = f32(spectrum[index * 2]!), imaginary = f32(spectrum[index * 2 + 1]!);
      power[index] = Math.max(f32(f32(f32(real * real) + f32(imaginary * imaginary)) / 131072), 1e-10);
    }
    fftIndex = (fftIndex + 1) & 255;

    // Spread each peak across frequency and time before finding local maxima.
    const spread = spreadOutputs[spreadIndex]!;
    spread.set(power);
    for (let index = 0; index <= 1022; index++) spread[index] = Math.max(spread[index]!, spread[index + 1]!, spread[index + 2]!);
    for (const previous of [1, 3, 6]) {
      const earlier = spreadOutputs[(spreadIndex - previous) & 255]!;
      for (let index = 0; index <= 1024; index++) earlier[index] = Math.max(earlier[index]!, spread[index]!);
    }
    spreadIndex = (spreadIndex + 1) & 255;
    if (++passes < 46) continue;

    const earlierPower = outputs[(fftIndex - 46) & 255]!;
    const earlierSpread = spreadOutputs[(spreadIndex - 49) & 255]!;
    for (let bin = 10; bin <= 1014; bin++) {
      const value = earlierPower[bin]!;
      if (value < 1 / 64 || value < earlierSpread[bin - 1]!) continue;
      let neighbor = 0;
      for (const offset of frequencyNeighbors) neighbor = Math.max(neighbor, earlierSpread[bin + offset]!);
      if (value <= neighbor) continue;
      for (const offset of timeNeighbors) neighbor = Math.max(neighbor, spreadOutputs[(spreadIndex + offset) & 255]![bin - 1]!);
      if (value <= neighbor) continue;

      const peak = magnitude(value), before = magnitude(earlierPower[bin - 1]!), after = magnitude(earlierPower[bin + 1]!);
      const variation = f32(f32(f32(peak * 2) - before) - after);
      const correction = f32(f32(f32(after - before) * 32) / variation);
      // Rust float-to-integer casts truncate and saturate; NaN converts to zero.
      const correctionInt = Math.max(-2147483648, Math.min(2147483647, Math.trunc(correction) || 0));
      const correctedBin = (bin * 64 + correctionInt) & 65535;
      const hz = Math.trunc(correctedBin * (16000 / 2 / 1024 / 64));
      const band = hz >= 250 && hz < 520 ? 0 : hz >= 520 && hz < 1450 ? 1 : hz >= 1450 && hz < 3500 ? 2 : hz >= 3500 && hz <= 5500 ? 3 : -1;
      if (band !== -1) peaks[band]!.push({ pass: passes - 46, magnitude: Math.min(65535, Math.max(0, Math.trunc(peak))), bin: correctedBin });
    }
  }
  signal?.throwIfAborted();
  return { uri: encode(peaks, samples), samplems: Math.trunc(f32(f32(samples / 16000) * 1000)), peakCount: peaks.reduce((sum, band) => sum + band.length, 0) };
}
