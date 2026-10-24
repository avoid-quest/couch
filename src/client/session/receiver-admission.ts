/** One receiver's runtime readiness. No readiness value is a physical qualification. */
export type PreparedReceiver = {
  readonly outputReady: boolean;
  readonly outputState: string;
  readonly timeSyncInfo: { synced: boolean; error: number };
  readonly syncInfo: { outputLatencyMs: number };
  prepareAudio(format: { codec: "opus"; sample_rate: number; channels: number; bit_depth: number }): Promise<void>;
  invalidateAudio(): void;
  setRequiredLeadTimeMs(value: number): void;
  setMinBufferMs(value: number): void;
};
export function createReceiverAdmission(receiver: PreparedReceiver, active: () => boolean, now = () => performance.now()) {
  let epoch = 0, closed = false, preparing = false, admitted = false, nextAttempt = 0, latency = 0, failures = 0, eligibility = "";
  const synchronized = () => receiver.timeSyncInfo.synced && receiver.timeSyncInfo.error <= 10_000;
  const invalidate = (output: boolean) => {
    epoch++; admitted = false; nextAttempt = 0; failures = 0;
    receiver.setRequiredLeadTimeMs(1000);
    if (output) receiver.invalidateAudio();
  };
  return {
    async tick() {
      if (closed || !active()) return;
      const running = receiver.outputState === "running", synced = synchronized();
      const nextEligibility = `${running}:${synced}`;
      if (eligibility !== nextEligibility) { eligibility = nextEligibility; failures = 0; nextAttempt = 0; }
      if (admitted && (!running || !synced || !receiver.outputReady || Math.abs(receiver.syncInfo.outputLatencyMs - latency) > 10)) invalidate(running && synced);
      if (admitted || preparing || failures >= 3 || !running || !synced || now() < nextAttempt) return;
      preparing = true;
      const attempt = epoch;
      try {
        await receiver.prepareAudio({ codec: "opus", sample_rate: 48000, channels: 2, bit_depth: 16 });
        if (closed || attempt !== epoch || !active() || receiver.outputState !== "running" || !receiver.outputReady || !synchronized()) return;
        latency = receiver.syncInfo.outputLatencyMs;
        receiver.setMinBufferMs(25);
        receiver.setRequiredLeadTimeMs(Math.max(25, Math.ceil(latency) + 10));
        admitted = true; failures = 0;
      } catch { if (attempt === epoch) failures++; /* Three attempts per stable route; suspension or route/clock recovery permits retry. */ }
      finally { preparing = false; nextAttempt = now() + 2000; }
    },
    outputChanged() { if (!closed) invalidate(true); },
    close() { closed = true; epoch++; },
  };
}
