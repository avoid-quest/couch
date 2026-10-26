import { AppWindow, AudioLines, Mic, Monitor, type LucideIcon } from "lucide-react";
import type { ClientSessionState } from "@/session/session";
import type { LiveRoute } from "@/session/live-route";
import type { CaptureKind, CaptureSource } from "../../../shared/capture";
import type { LiveSelection, LiveVideoQuality } from "../../../shared/live-input";
import type { DeviceSummary, PlaybackSummary } from "../../../shared/protocol";

// What this device can share, in the order the Share dialog offers it (docs/design/share.md). Each kind says how it
// captures; the dialog and the capsule read only these fields, so a new kind (a specific sound card, say) is one more entry.
export type ShareKind = {
  id: string;
  label: string;
  icon: LucideIcon;
  capture: CaptureKind;
  /** It shares a picture, chosen from the desktop app's screens or windows; a browser's own picker opens on that surface. */
  pictures?: CaptureSource["kind"];
  /** It chooses an audio input: a microphone or an audio interface. */
  inputs?: boolean;
  intent?: "live";
};

export const shareKinds: ShareKind[] = [
  { id: "screen", label: "Screen", icon: Monitor, capture: "screen", pictures: "screen" },
  { id: "window", label: "Window", icon: AppWindow, capture: "screen", pictures: "window" },
  { id: "sound", label: "Sound only", icon: AudioLines, capture: "system-audio" },
  { id: "microphone", label: "Audio input", icon: Mic, capture: "microphone", inputs: true },
  { id: "live-audio", label: "Live audio", icon: AudioLines, capture: "microphone", inputs: true, intent: "live" },
];

/** The kind a running share was started as, by how it captures. */
export const shareKindOf = (capture: CaptureKind, surface?: LiveSelection["surface"], intent?: "relaxed" | "live") =>
  intent === "live" ? shareKinds.find(kind => kind.intent === "live")! : shareKinds.find(kind => !kind.intent && kind.capture === capture && (!kind.pictures || kind.pictures === (surface === "window" ? "window" : "screen"))) ?? shareKinds[0]!;

export const qualityLabels: Record<LiveVideoQuality, string> = { "720p": "720p, less bandwidth", "1080p": "1080p, balanced", original: "Original resolution" };

/** Why this browser can't share a kind, in today's words; nothing when it can. */
export function unavailable(kind: ShareKind, browser: { media: boolean; display: boolean }) {
  if (!browser.media) return "Open Couch over HTTPS or on localhost to share this device.";
  if (kind.capture !== "microphone" && !browser.display) return "This browser can share audio inputs. Use the desktop app to share a screen or system audio.";
}

/**
 * The capture a choice asks for. In the desktop app a picture is the chosen screen or window, and Sound only takes
 * the first screen's capture for its sound, keeping the picture private; a browser opens its own picker.
 */
export function selectionOf(kind: ShareKind, choice: { source?: CaptureSource; sources?: CaptureSource[]; audioDeviceId?: string; quality: LiveVideoQuality; sound: boolean }): LiveSelection {
  const source = kind.pictures ? choice.source : choice.sources?.find(item => item.kind === "screen");
  return {
    kind: kind.capture,
    ...kind.intent ? { intent: kind.intent } : {},
    ...kind.capture !== "microphone" && source ? { sourceId: source.id } : {},
    ...kind.pictures ? { videoQuality: choice.quality, includeAudio: choice.sound, surface: kind.pictures === "screen" ? "monitor" as const : "window" as const } : {},
    ...kind.inputs && choice.audioDeviceId && choice.audioDeviceId !== "default" ? { audioDeviceId: choice.audioDeviceId } : {},
  };
}

/** Play on's devices for a share: every other online device that lets others use its screen or speakers. */
export const shareTargets = (state: ClientSessionState | null | undefined, here: string) =>
  (state?.devices ?? []).filter(device => device.id !== here && device.online && (device.sharing?.audio || device.sharing?.video));

/** A device watching or hearing this device's share, and how it gets it. */
export type Viewer = { device: DeviceSummary; picture: boolean; sound: boolean; playing: boolean; behind: boolean; delivery?: PlaybackSummary["delivery"]; delayActive?: boolean; error?: string };
/** Every online device the share plays on, in each playback that plays it; the publisher never plays its own (docs/live-inputs.md). */
export function viewersOf(state: ClientSessionState | null | undefined, sourceId: string): Viewer[] {
  const viewers = new Map<string, Viewer>();
  // A channel the capture lacks plays nothing there, as Where it plays counts it.
  const source = state?.liveSources?.find(item => item.id === sourceId);
  for (const playback of state?.playbacks ?? []) if (playback.liveSourceId === sourceId) for (const output of playback.outputs) {
    const device = state?.devices?.find(item => item.id === output.deviceId);
    const picture = output.picture && source?.video !== false, sound = output.sound && source?.audio !== false;
    // An offline device keeps its output in the playback (Where it plays says Offline) but watches nothing.
    if (device?.online && (picture || sound)) viewers.set(device.id, { device, picture, sound, playing: playback.status === "playing", behind: !!output.buffered, delivery: playback.delivery, delayActive: output.delayActive, error: output.error });
  }
  return [...viewers.values()];
}

/**
 * What a viewer's row says under its name: its channels and its route on the sharer's own panel, where every row names
 * it (docs/design/share.md); Behind and Can't play as Where it plays says them.
 */
export function viewerLine(viewer: Viewer, route: LiveRoute | undefined) {
  if (viewer.error) return `Can't play: ${viewer.error}`;
  const channels = viewer.picture && viewer.sound ? "Picture and sound" : viewer.picture ? "Picture" : "Sound";
  if (viewer.behind) return `${channels}, behind`;
  // Core's delivery wins over absent or stale WebRTC candidate statistics.
  if (viewer.delivery === "scheduled") return viewer.sound ? `${channels}, ${viewer.delayActive ? "in sync" : "connecting"}` : channels;
  if (viewer.delivery && viewer.delivery !== "webrtc") return channels;
  return route ? `${channels}, ${route === "relay" ? "through the relay" : "direct"}` : channels;
}
