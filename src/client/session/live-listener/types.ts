import type { ClockFit } from "./line";

export interface Calibration {
  quantum: number;
  interp: { costMs: { sinc: number; hermite: number } };
  stretch: { costMs: number };
}
export interface LeadCommand { type: "lead"; leadMs: number; atServerUs?: number }
export interface AudioBatch {
  type: "audio";
  position: number;
  frames: number;
  data: Float32Array<ArrayBuffer>;
  capture: ClockFit | null;
  server: ClockFit | null;
  ready: boolean;
}
export type ProcessorMessage = AudioBatch | LeadCommand | { type: "reset" } |
  { type: "clock"; fit: ClockFit } | { type: "slow" };
export interface Recycle { type: "recycle"; data: Float32Array<ArrayBuffer> }
export interface Interpolation {
  mode: "sinc" | "hermite";
  reason: "calibration" | "falling behind";
  quantum: number;
}
export interface Stretch { mode: "wsola" | "rate"; reason: "calibration" | "falling behind" }

// Interval counters, reset after each one-second report. debtMs is signed end-of-interval lag.
export interface RenderStats {
  missing: number; resyncs: number; played: number; errMin: number; errMax: number;
  ratePpm: number; marginMinMs: number; concealed: number; concealEvents: number;
  concealLongest: number; frame: number; debtMs: number; debtMinMs: number; debtMaxMs: number;
  holdMs: number; stretchMs: number; rateCatchUpMs: number; crossfadeJumps: number;
  spliceAttempts: number; spliceRejected: number; splices: number;
  clockShiftMs: number; leadShiftMs: number; holdDebtMs: number; driftCorrectionMs: number;
  crossfadeMs: number; deadlineMarginMinMs: number; needMs: number;
  unavoidableDebtMs: number; recoverableDebtMs: number; audioMessages: number; audioFrames: number;
}
export interface WorkletStats extends RenderStats {
  interp: Interpolation; stretch: Stretch; leadMs: number;
}
export interface NetworkStats {
  arrivalGapMaxMs: number; packets: number;
  headroomMinMs: number | null; headroomP01Ms: number | null; headroomP50Ms: number | null;
  rttMinMs: number | null; serverSlopePpm: number; captureRatePpm: number;
}
export interface ListenerStats extends WorkletStats, NetworkStats {
  outputLatencyMs: number; baseLatencyMs: number; renderQuantum: number;
}
export type ListenerState =
  | { state: "preparing" | "needs-tap" | "playing" | "reconnecting" | "needs-https" | "stopped" }
  | { state: "removed" | "failed"; reason: string };

// The only Core handshake seam: URL/subprotocols (or an initial JSON auth message).
// No credentials, endpoint discovery or membership policy live in the listener.
export interface ListenerConnection {
  url: string;
  protocols?: string[];
  auth?: Record<string, unknown>;
}
export type WorkerCommand =
  | ({ type: "start"; port: MessagePort } & ListenerConnection)
  | { type: "stats"; stats: WorkletStats & { outputLatencyMs: number; baseLatencyMs: number; renderQuantum: number } };
export type WorkerEvent = { type: "state"; value: ListenerState } | { type: "stats"; stats: ListenerStats };
