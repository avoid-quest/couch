// Protocol fixture only. No device access or generated evidence of audio performance.
import { createInterface } from "node:readline";
const mode = process.argv[2] ?? "ordered", epochUs = 1_000_000_000_000;
const channelArg = process.argv.indexOf("--channels");
const channelMap = channelArg < 0 ? (mode === "mono" ? [1] : [0, 1]) : process.argv[channelArg + 1].split(",").map(n => Number(n) - 1);
const channels = channelMap.length, requestedCallbackFrames = channelArg < 0 ? 128 : Number(process.argv[5]);
const now = () => epochUs + Math.round(performance.now() * 1000);
const event = value => process.stderr.write(JSON.stringify(value) + "\n");
if (mode !== "preparing") event({ event: "ready", sampleRate: 48000, channels, channelMap: mode === "wrong-map" ? [2, 3] : channelMap, format: "f32le", requestedCallbackFrames, ownerHalBufferFrames: 256, nominalRate: 48000, reportedInputLatencyMs: 7 });
const input = createInterface({ input: process.stdin });
function end() { event({ event: "end", reason: "stopped", captureError: 0 }); input.close(); process.exit(0); }
input.on("line", line => {
  if (line.startsWith("clock ")) event({ event: "clock", nonce: Number(line.slice(6)), nativeUs: now() });
  else if (line === "stop") end();
  else if (line === "start" && mode === "stream") {
    // Real-time 128-frame stereo blocks until stopped, timestamped like the hardware's.
    event({ event: "started", ownerHalBufferFrames: 128 });
    const base = now();
    let i = 0;
    setInterval(() => {
      for (; base + Math.round((i + 1) * 128 / 48000 * 1e6) <= now(); i++) {
        const packet = Buffer.alloc(40 + 128 * channels * 4);
        packet.writeUInt32LE(0x31414343); packet[4] = channels; packet[5] = 1; packet.writeUInt16LE(40, 6);
        packet.writeUInt32LE(48000, 8); packet.writeUInt32LE(i, 12); packet.writeBigUInt64LE(BigInt(i * 128), 16);
        packet.writeBigInt64LE(BigInt(base + Math.round(i * 128 / 48000 * 1e6)), 24); packet.writeUInt32LE(128, 32);
        for (let f = 0; f < 128; f++) for (let ch = 0; ch < channels; ch++) packet.writeFloatLE((channelMap[ch] % 2 ? -1 : 1) * Math.sin((i * 128 + f) / 20) / 4, 40 + (f * channels + ch) * 4);
        process.stdout.write(packet);
      }
    }, 1);
  }
  else if (line === "start") {
    event({ event: "started", ownerHalBufferFrames: 256 });
    const base = now() - 16_000, packets = [];
    for (let i = 0; i < 6; i++) {
      const packet = Buffer.alloc(40 + 128 * channels * 4), sequence = mode === "duplicate" && i === 2 ? 1 : i;
      packet.writeUInt32LE(0x31414343); packet[4] = channels; packet[5] = 1; packet.writeUInt16LE(40, 6);
      packet.writeUInt32LE(48000, 8); packet.writeUInt32LE(sequence, 12); packet.writeBigUInt64LE(BigInt(i * 128), 16);
      packet.writeBigInt64LE(BigInt(base + Math.round(i * 128 / 48000 * 1e6)), 24); packet.writeUInt32LE(128, 32);
      for (let f = 0; f < 128; f++) for (let ch = 0; ch < channels; ch++) packet.writeFloatLE(channelMap[ch] % 2 ? -(i + 1) / 32 : (i + 1) / 16, 40 + (f * channels + ch) * 4);
      packets.push(packet);
    }
    const bytes = Buffer.concat(packets);
    process.stdout.write(bytes.subarray(0, 7));
    setTimeout(() => process.stdout.write(bytes.subarray(7)), 2);
  }
});
input.on("close", () => process.exit(0));
