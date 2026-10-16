import { Fragment, useContext, useState, type ReactNode } from "react";
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
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
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
  // The publisher controls its capture and never plays it (docs/live-inputs.md).
  const viewed = state?.playbacks?.find(playback => playback.id === current);
  if (state?.liveSources?.some(source => source.id === viewed?.liveSourceId && source.deviceId === device.id)) return "Sharing this source";
  const playback = served(state, device.id);
  if (!playback) return "Not playing here";
  const verb = statusText[playback.status];
  return current && playback.id !== current ? `${verb} ${playback.title ?? "something else"}` : verb;
}

/** A request to choose where a shared source plays: its playback and Core's count of requests. */
export const chooserRequest = (state: ClientSessionState) => { const playback = state.playbacks?.find(item => item.id === state.playback); return playback?.choosing ? `${playback.id}:${playback.choosing}` : null; };
/** Where it plays opens for each new request and otherwise stays as the user left it. */
export const reopens = (dismissed: string | null, request: string | null) => !!request && request !== dismissed;
/**
 * Play on a source's publisher, explicit or as primary Play's destination, while the source already plays:
 * Core keeps that playback, and only the requesting window opens its Where it plays. A waiting one asks Core.
 */
export const choosesHere = (action: Action, before: ClientSessionState | null, after: ClientSessionState | null) => action.type === "playLive" && action.playNow !== false && !!after && !chooserRequest(after)
  && after.playbacks?.find(item => item.id === after.playback)?.liveSourceId === action.sourceId
  && after.liveSources?.find(source => source.id === action.sourceId)?.deviceId === (action.deviceId ?? before?.controlling);

// Radix Dialog's controlled open state: a changed defaultOpen would not open a mounted Sheet. The
// session remembers the closed request, so the now-playing bar and Now Playing each open it at most once.
// Core's request opens every window viewing the playback; this window's own request opens only here.
function ChooserSheet({ request, playback, children }: { request: string | null; playback: string | null; children: ReactNode }) {
  const gate = useContext(SessionGateContext);
  const [opened, setOpened] = useState(false);
  const requested = request ?? (playback && gate?.requestedChooser?.startsWith(`${playback}:`) ? gate.requestedChooser : null);
  const open = opened || reopens(gate?.dismissedChooser ?? null, requested);
  return <Sheet open={open} onOpenChange={next => { setOpened(next); if (!next && requested) gate?.dismissChooser(requested); }}>{children}</Sheet>;
}

type Props = { state: ClientSessionState; run: (action: Action) => Promise<boolean> };
// Pressed toggles invert, like focus: the default muted pressed state is nearly invisible on Clock's black.
const inverts = "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";

/**
 * Where it plays: one Sheet of divided device rows. The fader is the
 * Device's one volume while its sound is in, else 0; 0 takes the sound out and raising it puts the sound in.
 * Sound on several Devices plays in sync over Sendspin. Each request to choose a shared source's
 * receivers opens it, so Play on the publisher leads here.
 */
export function WhereItPlays({ state, run, className }: Props & { className?: string }) {
  const outputs = state.outputs ?? [];
  const title = state.queue.find(entry => entry.id === state.currentEntryId)?.title;
  const output = (id: string) => outputs.find(item => item.deviceId === id);
  const here = deviceId();
  const playback = state.playbacks?.find(item => item.id === state.playback);
  const source = state.liveSources?.find(item => item.id === playback?.liveSourceId);
  // The Playback's Devices first, then this one and the other online ones that share, and a source's
  // publisher; an offline Device only while it is an output.
  const devices = (state.devices ?? []).filter(device => output(device.id) || device.id === source?.deviceId || device.online && (device.id === here || device.sharing?.audio || device.sharing?.video)).sort((a, b) => Number(!!output(b.id)) - Number(!!output(a.id)));
  // Only here is exclusive, so another device's private output in this playback, or a held publisher's
  // that returns after its source, makes it unavailable.
  const sharingOf = (id: string) => state.devices?.find(device => device.id === id)?.sharing;
  const privately = [...outputs, ...playback?.held ? [playback.held] : []].filter(item => item.deviceId !== here && (item.picture && sharingOf(item.deviceId)?.video !== true || item.sound && sharingOf(item.deviceId)?.audio !== true));
  const trim = state.mixTrim ?? 100;
  const waiting = !!source && !outputs.length;
  // An mpv channel plays only on the server's own Device, its one output.
  const host = playback?.hostOnly ? state.devices?.find(device => device.id === outputs[0]?.deviceId)?.name ?? deviceName(state.installationName) : undefined;
  return <ChooserSheet key={state.playback} request={chooserRequest(state)} playback={state.playback ?? null}>
    {/* Device icons stand for individual devices; the mixer opens all output rows. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85dvh] scroll-py-6 gap-4 overflow-y-auto px-(--gutter) pb-6 [&_[data-slot=slider]]:min-h-11 [&_[data-slot=toggle]]:min-h-11 [&>[data-slot=sheet-close]]:min-h-11 [&>[data-slot=sheet-close]]:min-w-11">
      <SheetHeader className="shrink-0 gap-0.5 px-0 pr-12 pb-0"><SheetTitle>Where it plays</SheetTitle><SheetDescription className="[overflow-wrap:anywhere]">{title ?? "Nothing is playing."}</SheetDescription></SheetHeader>
      <p className="shrink-0 text-sm text-muted-foreground">{host ? `This channel plays only on ${host}.` : waiting ? "Choose where this source plays: raise a level or turn on Picture." : source?.audio === false ? "This source has no sound. Enable Picture on devices to watch it." : <>Raise a device level to add its sound; at 0 its sound is off. All trims selected sound you can control and keeps device levels.{isTvPresentation() && " Press OK to adjust a level, then OK or Back to finish."}</>}</p>
      <ItemGroup className="shrink-0 gap-0 border-y">
      {/* The same All command and stored trim; this row never recruits devices. */}
      <Item role="listitem" className="grid grid-cols-1 gap-2 rounded-none border-0 px-0 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-x-6">
        <div><p className="text-base font-medium">All</p><p className="text-sm text-muted-foreground">Selected sound you can control</p></div>
        <div data-volume className="flex min-h-11 min-w-0 items-center gap-3 md:col-span-2">
          <RangeControl label="All trim" value={trim} max={100} disabled={!state.playback} keyboardStep={isTvPresentation() ? 5 : 1} onCommit={level => run({ type: "allSpeakers", level })} />
          <span className="w-[3ch] shrink-0 text-right tabular-nums">{Math.round(trim)}</span>
        </div>
      </Item>
      {/* A live input plays directly on each device unless In sync is chosen (docs/adr/0001). */}
      {source && (outputs.length > 1 || playback?.inSync) && <Item role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-0 border-t px-0 py-4 md:gap-x-6">
        <div><p className="text-base font-medium">In sync</p><p className="text-sm text-muted-foreground">{playback?.inSync ? "Devices play together, a few seconds behind the source." : "Each device plays as soon as it receives the source, so devices can be slightly apart."}</p></div>
        <Toggle variant="outline" pressed={!!playback?.inSync} aria-label="Play in sync" onPressedChange={inSync => void run({ type: "inSync", inSync })} className={inverts}>In sync</Toggle>
      </Item>}
        {devices.map(device => {
          const current = output(device.id);
          // Ownership permits local controls even while viewing another playback.
          const mine = device.id === here;
          const capturing = source?.deviceId === device.id;
          const speakers = mine || device.sharing?.audio === true;
          const audio = source?.audio !== false && !capturing && speakers, video = !capturing && (mine || device.sharing?.video === true);
          const sound = !!current?.sound, locked = !device.online || !!host && !current;
          // A held publisher's output is its place in that playback, here or elsewhere, as Core's replacement check counts it.
          const occupied = served(state, device.id) ?? state.playbacks?.find(item => item.held?.deviceId === device.id), channel = occupied?.outputs.find(item => item.deviceId === device.id) ?? occupied?.held;
          const privatePicture = !!channel?.picture && device.sharing?.video !== true;
          const privateSound = !!channel?.sound && device.sharing?.audio !== true;
          const privateOutput = privatePicture || privateSound;
          const protectedElsewhere = !!occupied && occupied.id !== state.playback && privateOutput && !mine;
          const canSolo = !locked && (audio || video && !playback?.audioOnly) && (!privateOutput || mine) && !privately.some(item => item.deviceId !== device.id);
          const only = outputs.length > 0 && outputs.every(item => item.deviceId === device.id);
          const status = outputStatus(state, device, state.playback);
          // Unselected shared devices stay operable, unless moving them would replace a private channel.
          return <Fragment key={device.id}><ItemSeparator className="my-0" /><Item role="listitem" className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-0 px-0 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-x-6", (!current || !device.online) && "text-muted-foreground")}>
            <div className="min-w-0">
              <p className="flex items-start gap-2 text-base font-medium"><DeviceIcon {...signalOf(state, device.id)} className="mt-1" /><span data-output-name className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span></p>
              <p data-output-status className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{status}</p>
              {capturing && <p className="text-sm text-muted-foreground">It plays on the devices you choose here.</p>}
              {current?.buffered && <p className="text-sm text-muted-foreground">Buffered: it couldn't connect directly to this source, so it plays a few seconds behind.</p>}
              {current?.error && <p className="text-sm text-destructive">It couldn't connect directly to this source, and Couch's buffered stream failed: {current.error}</p>}
              {privateOutput && <p className="text-sm text-muted-foreground">{privatePicture && privateSound ? "Private" : privatePicture ? "Private picture" : "Private sound"}. {mine ? "Only you can change it." : "Only this device can change it."}</p>}
            </div>
            {/* Pressed again it still commits: a publisher held out for its own capture would otherwise return. */}
            <Toggle variant="outline" pressed={only} disabled={!canSolo} aria-label={`Only on ${device.name}`} onPressedChange={() => void run({ type: "solo", deviceId: device.id })} className={cn("md:col-start-3 md:row-start-1", inverts)}>Only here</Toggle>
            <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <Toggle variant="outline" pressed={!!current?.picture && !playback?.audioOnly} disabled={!video || locked || protectedElsewhere || playback?.audioOnly} aria-label={`${device.name} picture`} onPressedChange={picture => void run({ type: "output", deviceId: device.id, picture })} className={cn("shrink-0", inverts)}><Monitor aria-hidden="true" />Picture</Toggle>
                <div data-volume className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <RangeControl label={`${device.name} volume`} value={sound ? device.volume : 0} max={100} disabled={!audio || locked || protectedElsewhere} keyboardStep={isTvPresentation() ? 5 : 1} onCommit={level => run({ type: "output", deviceId: device.id, level })} />
                  <span className="w-[3ch] shrink-0 text-right tabular-nums">{sound ? Math.round(device.volume) : "–"}</span>
                </div>
                <Toggle variant="outline" pressed={device.muted} disabled={!speakers || source?.audio === false || locked} aria-label={`Mute ${device.name}`} onPressedChange={muted => void run({ type: "mute", deviceId: device.id, muted })} className={cn("shrink-0", inverts)}>Mute</Toggle>
              </div>
              {audio && sound && !locked && (current?.delayActive ? <Delay name={device.name} delay={current.delay ?? 0} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />
                : <p className="pt-2 text-sm text-muted-foreground">{current?.delay ? `Sync ${current.delay} ms earlier. ` : ""}Sync adjustment applies when it plays together with other devices.</p>)}
            </div>
          </Item></Fragment>;
        })}
        {!devices.length && <p className="py-4 text-sm text-muted-foreground">No outputs selected. Allow other devices to use a device's speakers or screen to add it here, or choose Play on → This device.</p>}
      </ItemGroup>
    </SheetContent>
  </ChooserSheet>;
}

/** "on {name} +N", plain text: where the controlled Playback plays when that isn't only this Device. */
export function PlaysOn({ at }: { at: NonNullable<ReturnType<typeof playsOn>> }) {
  return <span className="flex min-w-0 gap-1"><span className="truncate">on {at.name}</span>{!!at.more && <span className="shrink-0">+{at.more}</span>}</span>;
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up with the other
// devices: Sendspin's static delay. It reads "earlier", because "Delay" suggested the opposite (#644 ticket 12),
// and "Sync" so it isn't mistaken for Playback's audio delay against the picture.
// It shows its own value while focused, so arrow keys keep stepping from it.
function Delay({ name, delay, onCommit }: { name: string; delay: number; onCommit: (delay: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  return <div data-volume className="grid w-full gap-1 pt-2">
    <span className="text-sm text-muted-foreground tabular-nums">Sync {value} ms earlier</span>
    <Slider aria-label={`${name} sync`} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
