import type { LiveSource } from "./live-input";
import type { Action, Output, PlaybackControls, PlaybackSummary } from "./protocol";

// Delivery is a Core decision. A split picture/speaker needs a clock even with
// one speaker; timestamped captures retain their deadlines with one receiver.
export function playbackDelivery({ source, outputs, inSync, mpv }: { source?: LiveSource; outputs: Pick<Output, "deviceId" | "picture" | "sound">[]; inSync?: boolean; mpv?: boolean }): NonNullable<PlaybackSummary["delivery"]> {
  if (mpv) return "mpv";
  if (source?.intent === "live" || source?.audioDelivery === "pcm" && !source.video) return "scheduled";
  const spans = new Set(outputs.filter(output => output.picture || output.sound).map(output => output.deviceId)).size > 1;
  if (source) return spans && inSync ? "scheduled" : "webrtc";
  return spans ? "scheduled" : "direct";
}

export function playbackControls({ intent, authorized, receiving, scheduled, mpv, capture, seekable, audioDelay }: { intent?: "relaxed" | "live"; authorized: boolean; receiving: boolean; scheduled?: boolean; mpv?: boolean; capture?: boolean; seekable?: boolean; audioDelay?: number }): PlaybackControls {
  const programme = authorized && intent !== "live";
  return { programme, queue: programme, seek: programme && !!seekable, speed: programme && !capture,
    audioDelay: programme && audioDelay !== undefined && !scheduled && !mpv && !capture, subtitleDelay: programme && !mpv && (!capture || !!scheduled), leave: receiving };
}

// Explicit device level/mute and local participation are separate from programme
// authority. Unrecognised/legacy programme actions do not gain live authority.
export function playbackActionAllowed(action: Action, controls: PlaybackControls) {
  switch (action.type) {
    case "leave": return controls.leave;
    case "volume": case "mute": return !!action.deviceId || controls.programme;
    case "output": return true; // Hub authorizes the requested device/channels.
    case "seek": return controls.seek;
    case "speed": return controls.speed;
    case "audioDelay": return controls.audioDelay;
    case "subtitleDelay": return controls.subtitleDelay;
    case "enqueue": case "enqueueWeb": case "enqueueProvider": case "enqueueRadio":
    case "remove": case "restoreRemoved": case "move": case "play": return controls.queue;
    default: return controls.programme;
  }
}
