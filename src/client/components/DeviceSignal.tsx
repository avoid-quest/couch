import { cn } from "@/lib/utils";
import type { SessionState } from "../../shared/protocol";

/** What a Device renders: its Output in the Playback it serves, its one volume and mute, and whether it is online. */
export type Signal = { picture: boolean; sound: boolean; volume: number; muted: boolean; online: boolean };

/** The Signal of a Device in `state`: its Output in whichever Playback it serves, if any. */
export function signalOf(state: Pick<SessionState, "devices" | "playbacks" | "outputs"> | null | undefined, deviceId: string): Signal {
  const device = state?.devices?.find(item => item.id === deviceId);
  const output = [...state?.playbacks?.flatMap(playback => playback.outputs) ?? [], ...state?.outputs ?? []].find(item => item.deviceId === deviceId);
  return { picture: !!output?.picture, sound: !!output?.sound, volume: device?.volume ?? 0, muted: !!device?.muted, online: !!device?.online };
}

/**
 * Two thin bars beside a device's name: picture on the left (solid while it shows it), sound on the
 * right as a meter filled to its volume (dimmed while muted, empty while out of the sound).
 * Offline, both are dashed and dim.
 */
export function DeviceSignal({ picture, sound, volume, muted, online, className }: Signal & { className?: string }) {
  const bar = cn("h-full w-1 rounded-[1px] border", !online && "border-dashed border-current");
  return <span aria-hidden="true" className={cn("inline-flex h-3.5 shrink-0 gap-0.5", !online && "text-muted-foreground", className)}>
    <span className={cn(bar, picture && "border-current bg-current")} />
    {/* The fill covers the outline too, so a full meter is as wide as a shown picture. */}
    <span className="relative h-full w-1">
      <span className={cn(bar, "absolute inset-0")} />
      <span className={cn("absolute inset-x-0 bottom-0 rounded-[1px] bg-current transition-[height] duration-150 motion-reduce:transition-none", muted && "opacity-35")} style={{ height: `${sound ? Math.min(100, Math.max(0, volume)) : 0}%` }} />
    </span>
  </span>;
}
