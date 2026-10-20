import { expect, test } from "bun:test";
import { assessPresentation, createPresentationParser, unwrapPresentationFrame } from "./audio-lab/presentation";

const quantum = 128, sourceFirst = 0xffff_ff80;
const source = Float32Array.from({ length: 512 }, (_, index) => ((index * 73) % 251 - 125) / 512);
const raw = (frame: number) => frame >>> 0;
const sample = (frame: number) => source[frame] ?? 0;

// Independent binary fixture writer: real callbacks always contain whole periods.
function stream({ role = 1, first = -256, last = 1024, origin = sourceFirst, declaredOrigin = origin,
  delay = 0, inactive = false, flags = 0, xruns = 0, topology = 0, clockResidual = 0,
}: { role?: number; first?: number; last?: number; origin?: number; declaredOrigin?: number;
  delay?: number; inactive?: boolean; flags?: number; xruns?: number; topology?: number; clockResidual?: number } = {}) {
  const header = Buffer.alloc(24); header.write("CLABPCM1");
  header.writeUInt32LE(48000, 8); header.writeUInt32LE(3, 12); header.writeUInt32LE(quantum, 16); header.writeUInt32LE(role, 20);
  const chunks = [header];
  let sequence = 0, total = 0;
  for (let frame = first; frame < last; frame += quantum) {
    const block = Buffer.alloc(64 + quantum * 3 * 4); block.write("PCM1");
    block.writeUInt32LE(sequence, 4); block.writeUInt32LE(raw(origin + frame), 8); block.writeUInt32LE(quantum, 12);
    block.writeUInt32LE(flags, 16); block.writeUInt32LE(topology, 20); block.writeUInt32LE(xruns, 24);
    if (role === 1 && frame >= 0) { block.writeUInt32LE(1, 28); block.writeUInt32LE(raw(declaredOrigin), 32); }
    block.writeBigUInt64LE(BigInt(1_000_000 + sequence * 2667 + (sequence ? clockResidual : 0)), 40);
    block.writeBigUInt64LE(BigInt(1_000_000 + (sequence + 1) * 2667 + (sequence ? clockResidual : 0)), 48);
    total += quantum; block.writeBigUInt64LE(BigInt(total), 56);
    for (let i = 0; i < quantum; i++) {
      block.writeFloatLE(sample(frame + i), 64 + i * 12);
      for (let channel = 1; channel < 3; channel++) block.writeFloatLE(inactive ? 0 : sample(frame + i - channel * 128 - delay), 64 + i * 12 + channel * 4);
    }
    chunks.push(block); sequence++;
  }
  const end = Buffer.alloc(64); end.write("END1"); end.writeUInt32LE(sequence, 4); end.writeUInt32LE(raw(origin + last), 8);
  end.writeUInt32LE(flags, 16); end.writeUInt32LE(topology, 20); end.writeUInt32LE(xruns, 24);
  if (role === 1) { end.writeUInt32LE(1, 28); end.writeUInt32LE(raw(declaredOrigin), 32); }
  end.writeBigUInt64LE(BigInt(total), 56); chunks.push(end);
  return Buffer.concat(chunks);
}

function parse(bytes: Buffer, chunkSize = 173) {
  const parser = createPresentationParser({ maxFrames: 4096 });
  for (let at = 0; at < bytes.length; at += chunkSize) parser.push(bytes.subarray(at, at + chunkSize));
  return parser.finish();
}
const receiverPorts = ["couch_receiver_0:mono", "couch_receiver_1:mono"];
const assess = (recorder = parse(stream()), witness = parse(stream({ role: 2, first: -128 })), delay: 0 | 128 = 0) =>
  assessPresentation({ recorder, witness, source, receiverPorts, expectedReceiverDelayFrames: delay, topologyVerified: true });

test("parses arbitrary pipe fragments, preroll, whole callbacks and source origin across u32 wrap", () => {
  const observed: (number | null)[] = [];
  const parser = createPresentationParser({ maxFrames: 4096, onBlock: (block, header) => {
    expect(header).toMatchObject({ role: "graph", channels: 3, quantum: 128 });
    observed.push(block.sourceFirstFrame);
  } });
  const bytes = stream();
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  const capture = parser.finish();
  expect(observed.slice(0, 3)).toEqual([null, null, sourceFirst]);
  expect(capture.end).toMatchObject({ sourceFirstFrame: sourceFirst, totalFrames: 1280, frameCount: 0 });
  expect(capture.blocks[3]!.firstFrame).toBe(0);
  expect(unwrapPresentationFrame(0, sourceFirst)).toBe(0x1_0000_0000);
  expect(unwrapPresentationFrame(0xffff_ff80, 0)).toBe(-128);
  expect(assess(capture)).toMatchObject({ status: "passed", outputPresentationOffsetMs: 0 });
});

test("aligns streams against one epoch when only one starts after wrap", () => {
  const origin = 128;
  const recorder = parse(stream({ origin, first: -512 }));
  const witness = parse(stream({ role: 2, origin, first: -128 }));
  expect(assess(recorder, witness)).toMatchObject({ status: "passed", absoluteSourceFirstFrame: 0x1_0000_0080 });
});

test("actual 128-sample receiver FIFO passes expected delay and rejects a zero-delay assumption", () => {
  const recorder = parse(stream({ delay: 128 })), witness = parse(stream({ role: 2 }));
  const shifted = assess(recorder, witness, 128);
  expect(shifted.status).toBe("passed");
  expect(shifted.outputPresentationOffsetMs).toBeNull();
  expect(shifted.reference.mismatchedFrames).toBe(0);
  expect(shifted.outputs.every(output => output.mismatchedFrames === 0 && output.zeroDelay.mismatchedFrames > 0)).toBe(true);
  expect(assess(recorder, witness).status).toBe("inconclusive");
  expect(assess(parse(stream()), witness, 128).status).toBe("inconclusive");
});

test("rejects false source origin instead of correlating it into alignment", () => {
  const result = assess(parse(stream({ declaredOrigin: raw(sourceFirst + 128) })));
  expect(result.status).toBe("inconclusive");
  expect(result.sourceVerification.mismatchedFrames).toBeGreaterThan(0);
});

test("matching silent sink outputs cannot qualify the boundary", () => {
  const result = assess(parse(stream({ inactive: true })), parse(stream({ role: 2, inactive: true })));
  expect(result.status).toBe("inconclusive");
  expect(result.outputs[0]).toMatchObject({ mismatchedFrames: 0, activeFrames: 0 });
});

test("missing source or delayed-tail coverage cannot qualify by comparing a shorter overlap", () => {
  expect(assess(parse(stream()), parse(stream({ role: 2, first: 128 }))).status).toBe("inconclusive");
  const result = assess(parse(stream({ delay: 128, last: 512 })), parse(stream({ role: 2 })), 128);
  expect(result.status).toBe("inconclusive");
  expect(result.outputs[0]!.missingFrames).toBe(128);
});

test("clock prediction residuals remain diagnostics, distinct from exact sample-frame continuity", () => {
  const capture = parse(stream({ clockResidual: 17 }));
  expect(capture.blocks[1]!.cyclePredictionResidualUs).toBe(17);
  expect(assess(capture).status).toBe("passed");
});

for (const bad of [{ flags: 1 }, { flags: 2 }, { flags: 4 }, { flags: 8 }, { flags: 16 }, { flags: 32 }, { flags: 64 }, { flags: 128 }, { flags: 256 }, { flags: 512 }, { xruns: 1 }, { topology: 1 }]) {
  test(`retains but cannot qualify unhealthy capture ${JSON.stringify(bad)}`, () => {
    expect(assess(parse(stream(bad))).status).toBe("inconclusive");
    expect(assess(parse(stream()), parse(stream({ role: 2, ...bad }))).status).toBe("inconclusive");
  });
}

test("requires terminal health even when every PCM block was healthy", () => {
  const bytes = stream(); bytes.writeUInt32LE(1, bytes.length - 64 + 20);
  expect(assess(parse(bytes)).status).toBe("inconclusive");
});

test("requires separately verified topology and exact channel bindings", () => {
  const args = { recorder: parse(stream()), witness: parse(stream({ role: 2 })), source, receiverPorts, expectedReceiverDelayFrames: 0 as const };
  expect(assessPresentation({ ...args, topologyVerified: false }).status).toBe("inconclusive");
  expect(assessPresentation({ ...args, receiverPorts: [receiverPorts[0]!, receiverPorts[0]!], topologyVerified: true }).status).toBe("inconclusive");
});

const secondBlock = 24 + 64 + quantum * 3 * 4;
for (const [name, mutate] of [
  ["duplicate sequence", (bytes: Buffer) => bytes.writeUInt32LE(0, secondBlock + 4)],
  ["skipped cycle", (bytes: Buffer) => bytes.writeUInt32LE(raw(sourceFirst + 128), secondBlock + 8)],
  ["partial callback", (bytes: Buffer) => bytes.writeUInt32LE(127, 24 + 12)],
  ["bad totals", (bytes: Buffer) => bytes.writeBigUInt64LE(999n, 24 + 56)],
  ["nonfinite PCM", (bytes: Buffer) => bytes.writeFloatLE(NaN, 24 + 64)],
  ["unsafe timestamp", (bytes: Buffer) => bytes.writeBigUInt64LE(2n ** 63n, 24 + 40)],
  ["unflagged cycle metadata", (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 24 + 40)],
  ["changed source origin", (bytes: Buffer) => bytes.writeUInt32LE(123, bytes.length - 64 + 32)],
  ["wrong terminal totals", (bytes: Buffer) => bytes.writeBigUInt64LE(999n, bytes.length - 8)],
] as const) {
  test(`rejects ${name}`, () => { const bytes = stream(); mutate(bytes); expect(() => parse(bytes)).toThrow(); });
}

test("rejects missing END1, truncated PCM, trailing bytes and reuse after finish", () => {
  const bytes = stream();
  for (const bad of [bytes.subarray(0, bytes.length - 64), bytes.subarray(0, 150), Buffer.concat([bytes, Buffer.from([0])])]) expect(() => parse(bad)).toThrow();
  const parser = createPresentationParser({ maxFrames: 4096 }); parser.push(bytes); parser.finish();
  expect(() => parser.finish()).toThrow(); expect(() => parser.push(Buffer.alloc(0))).toThrow();
});

test("enforces byte, frame and channel ceilings before unbounded retention", () => {
  expect(() => createPresentationParser({ maxFrames: 140 * 48000 + 1 })).toThrow();
  const bytes = stream();
  const smallBytes = createPresentationParser({ maxFrames: 4096, maxBytes: 100 });
  expect(() => smallBytes.push(bytes)).toThrow("byte ceiling");
  const smallFrames = createPresentationParser({ maxFrames: 128 });
  expect(() => smallFrames.push(bytes)).toThrow("frame bound");
  const smallChannels = createPresentationParser({ maxFrames: 4096, maxChannels: 2 });
  expect(() => smallChannels.push(bytes)).toThrow("stream header");
});
