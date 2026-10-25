import type { AudioPreparation } from "../../shared/protocol";

/** One receiver's runtime readiness. No readiness value is a physical qualification. */
export type PreparedReceiver = {
  readonly outputReady: boolean;
  readonly outputState: string;
  /** The SDK's public clock uncertainty is in milliseconds. */
  readonly timeSyncInfo: { synced: boolean; error: number };
  readonly syncInfo: { outputLatencyMs: number };
  prepareAudio(format: { codec: "opus"; sample_rate: number; channels: number; bit_depth: number }): Promise<void>;
  invalidateAudio(): void;
};
export type PreparationPublisher = (report: AudioPreparation & { epoch: number }, timing?: { requiredLeadTimeMs: number; minBufferMs: number }) => void;
export function createReceiverAdmission(receiver: PreparedReceiver, active: () => boolean, publish: PreparationPublisher, now = () => performance.now()) {
  let epoch = 0, closed = false, preparing: number | undefined, admitted = false, nextAttempt = 0, latency = 0, failures = 0, eligibility = "", lastError: string | undefined;
  let loggedAt = -Infinity, diagnostic: object | undefined, logTimer: ReturnType<typeof setTimeout> | undefined, coalesced = 0;
  const flush = () => { logTimer = undefined; if (!closed && diagnostic) { console.info("[audio-preparation]", { ...diagnostic, receiptMs: now(), coalesced }); loggedAt = now(); diagnostic = undefined; coalesced = 0; } };
  const synchronized = () => {
    const { synced, error } = receiver.timeSyncInfo;
    return synced && Number.isFinite(error) && error >= 0 && error <= 10;
  };
  const emit = (report: AudioPreparation, timing?: { requiredLeadTimeMs: number; minBufferMs: number }) => {
    if (closed || !active()) return;
    publish({ ...report, epoch }, timing);
    if (diagnostic) coalesced++;
    diagnostic = { state: report.state, epoch, failures, lastError, outputState: receiver.outputState, outputReady: receiver.outputReady,
      synced: receiver.timeSyncInfo.synced, clockErrorMs: receiver.timeSyncInfo.error, outputLatencyMs: receiver.syncInfo.outputLatencyMs };
    if (now() - loggedAt >= 1000) { clearTimeout(logTimer); flush(); }
    else logTimer ??= setTimeout(flush, 1000 - (now() - loggedAt));
  };
  const invalidate = (output: boolean) => {
    epoch++; admitted = false; preparing = undefined; nextAttempt = 0; failures = 0; lastError = undefined;
    emit({ state: "preparing" });
    if (output) receiver.invalidateAudio();
  };
  emit({ state: "preparing" });
  return {
    async tick() {
      if (closed || !active()) return;
      const running = receiver.outputState === "running", synced = synchronized();
      const nextEligibility = `${running}:${synced}`;
      if (eligibility && eligibility !== nextEligibility) invalidate(false);
      eligibility = nextEligibility;
      if (admitted && (!running || !synced || !receiver.outputReady || !Number.isFinite(receiver.syncInfo.outputLatencyMs) || receiver.syncInfo.outputLatencyMs < 0 || Math.abs(receiver.syncInfo.outputLatencyMs - latency) > 10)) invalidate(running && synced);
      if (admitted || preparing !== undefined || failures >= 3 || !running || !synced || now() < nextAttempt) return;
      const attempt = preparing = epoch;
      try {
        await receiver.prepareAudio({ codec: "opus", sample_rate: 48000, channels: 2, bit_depth: 16 });
        if (closed || attempt !== epoch || !active() || receiver.outputState !== "running" || !receiver.outputReady || !synchronized()) return;
        latency = receiver.syncInfo.outputLatencyMs;
        if (!Number.isFinite(latency) || latency < 0) throw new Error("The audio output has no valid latency estimate.");
        admitted = true; failures = 0; lastError = undefined;
        emit({ state: "ready" }, { minBufferMs: 25, requiredLeadTimeMs: Math.max(25, Math.ceil(latency) + 10) });
      } catch (error) {
        if (closed || attempt !== epoch || !active()) return;
        admitted = false;
        failures++;
        lastError = (error instanceof Error ? error.message : "Audio output preparation failed.").replace(/(?:https?|wss?):\/\/\S+/gi, "[url]").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 240) || "Audio output preparation failed.";
        emit(failures >= 3 ? { state: "failed", error: lastError } : { state: "preparing" });
      } finally {
        if (preparing === attempt) preparing = undefined;
        if (attempt === epoch) nextAttempt = now() + 2000;
      }
    },
    outputChanged() { if (!closed) invalidate(true); },
    close() { closed = true; epoch++; preparing = undefined; clearTimeout(logTimer); diagnostic = undefined; },
  };
}
