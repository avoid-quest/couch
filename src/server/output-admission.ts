import type { SendspinSession } from "@sonn-audio/node-sendspin";
import type { AudioAdmissionFailure, OutputAdmission } from "../shared/protocol";
import { liveOutputBudgetMs } from "./live-audio-policy";

/** Preparation and the fixed live budget are separate facts. Never infer one from timing. */
export function liveOutputAdmission(session: SendspinSession | undefined, wire: string | undefined, receiverId?: string, budgetMs = liveOutputBudgetMs): OutputAdmission {
  if (!session) return { state: "preparing" };
  const preparation = session.getOutputPreparation();
  if (receiverId && preparation?.receiverId !== receiverId) return { state: "preparing" };
  const failed = (reason: AudioAdmissionFailure, error: string): OutputAdmission => ({ state: "failed", reason, error });
  if (wire !== "opus" && wire !== "pcm") return failed("format", "Live audio needs stereo 48 kHz Opus or PCM16. Use relaxed sharing.");
  const capacity = session.getPlayerBufferCapacity();
  const minimumCapacity = wire === "pcm" ? 65536 : 4096;
  if (capacity < minimumCapacity) return failed("capacity", `This output has ${capacity} bytes of audio buffer; live ${wire} requires ${minimumCapacity}. Use relaxed sharing.`);
  if (receiverId) {
    if (preparation!.state === "preparing") return { state: "preparing" };
    if (preparation!.state === "failed") return failed("preparation", `Audio output preparation failed: ${preparation!.error} Check this device's audio output or use relaxed sharing.`);
  }
  const { requiredLeadTimeMs: lead, minBufferMs: buffer, staticDelayMs: delay } = session.getPlayerTiming();
  if (lead === undefined || buffer === undefined) return failed("timing-missing", "This output has not declared its audio timing. Use relaxed sharing.");
  if (lead > budgetMs) return failed("required-lead", `This output requires ${lead} ms; the live audio deadline allows ${budgetMs} ms. Use relaxed sharing.`);
  if (buffer > budgetMs) return failed("minimum-buffer", `This output requires a ${buffer} ms buffer; live audio allows ${budgetMs} ms. Use relaxed sharing.`);
  if (lead + Math.max(0, delay ?? 0) > budgetMs) return failed("output-correction", `This output's lead and correction require ${lead + Math.max(0, delay ?? 0)} ms; the live audio deadline allows ${budgetMs} ms. Use relaxed sharing.`);
  return { state: "ready" };
}
