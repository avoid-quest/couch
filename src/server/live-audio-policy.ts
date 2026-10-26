// The host chooses the lead. What each receiver has left of it is measured per
// source and wire (scheduled-capture), never assumed.
import { defaultLiveAudioLeadMs, isLiveAudioLead } from "../shared/audio-settings";

export const liveAudioLeadMs = defaultLiveAudioLeadMs;
export function requireLiveAudioLead(leadMs = liveAudioLeadMs) {
  if (!isLiveAudioLead(leadMs)) throw new Error("Choose a supported live audio scheduling lead.");
  return leadMs;
}
