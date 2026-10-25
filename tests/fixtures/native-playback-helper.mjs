const scenario = process.argv[2];
const emit = event => process.stdout.write(JSON.stringify(event) + "\n");
let pending = Buffer.alloc(0), sequence = 0, total = 0;
if (scenario !== "wait") {
  emit({ event: "rate", actualRate: 48000, method: scenario === "trivial" ? "trivial" : "speex-float-1" });
  const ready = JSON.stringify({ event: "ready", sampleRate: scenario === "wrong-rate" ? 44100 : 48000,
    channels: 2, bitDepth: 16, maxQueueUs: 20500, requestedMs: 20 }) + "\n";
  process.stdout.write(ready.slice(0, 17));
  setTimeout(() => process.stdout.write(ready.slice(17)), 5);
}
process.stdin.on("data", chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 16) {
    const target = Number(pending.readBigInt64LE()), frames = pending.readUInt32LE(8), seq = pending.readUInt32LE(12);
    if (pending.length < 16 + frames * 4) return;
    if (!frames) {
      pending = pending.subarray(16);
      if (!seq) { emit({ event: "stopped", exit: 0, frames: total }); process.exit(0); }
      emit({ event: "fixture-control", op: seq, value: target }); continue;
    }
    emit({ event: "fixture-packet", target, receivedNativeUs: Number(process.hrtime.bigint() / 1000n), sequence: seq,
      pcm: pending.subarray(16, 16 + frames * 4).toString("base64") });
    emit({ event: "write", sequence: scenario === "bad-sequence" ? sequence + 1 : sequence,
      frames: scenario === "bad-frames" ? frames + 1 : frames });
    sequence++; total += frames; pending = pending.subarray(16 + frames * 4);
  }
});
process.stdin.on("end", () => process.exit(0));
if (scenario === "blocked") process.stdin.pause();
