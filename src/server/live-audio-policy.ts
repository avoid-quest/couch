// Keep capture deadlines and both receiver/correction gates on the same budget.
import { defaultLiveAudioLeadMs, isLiveAudioLead } from "../shared/audio-settings";

export const liveAudioLeadMs = defaultLiveAudioLeadMs;
const sourceReserveMs = 25;
export const liveOutputBudgetMs = liveAudioLeadMs - sourceReserveMs;
export function liveOutputBudget(leadMs = liveAudioLeadMs) {
  if (!isLiveAudioLead(leadMs)) throw new Error("Choose a supported live audio scheduling lead.");
  // The explicit low-latency presets use the 8 ms source reserve exercised by
  // the native-capture electrical comparisons. Slower capture needs a longer
  // preset; deadlines never move to accommodate it. Default remains 95 / 70 ms.
  return leadMs - (leadMs <= 55 ? 8 : sourceReserveMs);
}
