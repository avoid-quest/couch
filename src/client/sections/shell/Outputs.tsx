import { Fragment, useState } from "react";
import { Monitor, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
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

const statusText: Record<PlaybackSummary["status"], string> = { unavailable: "Unavailable", idle: "Not playing here", loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };

/**
 * Status describes playback, never audibility. A busy device names the other playback before a move.
 */
export function outputStatus(state: State, device: DeviceSummary, current?: string | null) {
  if (!device.online) return "Offline";
  const playback = served(state, device.id);
  if (!playback) return "Not playing here";
  const verb = statusText[playback.status];
  return current && playback.id !== current ? `${verb} ${playback.title ?? "something else"}` : verb;
}

type Props = { state: ClientSessionState; run: (action: Action) => Promise<boolean> };
// Pressed toggles invert, like focus: the default muted pressed state is nearly invisible on Clock's black.
const inverts = "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";

/**
 * Where it plays: one Sheet of divided device rows. The fader is the
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
  const source = state.liveSources?.find(item => item.id === playback?.liveSourceId);
  // An mpv channel plays only on the server's own Device, its one output.
  const host = playback?.hostOnly ? state.devices?.find(device => device.id === outputs[0]?.deviceId)?.name ?? deviceName(state.installationName) : undefined;
  return <Sheet>
    {/* Device icons stand for individual devices; the mixer opens all output rows. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85dvh] scroll-py-6 gap-4 overflow-y-auto px-(--gutter) pb-6 [&_[data-slot=slider]]:min-h-11 [&_[data-slot=toggle]]:min-h-11 [&>[data-slot=sheet-close]]:min-h-11 [&>[data-slot=sheet-close]]:min-w-11">
      <SheetHeader className="shrink-0 gap-0.5 px-0 pr-12 pb-0"><SheetTitle>Where it plays</SheetTitle><SheetDescription className="[overflow-wrap:anywhere]">{title ?? "Nothing is playing."}</SheetDescription></SheetHeader>
      <p className="shrink-0 text-sm text-muted-foreground">{host ? `This channel plays only on ${host}.` : source?.audio === false ? "This source has no sound. Enable Picture on devices to watch it." : <>Raise a device level to add its sound; at 0 its sound is off. All trims selected sound you can control and keeps device levels.{isTvPresentation() && " Press OK to adjust a level, then OK or Back to finish."}</>}</p>
      <ItemGroup className="shrink-0 gap-0 border-y">
      {/* The same All command and stored trim; this row never recruits devices. */}
      <Item role="listitem" className="grid grid-cols-1 gap-2 rounded-none border-0 px-0 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-x-6">
        <div><p className="text-base font-medium">All</p><p className="text-sm text-muted-foreground">Selected sound you can control</p></div>
        <div data-volume className="flex min-h-11 min-w-0 items-center gap-3 md:col-span-2">
          <RangeControl label="All trim" value={trim} max={100} disabled={!state.playback} keyboardStep={isTvPresentation() ? 5 : 1} onCommit={level => run({ type: "allSpeakers", level })} />
          <span className="w-[3ch] shrink-0 text-right tabular-nums">{Math.round(trim)}</span>
        </div>
      </Item>
        {devices.map(device => {
          const current = output(device.id);
          // Ownership permits local controls even while viewing another playback.
          const mine = device.id === here;
          const feedback = source?.deviceId === device.id && source.kind !== "microphone";
          const audio = source?.audio !== false && !feedback && (mine || device.sharing?.audio === true), video = mine || device.sharing?.video === true;
          const sound = !!current?.sound, locked = !device.online || !!host && !current;
          const occupied = served(state, device.id), channel = occupied?.outputs.find(item => item.deviceId === device.id);
          const privatePicture = !!channel?.picture && device.sharing?.video !== true;
          const privateSound = !!channel?.sound && device.sharing?.audio !== true;
          const privateOutput = privatePicture || privateSound;
          const protectedElsewhere = occupied?.id !== state.playback && privateOutput && !mine;
          const canSolo = !locked && (audio || video && !playback?.audioOnly) && (!privateOutput || mine);
          const only = outputs.length > 0 && outputs.every(item => item.deviceId === device.id);
          const status = outputStatus(state, device, state.playback);
          // Unselected shared devices stay operable, unless moving them would replace a private channel.
          return <Fragment key={device.id}><ItemSeparator className="my-0" /><Item role="listitem" className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-0 px-0 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-x-6", (!current || !device.online) && "text-muted-foreground")}>
            <div className="min-w-0">
              <p className="flex items-start gap-2 text-base font-medium"><DeviceIcon {...signalOf(state, device.id)} className="mt-1" /><span data-output-name className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span></p>
              <p data-output-status className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{status}</p>
              {feedback && <p className="text-sm text-muted-foreground">Sound is off on the sharing device to prevent feedback.</p>}
              {privateOutput && <p className="text-sm text-muted-foreground">{privatePicture && privateSound ? "Private" : privatePicture ? "Private picture" : "Private sound"}. {mine ? "Only you can change it." : "Only this device can change it."}</p>}
            </div>
            <Toggle variant="outline" pressed={only} disabled={!canSolo} aria-label={`Solo ${device.name}`} onPressedChange={() => { if (!only) void run({ type: "solo", deviceId: device.id }); }} className={cn("md:col-start-3 md:row-start-1", inverts)}>Solo</Toggle>
            <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <Toggle variant="outline" pressed={!!current?.picture && !playback?.audioOnly} disabled={!video || locked || protectedElsewhere || playback?.audioOnly} aria-label={`${device.name} picture`} onPressedChange={picture => void run({ type: "output", deviceId: device.id, picture })} className={cn("shrink-0", inverts)}><Monitor aria-hidden="true" />Picture</Toggle>
                <div data-volume className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <RangeControl label={`${device.name} volume`} value={sound ? device.volume : 0} max={100} disabled={!audio || locked || protectedElsewhere} keyboardStep={isTvPresentation() ? 5 : 1} onCommit={level => run({ type: "output", deviceId: device.id, level })} />
                  <span className="w-[3ch] shrink-0 text-right tabular-nums">{sound ? Math.round(device.volume) : "–"}</span>
                </div>
                <Toggle variant="outline" pressed={device.muted} disabled={!audio || locked} aria-label={`Mute ${device.name}`} onPressedChange={muted => void run({ type: "mute", deviceId: device.id, muted })} className={cn("shrink-0", inverts)}>Mute</Toggle>
              </div>
              {audio && sound && current?.delay !== undefined && !locked && <Delay name={device.name} delay={current.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
            </div>
          </Item></Fragment>;
        })}
        {!devices.length && <p className="py-4 text-sm text-muted-foreground">No outputs selected. Share sound or picture on a device to add it here, or choose Play on → This device.</p>}
      </ItemGroup>
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
  return <div data-volume className="grid w-full gap-1 pt-2">
    <span className="text-sm text-muted-foreground tabular-nums">Earlier {value} ms</span>
    <Slider aria-label={`${name} earlier`} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
