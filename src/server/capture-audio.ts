/** Source-clock timestamps are integer microseconds; PCM is interleaved, never invented stereo. */
export type CaptureAudioPacket = {
  generation: string;
  sequence: number;
  samplePosition: number;
  capturedAtUs: number;
  sampleRate: number;
  channels: 1 | 2;
  pcm: Float32Array;
};
export type CapturePolicy = { intent: "relaxed" | "live" };
export const captureLeadUs = (policy: CapturePolicy) => policy.intent === "live" ? 100_000 : 1_000_000;
const maxFrames = 4096;

export function validateCapturePacket(packet: CaptureAudioPacket) {
  if (!packet || typeof packet.generation !== "string" || !/^[\w-]{1,64}$/.test(packet.generation)
    || ![packet.sequence, packet.samplePosition, packet.capturedAtUs].every(n => Number.isSafeInteger(n) && n >= 0)
    || ![44_100, 48_000, 96_000].includes(packet.sampleRate) || ![1, 2].includes(packet.channels)
    || !(packet.pcm instanceof Float32Array) || !packet.pcm.length || packet.pcm.length % packet.channels
    || packet.pcm.length / packet.channels > maxFrames) throw new Error("Invalid timestamped audio packet.");
  for (const sample of packet.pcm) if (!Number.isFinite(sample) || Math.abs(sample) > 8) throw new Error("Invalid captured sample.");
}

/** Bounded continuous source-rate conversion. The first deadline never moves to hide late input. */
export function createCaptureClock(policy: CapturePolicy) {
  let generation: string | undefined, sequence = -1, nextSample = 0, rate = 0, channels = 0;
  let originUs = 0, measuredAt = 0, measuredSample = 0, ppm = 0;
  let inputAt = 0, outputAt = 0;
  let previous: number[] = [];
  const stats = { resets: 0, gaps: 0, late: 0, ppm: 0 };
  return {
    stats,
    push(packet: CaptureAudioPacket, nowUs: number) {
      validateCapturePacket(packet);
      if (policy.intent === "live" && packet.channels !== 2) throw new Error("Live audio needs a real stereo capture input.");
      const reset = generation !== packet.generation;
      if (reset) {
        if (packet.sequence !== 0 || packet.samplePosition !== 0) throw new Error("A capture generation must start at sample zero.");
        generation = packet.generation; sequence = -1; nextSample = inputAt = outputAt = 0;
        rate = packet.sampleRate; channels = packet.channels; previous = [];
        originUs = measuredAt = packet.capturedAtUs; measuredSample = ppm = 0; stats.resets++;
      }
      if (packet.sampleRate !== rate || packet.channels !== channels) throw new Error("Capture format changed without a new generation.");
      if (packet.sequence <= sequence || packet.samplePosition < nextSample) throw new Error("Capture sample positions moved backward.");
      const gap = packet.samplePosition - nextSample;
      if (gap > rate * .04) throw new Error("The capture lost more than 40 ms. Start sharing again.");
      const expected = originUs + packet.samplePosition / rate * 1e6;
      if (Math.abs(packet.capturedAtUs - expected) > 100_000 + packet.samplePosition / rate * 1000) throw new Error("The capture clock jumped. Start sharing again.");
      // Estimate oscillator rate over >= one second; clamp conversion to +/-1000 ppm.
      const span = packet.capturedAtUs - measuredAt;
      if (span >= 1e6) {
        const observed = ((packet.samplePosition - measuredSample) / rate * 1e6 / span - 1) * 1e6;
        if (Math.abs(observed) > 10_000) throw new Error("The capture clock rate is discontinuous.");
        ppm += .1 * (Math.max(-1000, Math.min(1000, observed)) - ppm);
        measuredAt = packet.capturedAtUs; measuredSample = packet.samplePosition;
        stats.ppm = ppm;
      }
      sequence = packet.sequence;
      const frames = packet.pcm.length / channels;
      nextSample = packet.samplePosition + frames;
      if (gap) stats.gaps += gap;
      const count = frames + gap;
      // Rate and phase are separate: slowly remove residual phase accumulated during
      // oscillator estimation, with the same hard +/-1000 ppm conversion bound.
      const phaseUs = outputAt / 48_000 * 1e6 - (packet.capturedAtUs - originUs) + gap / rate * 1e6;
      const correction = Math.max(-1000, Math.min(1000, ppm + phaseUs / 5));
      const step = rate / 48_000 * (1 + correction / 1e6);
      const values: number[] = [];
      const sample = (frame: number, channel: number) => frame < 0 ? previous[channel] ?? 0 : frame < gap ? 0 : packet.pcm[(frame - gap) * channels + channel]!;
      // Keep the last input sample until the next packet, so interpolation crosses packet boundaries.
      while (inputAt < count - 1) {
        const left = Math.floor(inputAt), fraction = inputAt - left;
        for (let ch = 0; ch < 2; ch++) {
          const source = Math.min(ch, channels - 1);
          values.push(sample(left, source) * (1 - fraction) + sample(left + 1, source) * fraction);
        }
        inputAt += step;
      }
      inputAt -= count;
      previous = Array.from({ length: channels }, (_, ch) => packet.pcm[(frames - 1) * channels + ch]!);
      const atUs = Math.round(originUs + outputAt / 48_000 * 1e6 + captureLeadUs(policy));
      outputAt += values.length / 2;
      if (atUs < nowUs) stats.late++;
      return { reset, atUs, pcm: new Float32Array(values) };
    },
  };
}

// Binary upload v1: 40-byte LE header and f32 interleaved samples. Generation is negotiated once.
// Capture time is signed: a frame can precede its upload worker's performance.timeOrigin.
export function decodeCapturePacket(data: Buffer, generation: string, clockOffsetUs: number): CaptureAudioPacket {
  if (data.length < 44 || data.length > 40 + maxFrames * 8 || data.readUInt32LE(0) !== 0x31414343 || data.readUInt16LE(6) !== 40) throw new Error("Invalid PCM upload frame.");
  const packet: CaptureAudioPacket = {
    generation, channels: data.readUInt8(4) as 1 | 2, sampleRate: data.readUInt32LE(8), sequence: data.readUInt32LE(12),
    samplePosition: Number(data.readBigUInt64LE(16)), capturedAtUs: Math.round(Number(data.readBigInt64LE(24)) + clockOffsetUs),
    pcm: new Float32Array(data.buffer.slice(data.byteOffset + 40, data.byteOffset + data.length)),
  };
  if (data.readUInt32LE(32) !== packet.pcm.length / packet.channels || data.readUInt8(5) !== 1 || data.readUInt32LE(36) !== 0) throw new Error("Invalid PCM upload header.");
  validateCapturePacket(packet);
  return packet;
}
