/** Exact sample-address verification at named software JACK ports. No DAC claim.
 * Wire/lifecycle contract: ./presentation.md. */
export const presentationProtocol = { magic: "CLABPCM1", headerBytes: 24, recordBytes: 64, sampleRate: 48_000, maxFrames: 140 * 48_000 } as const;
export type PresentationHeader = { sampleRate: number; channels: number; quantum: number; role: "graph" | "witness" };
export type PresentationRecord = {
  sequence: number; firstFrame: number; frameCount: number; flags: number; topologyChanges: number; xruns: number;
  sourceStarted: boolean; sourceFirstFrame: number | null; currentUsecs: number; nextUsecs: number; totalFrames: number;
};
export type PresentationBlock = PresentationRecord & { samples: Float32Array; cyclePredictionResidualUs: number | null };
export type PresentationCapture = PresentationHeader & { blocks: PresentationBlock[]; end: PresentationRecord };

export function createPresentationParser(options: {
  maxFrames: number; maxChannels?: number; maxBytes?: number;
  onBlock?: (block: PresentationBlock, header: PresentationHeader) => void;
}) {
  const { maxFrames, maxChannels = 4, maxBytes = 64 * 1024 * 1024 } = options;
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > presentationProtocol.maxFrames ||
      !Number.isInteger(maxChannels) || maxChannels < 2 || maxChannels > 101 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 88 || maxBytes > 256 * 1024 * 1024) throw new Error("Invalid presentation parser bounds");
  let pending: Buffer = Buffer.alloc(0), receivedBytes = 0, header: PresentationHeader | null = null;
  let end: PresentationRecord | null = null, previous: PresentationBlock | null = null, finished = false, failed = false;
  let sourceFirstFrame: number | null = null;
  const blocks: PresentationBlock[] = [];
  const u64 = (at: number) => {
    const value = pending.readBigUInt64LE(at);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe presentation integer");
    return Number(value);
  };
  return {
    push(bytes: Uint8Array) {
      if (finished || failed) throw new Error("Presentation parser is closed");
      try {
        receivedBytes += bytes.byteLength;
        if (receivedBytes > maxBytes) throw new Error("Presentation byte ceiling exceeded");
        pending = Buffer.concat([pending, bytes]);
        if (!header) {
          if (pending.length < 24) return;
          if (pending.toString("ascii", 0, 8) !== presentationProtocol.magic) throw new Error("Invalid presentation magic/version");
          const sampleRate = pending.readUInt32LE(8), channels = pending.readUInt32LE(12), quantum = pending.readUInt32LE(16), role = pending.readUInt32LE(20);
          if (sampleRate !== 48_000 || channels < 2 || channels > maxChannels || quantum < 128 || quantum > 4096 || (quantum & (quantum - 1)) || (role !== 1 && role !== 2)) throw new Error("Invalid presentation stream header");
          header = { sampleRate, channels, quantum, role: role === 1 ? "graph" : "witness" };
          pending = pending.subarray(24);
        }
        while (pending.length) {
          if (end) throw new Error("Bytes after presentation END1");
          if (pending.length < 64) return;
          const tag = pending.toString("ascii", 0, 4);
          if (tag !== "PCM1" && tag !== "END1") throw new Error("Invalid presentation record tag");
          const record: PresentationRecord = {
            sequence: pending.readUInt32LE(4), firstFrame: pending.readUInt32LE(8), frameCount: pending.readUInt32LE(12),
            flags: pending.readUInt32LE(16), topologyChanges: pending.readUInt32LE(20), xruns: pending.readUInt32LE(24),
            sourceStarted: pending.readUInt32LE(28) === 1, sourceFirstFrame: pending.readUInt32LE(28) === 1 ? pending.readUInt32LE(32) : null,
            currentUsecs: u64(40), nextUsecs: u64(48), totalFrames: u64(56),
          };
          if ((record.flags & ~1023) || pending.readUInt32LE(28) > 1 || pending.readUInt32LE(36) !== 0 || (!record.sourceStarted && pending.readUInt32LE(32) !== 0) ||
              (header.role === "witness" && record.sourceStarted)) throw new Error("Invalid presentation source metadata");
          if (record.sequence !== blocks.length || record.totalFrames > maxFrames) throw new Error("Presentation sequence/frame bound violated");
          if (previous && record.firstFrame !== ((previous.firstFrame + previous.frameCount) >>> 0)) throw new Error("Discontinuous JACK cycle frames");
          if (previous && ((record.flags | previous.flags) !== record.flags || record.topologyChanges < previous.topologyChanges || record.xruns < previous.xruns)) throw new Error("Presentation health counters regressed");
          if (sourceFirstFrame !== null && record.sourceFirstFrame !== sourceFirstFrame) throw new Error("Presentation source origin changed");
          if (tag === "END1") {
            if (record.frameCount !== 0 || record.totalFrames !== (previous?.totalFrames ?? 0) || record.currentUsecs !== 0 || record.nextUsecs !== 0) throw new Error("Invalid presentation terminal totals");
            end = record; pending = pending.subarray(64); continue;
          }
          if (record.frameCount !== header.quantum || record.totalFrames !== (previous?.totalFrames ?? 0) + record.frameCount) throw new Error("Invalid presentation callback size/totals");
          const length = 64 + record.frameCount * header.channels * 4;
          if (pending.length < length) return;
          if (!record.currentUsecs || record.nextUsecs <= record.currentUsecs) {
            // Keep raw PCM from unhealthy runs, but never qualify their timing.
            if (!(record.flags & 64)) throw new Error("Unflagged cycle-time discontinuity");
          }
          const samples = new Float32Array(record.frameCount * header.channels);
          for (let i = 0; i < samples.length; i++) {
            samples[i] = pending.readFloatLE(64 + i * 4);
            if (!Number.isFinite(samples[i])) throw new Error("Non-finite presentation PCM");
          }
          sourceFirstFrame = record.sourceFirstFrame;
          previous = { ...record, samples, cyclePredictionResidualUs: previous ? record.currentUsecs - previous.nextUsecs : null }; blocks.push(previous);
          pending = pending.subarray(length);
          options.onBlock?.(previous, header);
        }
      } catch (error) { failed = true; throw error; }
    },
    finish(): PresentationCapture {
      if (finished || failed) throw new Error("Presentation parser is closed");
      finished = true;
      if (!header || !end || pending.length || !blocks.length) throw new Error("Incomplete presentation stream (missing callback/END1 or truncated payload)");
      return { ...header, blocks, end };
    },
  };
}

/** One run must be shorter than 2^31 frames. The anchor is common to all ports. */
export function unwrapPresentationFrame(raw: number, anchor: number) {
  if (![raw, anchor].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff)) throw new Error("Invalid raw JACK frame");
  return anchor + ((raw - anchor) | 0);
}

type Comparison = { comparedFrames: number; missingFrames: number; mismatchedFrames: number; activeFrames: number; firstMismatchFrame: number | null };
function compare(length: number, start: number, left: (frame: number) => number | undefined, right: (frame: number) => number | undefined): Comparison {
  const result: Comparison = { comparedFrames: 0, missingFrames: 0, mismatchedFrames: 0, activeFrames: 0, firstMismatchFrame: null };
  for (let frame = start; frame < start + length; frame++) {
    const a = left(frame), b = right(frame);
    if (a === undefined || b === undefined) { result.missingFrames++; result.firstMismatchFrame ??= frame; continue; }
    result.comparedFrames++;
    if (Math.abs(b) > 0.05) result.activeFrames++;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Object.is(a, b)) { result.mismatchedFrames++; result.firstMismatchFrame ??= frame; }
  }
  return result;
}

export function assessPresentation(options: {
  recorder: PresentationCapture; witness: PresentationCapture; source: Float32Array; receiverPorts: string[];
  expectedReceiverDelayFrames: 0 | 128; startFrame?: number; endFrame?: number; topologyVerified: boolean;
}) {
  const { recorder, witness, source, receiverPorts, expectedReceiverDelayFrames: delay, topologyVerified } = options;
  const start = options.startFrame ?? 0, end = options.endFrame ?? source.length;
  if (!source.length || source.length > 120 * 48_000 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end + delay > presentationProtocol.maxFrames || (delay !== 0 && delay !== 128)) throw new Error("Invalid presentation assessment bounds");
  const reasons: string[] = [];
  if (!topologyVerified) reasons.push("Exact source/Pulse sink port topology was not verified");
  if (recorder.role !== "graph" || witness.role !== "witness" || recorder.sampleRate !== 48_000 || witness.sampleRate !== 48_000 || recorder.quantum !== witness.quantum || recorder.channels !== witness.channels || recorder.channels !== receiverPorts.length + 1) reasons.push("Capture roles/rate/quantum/channel bindings differ");
  if (!receiverPorts.length || new Set(receiverPorts).size !== receiverPorts.length || receiverPorts.some(port => !port.includes(":"))) reasons.push("Receiver ports must be unique exact JACK port names");
  for (const [name, capture] of [["recorder", recorder], ["witness", witness]] as const) {
    if (!capture.blocks.length || capture.end.flags || capture.end.topologyChanges || capture.end.xruns) reasons.push(`${name}: missing capture, unhealthy stream or changed topology`);
    if (capture.blocks.some(block => block.flags || block.xruns || block.topologyChanges)) reasons.push(`${name}: unhealthy callback`);
  }
  const rawSource = recorder.end.sourceFirstFrame;
  if (rawSource === null) reasons.push("Source did not start at a declared JACK frame");
  const anchor = recorder.blocks[0]?.firstFrame ?? 0;
  const sourceFrame = rawSource === null ? anchor : unwrapPresentationFrame(rawSource, anchor);
  const reader = (capture: PresentationCapture, channel: number) => {
    const origin = unwrapPresentationFrame(capture.blocks[0]?.firstFrame ?? 0, anchor);
    return (relative: number) => {
      const index = sourceFrame + relative - origin;
      if (index < 0 || index >= capture.end.totalFrames || channel >= capture.channels) return undefined;
      const block = capture.blocks[Math.floor(index / capture.quantum)];
      return block?.samples[(index % capture.quantum) * capture.channels + channel];
    };
  };
  const witnessReference = reader(witness, 0), recorderReference = reader(recorder, 0);
  const referenceEnd = Math.max(source.length, end + delay);
  // The finite fixture is silent after EOF. Verify that declaration too,
  // including the output tail and the private recorder FIFO displacement.
  const sourceVerification = compare(referenceEnd, 0, witnessReference, frame => source[frame] ?? 0);
  const reference = compare(referenceEnd, 0, recorderReference, witnessReference);
  const valid = (result: Comparison) => !result.missingFrames && !result.mismatchedFrames && result.activeFrames > 0;
  if (!valid(sourceVerification)) reasons.push("Witness source does not exactly match the retained file at the declared source frame, or is inactive");
  if (!valid(reference)) reasons.push("Recorder reference does not exactly match witness at the same absolute frames, or is inactive");
  const outputs = receiverPorts.map((port, index) => {
    const recorded = reader(recorder, index + 1), observed = reader(witness, index + 1);
    const comparison = compare(end - start, start, frame => recorded(frame + delay), observed);
    const zeroDelay = delay ? compare(end - start, start, recorded, observed) : comparison;
    if (!valid(comparison)) reasons.push(`${port}: missing, unequal or inactive software output samples at expected delay ${delay}`);
    if (delay && (!zeroDelay.mismatchedFrames || zeroDelay.missingFrames)) reasons.push(`${port}: 128-frame control did not independently reject zero delay with complete coverage`);
    return { port, expectedDelayFrames: delay, ...comparison, zeroDelay };
  });
  return {
    status: reasons.length ? "inconclusive" as const : "passed" as const, reasons,
    boundary: "PCM at the named JACK output ports; the runner verifies Pulse module-jack-sink/browser ownership separately",
    timeBasis: "JACK sample frames at nominal 48000 Hz", sourceFirstFrame: rawSource, absoluteSourceFirstFrame: sourceFrame,
    interval: { startFrame: start, endFrame: end, referenceEndFrame: referenceEnd },
    sourceVerification, reference, outputs, expectedReceiverDelayFrames: delay,
    outputPresentationOffsetMs: !reasons.length && delay === 0 ? 0 : null,
    additionalFrameMappingUncertaintyMs: !reasons.length ? 0 : null,
    unmeasured: ["physical DAC/acoustic presentation", "separate source capture delay", "whole browser path exact PCM", "wall-clock pacing uncertainty", "mobile and 50-renderer qualification"],
  };
}
