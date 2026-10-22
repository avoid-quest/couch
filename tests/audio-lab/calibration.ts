import { liveAudioAcceptance, type AudioGate } from "./evidence.ts";
import type { PcmAnalysis } from "./pcm.ts";

/** A known-delay run qualifies only this graph/analyzer combination. It does not
 * calibrate Pulse capture, a phone DAC, or the time sound reaches a microphone. */
export function assessGraphCalibration(analysis: PcmAnalysis, expectedDelaysMs: Record<string, number>, graph: { xruns: number | null; overflow: boolean | null; exitCode: number | null }) {
  const reasons = [...analysis.measurementIssues];
  if (graph.xruns !== 0 || graph.overflow !== false || graph.exitCode !== 0) reasons.push("Graph xruns, overflow, incomplete exit, or unmeasured graph health");
  if (!analysis.measurementValid || analysis.reference.missing || analysis.reference.duplicated || analysis.reference.outOfOrder || !analysis.reference.detected) reasons.push("Incomplete or invalid source reference");
  if (!Object.keys(expectedDelaysMs).length || Object.keys(expectedDelaysMs).length !== analysis.receivers.length) reasons.push("Known delay and measured output counts differ");
  const outputs = analysis.receivers.map(receiver => {
    const expectedMs = expectedDelaysMs[receiver.id];
    const observed = receiver.latencyMs;
    const valid = Number.isFinite(expectedMs) && expectedMs! >= 0;
    const maxAbsoluteErrorMs = valid && observed.min !== null && observed.max !== null ? Math.max(Math.abs(observed.min - expectedMs!), Math.abs(observed.max - expectedMs!)) : null;
    const errorUpperBoundMs = maxAbsoluteErrorMs === null ? null : maxAbsoluteErrorMs + analysis.uncertaintyMs;
    if (!valid || receiver.detected !== receiver.expected || observed.count !== receiver.expected || receiver.missing || receiver.duplicated || receiver.outOfOrder) reasons.push(`${receiver.id}: not every known marker was observed once and in order`);
    if (errorUpperBoundMs === null || errorUpperBoundMs > liveAudioAcceptance.calibrationErrorGoalMs) reasons.push(`${receiver.id}: maximum calibration error plus uncertainty exceeds 2 ms`);
    return { id: receiver.id, expectedMs: expectedMs ?? null, observedMs: observed, maxAbsoluteErrorMs, errorUpperBoundMs };
  });
  const errors = outputs.map(output => output.maxAbsoluteErrorMs).filter((value): value is number => value !== null);
  const maxAbsoluteErrorMs = errors.length === outputs.length && errors.length ? Math.max(...errors) : null;
  return {
    status: (reasons.length ? "inconclusive" : "passed") as AudioGate["status"], reasons,
    scope: "common-graph known-delay calibration", graph, outputs, maxAbsoluteErrorMs,
    uncertaintyMs: maxAbsoluteErrorMs === null ? null : maxAbsoluteErrorMs + analysis.uncertaintyMs,
    untested: ["source-to-capture delay measured separately", "physical output latency", "acoustic speaker timing"],
  };
}
