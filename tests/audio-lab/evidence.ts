import { record } from "../../packaging/tv/evidence.js";
import type { PcmAnalysis } from "./pcm.ts";
import type { ContinuousAnalysis } from "./continuous.ts";

/** Frozen before playback changes. Changing a gate requires a new contract ID. */
export const liveAudioAcceptance = Object.freeze({
  id: "couch-live-audio/1",
  physicalLatencyMaxMs: 100, softwareLatencyMaxMs: 60, reservedHardwareAndMarginMs: 40,
  virtualOutputSkewMaxMs: 5, calibrationErrorGoalMs: 2,
  mildMissingOrConcealedFractionMax: 0.01, mildInterruptionMaxMs: 100,
  startupMaxMs: 10_000, recoveryMaxMs: 5_000, warmupMaxMs: 10_000,
  requiredListeners: 50, stretchListeners: 100, qualificationRuns: 3,
  qualificationRunMs: 30 * 60_000, soakMs: 2 * 60 * 60_000,
});

export type AudioEvidenceKind = "protocol" | "virtual-output" | "emulator" | "remote-device" | "acoustic";
export type AudioGate = { status: "passed" | "failed" | "inconclusive" | "unmeasured"; reasons: string[] };
export type AudioCalibration = {
  method: "synthetic" | "audio-graph" | "physical";
  status: "measured" | "unmeasured";
  /** Retained separately; never subtracted to make capture latency pass. */
  sourceToCaptureMs: number | null;
  /** Known early-monitor offset, added to observed latency, never subtracted. */
  outputPresentationOffsetMs: number | null;
  /** Bound on relative source/output and pairwise output timing error. */
  uncertaintyMs: number | null;
  artifact: string | null;
  /** Whole source-to-output path established by the calibration artifact.
   * Exact PCM must preserve marker spans; timing calibration or a codec name
   * alone leaves this unknown. Omitted metadata defaults to unknown. */
  fixtureActivityPath?: "exact-pcm" | "lossy" | "unknown";
};
export type LiveAudioRun = {
  evidenceKind: AudioEvidenceKind;
  input: string;
  route: string;
  codec: { name: string | null; packetDurationMs: number | null };
  source: { count: number; sampleRate: number; channels: number };
  receivers: { requested: number; admitted: number; activelyRendering: number; excluded: number };
  network: { profile: string; seed: number; quality: "clean" | "mild" | "fault"; configuration: unknown };
  timeline: { basis: "shared-graph" | "mapped-clocks" | "unmapped"; clockMappingErrorMs: number | null };
  calibration: AudioCalibration;
  workers: { id: string; cpuCount: number; memoryBytes: number; cpuPercentMax: number | null; rssBytesMax: number | null; overloaded: boolean | null }[];
  telemetry: { id: string; rendererUnderruns: number | null; unexpectedMutes: number | null; disconnects: number | null; missingSourceMs: number | null; concealedSourceMs: number | null; longestInterruptionMs: number | null; queueAgeMsMax: number | null; queueBytesMax: number | null }[];
  analysis: PcmAnalysis | null;
  /** The recording/route identity is supplied independently of the analyzer. */
  recording?: { runId: string; routeId: string };
  continuousAnalysis?: ContinuousAnalysis | null;
  fixedWarmupMs: number;
  untested: string[];
};
const gate = (status: AudioGate["status"], ...reasons: string[]): AudioGate => ({ status, reasons });
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

export function createLiveAudioEvidence(run: LiveAudioRun) {
  const { analysis, receivers } = run;
  const calibration = { ...run.calibration, fixtureActivityPath: run.calibration.fixtureActivityPath ?? "unknown" };
  for (const [name, count] of Object.entries(receivers)) if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid receiver count: ${name}`);
  if (receivers.admitted > receivers.requested || receivers.activelyRendering + receivers.excluded > receivers.admitted) throw new Error("Inconsistent receiver counts");
  if (!finite(run.fixedWarmupMs) || run.fixedWarmupMs > liveAudioAcceptance.warmupMaxMs) throw new Error("Fixed warmup exceeds the frozen contract");
  for (const [name, value] of Object.entries(calibration)) if (typeof value === "number" && !finite(value)) throw new Error(`Invalid calibration: ${name}`);
  const invalid: string[] = [];
  if (new Set(run.telemetry.map(value => value.id)).size !== run.telemetry.length) invalid.push("Duplicate renderer telemetry identities");
  if (analysis) {
    if (new Set(analysis.receivers.map(value => value.id)).size !== analysis.receivers.length) invalid.push("Duplicate measured output identities");
    if (!analysis.measurementValid) invalid.push(...analysis.measurementIssues);
    if (analysis.sampleRate !== run.source.sampleRate) invalid.push("Source and analyzer sample rates differ");
    if (analysis.warmupFrames * 1_000 / analysis.sampleRate !== run.fixedWarmupMs) invalid.push("Warmup differs from the predeclared window");
    if (analysis.clockUncertaintyMs !== run.timeline.clockMappingErrorMs) invalid.push("Analyzer and evidence clock bounds differ");
    if (analysis.reference.missing || analysis.reference.duplicated || analysis.reference.outOfOrder || analysis.reference.unmatchedActivityFrames) invalid.push("Reference PCM is incomplete or ambiguous");
    if (analysis.reference.clippedSamples) invalid.push("Reference PCM clips the fixture");
    if (analysis.receivers.some(receiver => receiver.latencyMs.min !== null && receiver.latencyMs.min < -analysis.uncertaintyMs)) invalid.push("Output precedes reference beyond the clock error bound");
  }
  if (run.timeline.basis === "unmapped" || !finite(run.timeline.clockMappingErrorMs)) invalid.push("No bounded common graph/clock mapping");
  if (calibration.status !== "measured" || calibration.method === "synthetic" || !calibration.artifact || !finite(calibration.uncertaintyMs) || !finite(calibration.outputPresentationOffsetMs)) invalid.push("Audio graph/device calibration is unmeasured; synthetic arrays only verify the analyzer");
  if (!run.workers.length || run.workers.some(worker => worker.overloaded === null || !finite(worker.cpuPercentMax) || !finite(worker.rssBytesMax))) invalid.push("Worker headroom is unmeasured");
  if (run.workers.some(worker => worker.overloaded)) invalid.push("Worker overload makes capacity/timing attribution inconclusive");
  const eligible = run.evidenceKind !== "protocol" && analysis !== null;
  const unmeasured = gate("unmeasured", "No decoded/output PCM measurement");
  const cannotMeasure = invalid.length ? gate("inconclusive", ...invalid) : null;
  const uncertaintyMs = analysis && finite(calibration.uncertaintyMs) ? analysis.uncertaintyMs + calibration.uncertaintyMs : null;
  const offsetMs = calibration.outputPresentationOffsetMs;
  const latencyUpperBoundsMs = analysis?.receivers.map(receiver => ({ id: receiver.id, rawObservedMaxMs: receiver.latencyMs.max, upperBoundMs: receiver.latencyMs.max === null || uncertaintyMs === null || offsetMs === null ? null : receiver.latencyMs.max + offsetMs + uncertaintyMs })) ?? [];
  const latencyFailures: string[] = [];
  for (const receiver of analysis?.receivers ?? []) {
    if (!receiver.detected || receiver.latencyMs.count !== receiver.detected) latencyFailures.push(`${receiver.id}: no complete reference matching`);
    if (run.network.quality === "clean" && receiver.missing) latencyFailures.push(`${receiver.id}: ${receiver.missing} missing markers`);
    if (receiver.duplicated || receiver.outOfOrder) latencyFailures.push(`${receiver.id}: repeated or out-of-order source audio`);
  }
  for (const value of latencyUpperBoundsMs) if (value.upperBoundMs !== null && value.upperBoundMs > liveAudioAcceptance.softwareLatencyMaxMs) latencyFailures.push(`${value.id}: observed maximum plus uncertainty exceeds 60 ms`);
  const softwareLatency = !eligible ? unmeasured : cannotMeasure ?? (latencyFailures.length ? gate("failed", ...latencyFailures) : gate("passed"));
  const skewUpperBoundMs = analysis?.skewMs.max !== null && analysis?.skewMs.max !== undefined && uncertaintyMs !== null ? analysis.skewMs.max + uncertaintyMs : null;
  const ambiguousOutputs = analysis?.receivers.some(receiver => receiver.duplicated || receiver.outOfOrder);
  const alignment = !eligible || analysis.receivers.length < 2 ? gate("unmeasured", "At least two PCM outputs are required") : cannotMeasure ?? (ambiguousOutputs ? gate("failed", "Outputs contain repeated or out-of-order source audio") : analysis.skewMs.count !== analysis.expectedMarkers ? gate("failed", "Not every marker reached every output") : skewUpperBoundMs === null ? gate("inconclusive", "No skew measurement") : skewUpperBoundMs > liveAudioAcceptance.virtualOutputSkewMaxMs ? gate("failed", "Maximum virtual-output skew plus uncertainty exceeds 5 ms") : gate("passed"));
  const qualityFailures: string[] = [], qualityUnknown: string[] = [];
  const durationMs = analysis ? (analysis.durationFrames - analysis.warmupFrames) * 1_000 / analysis.sampleRate : 0;
  for (const receiver of analysis?.receivers ?? []) {
    const telemetry = run.telemetry.find(value => value.id === receiver.id);
    if (receiver.clippedSamples) qualityFailures.push(`${receiver.id}: clipped output samples`);
    if (receiver.duplicated || receiver.outOfOrder || (run.network.quality === "clean" && receiver.missing)) qualityFailures.push(`${receiver.id}: missing/repeated/out-of-order markers`);
    if (receiver.unmatchedActivityFrames) {
      const reason = `${receiver.id}: ${receiver.unmatchedActivityFrames} unmatched fixture activity frames outside identified marker spans`;
      if (calibration.fixtureActivityPath === "exact-pcm") qualityFailures.push(reason);
      else qualityUnknown.push(`${reason}; ${calibration.fixtureActivityPath} path cannot distinguish codec/filter spread from replay`);
    }
    if (!analysis?.fixtureActivity) qualityUnknown.push(`${receiver.id}: full-recording fixture activity was not checked`);
    if (!telemetry || Object.entries(telemetry).some(([key, value]) => key !== "id" && (value === null || !finite(value as number)))) { qualityUnknown.push(`${receiver.id}: incomplete renderer/dropout telemetry`); continue; }
    if (telemetry.rendererUnderruns || telemetry.unexpectedMutes || telemetry.disconnects) qualityFailures.push(`${receiver.id}: underrun, unexpected mute or disconnect`);
    const missingOrConcealed = telemetry.missingSourceMs! + telemetry.concealedSourceMs!;
    if (receiver.missing && run.network.quality === "mild") qualityUnknown.push(missingOrConcealed === 0
      ? `${receiver.id}: missing markers contradict zero reported missing/concealed source duration`
      : `${receiver.id}: missing marker duration is unresolved; sparse markers cannot verify supplied lost/concealed duration`);
    if (run.network.quality === "clean" && missingOrConcealed > 0) qualityFailures.push(`${receiver.id}: lost or concealed source duration`);
    if (run.network.quality === "mild" && (missingOrConcealed / durationMs > liveAudioAcceptance.mildMissingOrConcealedFractionMax || telemetry.longestInterruptionMs! > liveAudioAcceptance.mildInterruptionMaxMs)) qualityFailures.push(`${receiver.id}: impaired quality exceeds the frozen gate`);
  }
  const quality = !eligible ? unmeasured : cannotMeasure ?? (run.network.quality === "fault" ? gate("unmeasured", "Fault scenarios require their recovery/isolation assertions") : qualityFailures.length ? gate("failed", ...qualityFailures) : qualityUnknown.length ? gate("inconclusive", ...qualityUnknown) : gate("passed"));
  const rendered = analysis?.receivers.filter(receiver => receiver.detected > 0).length ?? 0;
  const participation = receivers.requested === 0 ? gate("unmeasured", "No receivers requested") : receivers.admitted !== receivers.requested || receivers.activelyRendering !== receivers.requested || receivers.excluded > 0 || rendered !== receivers.activelyRendering ? gate("failed", "Requested, admitted, actively rendering and observed output counts do not all match") : gate("passed");
  const continuous = run.continuousAnalysis;
  const continuousIssues: string[] = [];
  if (continuous) {
    if (!analysis || continuous.manifest.sampleRate !== analysis.sampleRate || continuous.manifest.seed !== analysis.seed
      || continuous.durationFrames !== analysis.durationFrames || continuous.warmupFrames !== analysis.warmupFrames)
      continuousIssues.push("Continuous and marker analyses describe different fixtures or intervals");
    if (!run.recording || continuous.runId !== run.recording.runId || continuous.routeId !== run.recording.routeId)
      continuousIssues.push("Continuous analysis does not match the recording/route identity");
    const markerIds = analysis?.receivers.map(receiver => receiver.id).sort() ?? [];
    if (JSON.stringify(continuous.receivers.map(receiver => receiver.id).sort()) !== JSON.stringify(markerIds))
      continuousIssues.push("Continuous and marker receiver identities differ");
  }
  const continuousAudioIntegrity = !continuous ? gate("unmeasured", "Sparse markers and thresholded activity do not establish continuous waveform identity")
    : continuousIssues.length ? gate("inconclusive", ...continuousIssues)
    : gate(continuous.status, ...continuous.measurementIssues, ...continuous.qualificationIssues,
      ...(continuous.status === "failed" ? ["Continuous waveform identity did not conform to the frozen profile"] : []));
  const gates = { softwareLatency, alignment, quality, participation, continuousAudioIntegrity };
  const values = Object.values(gates);
  const status: AudioGate["status"] = invalid.length && eligible ? "inconclusive" : values.some(value => value.status === "failed") ? "failed" : values.some(value => value.status === "inconclusive") ? "inconclusive" : eligible && values.every(value => value.status === "passed") ? "passed" : "unmeasured";
  const untested = [...new Set([...run.untested, "phone acoustic latency", "physical speaker alignment", "venue Wi-Fi/radio contention", "channel mapping and clipping qualification", "speech/music listening quality", "continuous integrity between markers and quiet/overlaid replay", "three 30-minute runs at 50 listeners and a two-hour churn soak"])];
  const fields = {
    input: run.input,
    measured: {
      contract: liveAudioAcceptance, evidenceKind: run.evidenceKind, status, gates,
      route: run.route, codec: run.codec, source: run.source, receiverCounts: receivers,
      network: run.network, timeline: run.timeline, calibration, workers: run.workers,
      fixedWarmupMs: run.fixedWarmupMs, durationMs, telemetry: run.telemetry, analysis,
      recording: run.recording ?? null, continuousAnalysis: continuous ?? null,
      uncertaintyMs, latencyUpperBoundsMs, skewUpperBoundMs,
      conditions: {
        continuousAudioIntegrity,
        captureToSpeaker: gate("unmeasured", "No synchronized physical acoustic measurement"),
        physicalSpeakerSkew: gate("unmeasured", "Virtual graph alignment is not physical speaker alignment"),
        venueWifi: gate("unmeasured", "Shaping and software clients do not reproduce venue radios"),
        sustained50ListenerQualification: gate("unmeasured", "A single lab run cannot establish the required three runs and soak"),
      },
    },
    untested,
  };
  return record("live-audio", fields) as { schema: "couch-evidence/1"; kind: "live-audio"; at: string } & typeof fields;
}

export type LiveAudioEvidence = ReturnType<typeof createLiveAudioEvidence>;
