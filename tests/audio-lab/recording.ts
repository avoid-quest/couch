import type { PcmAnalysis } from "./pcm";

/** Complete observations are a prerequisite, not an audio quality verdict. */
export function assessRecording(options: {
  analysis: PcmAnalysis;
  presentation: { status: string; reasons: string[] };
  recorderExitCode: number | null;
  witnessExitCode: number | null;
}) {
  const { analysis, presentation, recorderExitCode, witnessExitCode } = options;
  const reasons: string[] = [];
  if (recorderExitCode !== 0) reasons.push("Recorder did not close successfully");
  if (witnessExitCode !== 0) reasons.push("Witness did not close successfully");
  if (presentation.status !== "passed") reasons.push("Software output comparison is incomplete", ...presentation.reasons);
  if (!analysis.measurementValid) reasons.push("PCM measurement is invalid", ...analysis.measurementIssues);
  for (const track of [analysis.reference, ...analysis.receivers]) {
    if (!track.capture.complete) reasons.push(`${track.id}: incomplete capture coverage`);
    if (track.detected !== analysis.expectedMarkers || track.missing || track.duplicated || track.outOfOrder)
      reasons.push(`${track.id}: missing, duplicated or out-of-order markers`);
    if (track.clippedSamples) reasons.push(`${track.id}: clipped PCM`);
  }
  return { complete: reasons.length === 0, reasons };
}
