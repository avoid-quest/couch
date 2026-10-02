import { useState } from "react";
import { Monitor, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { DeviceIcon, signalOf } from "@/components/DeviceIcon";
import { RangeControl } from "@/components/RangeControl";
import { cn } from "@/lib/utils";
import { deviceName } from "@/copy";
import { deviceId, type playsOn } from "@/session/device-id";
import { isTvPresentation } from "@/session/native-context";
import type { ClientSessionState } from "@/session/session";
import type { Action, DeviceSummary, PlaybackSummary } from "../../../shared/protocol";

type State = ClientSessionState | null | undefined;
const served = (state: State, id: string) => state?.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === id));

const statusText: Partial<Record<PlaybackSummary["status"], string>> = { loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };

/**
 * What a Device is doing: its Playback's title, "with {name}" when it joins another Device's Playback,
 * Idle or Offline. Beside `current` (the Playback in view), another Playback reads its status and
 * title ("Paused {title}") and the one in view only its status, as its title is already on screen.
 */
function doing(state: State, device: DeviceSummary, current?: string | null) {
  if (!device.online) return "Offline";
  const playback = served(state, device.id);
  if (!playback) return "Idle";
  const verb = statusText[playback.status];
  if (current && playback.id !== current) return verb ? `${verb} ${playback.title ?? "something else"}` : "Idle";
  // A Playback belongs to the Device showing its picture, else to its first Device.
  const lead = (playback.outputs.find(output => output.picture) ?? playback.outputs[0])!.deviceId;
  const leader = lead !== device.id && state?.devices?.find(item => item.id === lead);
  return leader ? `with ${leader.name}` : current ? verb ?? "Idle" : playback.title ?? "Playing";
}

type Props = { state: ClientSessionState; run: (action: Action) => Promise<boolean> };
// Pressed toggles invert, like focus: the default muted pressed state is nearly invisible on Clock's black.
const inverts = "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";

/**
 * Where it plays: the band's mixer button opens the Mixer, one channel strip per Device. The fader is the
 * Device's one volume while its sound is in, else 0; 0 takes the sound out and raising it puts the sound in.
 * Sound on several Devices plays in sync over Sendspin.
 */
export function WhereItPlays({ state, run, className }: Props & { className?: string }) {
  const outputs = state.outputs ?? [];
  const title = state.queue.find(entry => entry.id === state.currentEntryId)?.title;
  const output = (id: string) => outputs.find(item => item.deviceId === id);
  const here = deviceId();
  // The Playback's Devices first, then the other online ones that share; an offline Device, or this one
  // when it shares nothing (a remote), only while it is an output.
  const devices = (state.devices ?? []).filter(device => output(device.id) || device.online && (device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(!!output(b.id)) - Number(!!output(a.id)));
  const trim = state.mixTrim ?? 100;
  const playback = state.playbacks?.find(item => item.id === state.playback);
  // An mpv channel plays only on the server's own Device, its one output.
  const host = playback?.hostOnly ? state.devices?.find(device => device.id === outputs[0]?.deviceId)?.name ?? deviceName(state.installationName) : undefined;
  return <Sheet>
    {/* A mixer, not a device icon: device icons stand for devices (the header's switch, the strips), and this opens them all. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85dvh] gap-4 overflow-y-auto px-(--gutter) pb-6">
      <SheetHeader className="gap-0.5 px-0 pr-8 pb-0"><SheetTitle>Where it plays</SheetTitle><SheetDescription className="truncate">{title ?? "Nothing is playing."}</SheetDescription></SheetHeader>
      <p className="text-xs text-muted-foreground">{host ? `This channel plays only on ${host}.` : <>{isTvPresentation() ? "Press OK on a device fader, then raise it to play the sound there too." : "Raise a device fader to play the sound there too."} At 0 that device's sound is off. All trims active sound together.</>}</p>
      <div className="flex border-y">
      {/* All, pinned first like a console's master, attenuates only this Playback's selected sound. */}
      <div className="grid w-32 shrink-0 content-start justify-items-center gap-2 border-r px-2 py-3">
        <span aria-hidden="true" className="h-8 touch:h-11" />
        <span className="text-xl font-medium tabular-nums">{Math.round(trim)}</span>
        <div className="h-40"><RangeControl orientation="vertical" label="All trim" value={trim} max={100} disabled={!state.playback} onCommit={level => run({ type: "allSpeakers", level })} /></div>
        <span className="grid w-full justify-items-center gap-0.5 text-center"><span className="text-sm">All</span><span className="text-xs text-muted-foreground">Active sound</span></span>
      </div>
      <div className="flex min-w-0 flex-1 divide-x overflow-x-auto">
        {devices.map(device => {
          const current = output(device.id);
          // This Device controls its own strip while it plays here, as Play on → This device chose.
          const mine = device.id === here && !!current;
          const audio = mine || device.sharing?.audio === true, video = mine || device.sharing?.video === true;
          const sound = !!current?.sound, locked = !!host && !current;
          const only = outputs.length > 0 && outputs.every(item => item.deviceId === device.id);
          const status = doing(state, device, state.playback);
          // Devices outside the Playback are dimmed, and still fully operable unless it plays only on the host.
          return <div key={device.id} className={cn("grid w-32 shrink-0 content-start justify-items-center gap-2 px-2 py-3", !current && "text-muted-foreground")}>
            <Toggle variant="outline" pressed={!!current?.picture && !playback?.audioOnly} disabled={!video || locked || playback?.audioOnly} aria-label={`${device.name} picture`} onPressedChange={picture => void run({ type: "output", deviceId: device.id, picture })} className={cn("w-full", inverts)}><Monitor aria-hidden="true" />Picture</Toggle>
            <span className="text-xl font-medium tabular-nums">{sound ? Math.round(device.volume) : "–"}</span>
            <div className="h-40"><RangeControl orientation="vertical" label={`${device.name} volume`} value={sound ? device.volume : 0} max={100} disabled={!audio || locked} onCommit={level => run({ type: "output", deviceId: device.id, level })} /></div>
            <span className="grid w-full justify-items-center gap-0.5 text-center">
              <span className="flex max-w-full items-center gap-1.5"><DeviceIcon {...signalOf(state, device.id)} /><span className="truncate text-sm" title={device.name}>{device.name}</span></span>
              <span className="w-full truncate text-xs text-muted-foreground" title={status}>{status}</span>
            </span>
            <div className="grid w-full grid-cols-2 gap-1">
              <Toggle variant="outline" pressed={only} disabled={!device.online || locked || !audio && !video} aria-label={`Solo ${device.name}`} onPressedChange={() => { if (!only) void run({ type: "solo", deviceId: device.id }); }} className={inverts}>Solo</Toggle>
              <Toggle variant="outline" pressed={device.muted} disabled={!audio} aria-label={`Mute ${device.name}`} onPressedChange={muted => void run({ type: "mute", deviceId: device.id, muted })} className={inverts}>Mute</Toggle>
            </div>
            {audio && sound && current?.delay !== undefined && <Delay name={device.name} delay={current.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
          </div>;
        })}
      </div>
      </div>
    </SheetContent>
  </Sheet>;
}

/** "on {name} +N", plain text: where the controlled Playback plays when that isn't only this Device. */
export function PlaysOn({ at }: { at: NonNullable<ReturnType<typeof playsOn>> }) {
  return <span className="flex min-w-0 gap-1"><span className="truncate">on {at.name}</span>{!!at.more && <span className="shrink-0">+{at.more}</span>}</span>;
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up: Sendspin's
// static delay. It reads "Earlier", because "Delay" suggested the opposite (#644 ticket 12).
// It shows its own value while focused, so arrow keys keep stepping from it.
function Delay({ name, delay, onCommit }: { name: string; delay: number; onCommit: (delay: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  return <div className="grid w-full gap-1 text-center">
    <span className="text-xs text-muted-foreground tabular-nums">Earlier {value} ms</span>
    <Slider aria-label={`${name} earlier`} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
