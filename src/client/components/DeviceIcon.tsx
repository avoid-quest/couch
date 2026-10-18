import { Monitor, MonitorSpeaker, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionState } from "../../shared/protocol";

/** What a Device renders: its Output in the Playback it serves, its one volume and mute, and whether it is online. */
export type Signal = { picture: boolean; sound: boolean; volume: number; muted: boolean; online: boolean };

/** The Signal of a Device in `state`: its Output in whichever Playback it serves, if any, with no picture or sound for media that has none. */
export function signalOf(state: Pick<SessionState, "devices" | "playbacks" | "outputs" | "liveSources"> | null | undefined, deviceId: string): Signal {
  const device = state?.devices?.find(item => item.id === deviceId);
  const playback = state?.playbacks?.find(item => item.outputs.some(output => output.deviceId === deviceId));
  const output = playback?.outputs.find(item => item.deviceId === deviceId) ?? state?.outputs?.find(item => item.deviceId === deviceId);
  const silent = state?.liveSources?.find(source => source.id === playback?.liveSourceId)?.audio === false;
  return { picture: !!output?.picture && !playback?.audioOnly, sound: !!output?.sound && !silent, volume: device?.volume ?? 0, muted: !!device?.muted, online: !!device?.online };
}

/**
 * The icon beside a device's name, familiar like Spotify's device picker: a screen with a speaker for
 * picture and sound, a screen for picture, a speaker whose waves follow its volume for sound, crossed out
 * while muted. An idle device shows a plain screen, muted; offline, dimmer still.
 */
export function DeviceIcon({ picture, sound, volume, muted, online, className }: Signal & { className?: string }) {
  const Icon = sound && muted ? VolumeX : picture && sound ? MonitorSpeaker : picture ? Monitor : sound ? volume <= 0 ? Volume : volume <= 50 ? Volume1 : Volume2 : Monitor;
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", !online ? "text-muted-foreground opacity-50" : !picture && !sound && "text-muted-foreground", className)} />;
}
