import { Fragment, useContext, useState, type ReactNode } from "react";
import { Monitor, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { DeviceIcon, signalOf } from "@/components/DeviceIcon";
import { RangeControl } from "@/components/RangeControl";
import { PlaybackVolume } from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import { deviceId, type playsOn } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import { chooserFor, chooserRequest, picker, reopens } from "@/session/where-it-plays";
import type { Action } from "../../../shared/protocol";

// Radix Dialog's controlled open state: a changed defaultOpen would not open a mounted Sheet. The
// session remembers the closed request, so the now-playing bar and Now Playing each open it at most once.
// Core's request opens every window viewing the playback; this window's own request opens only here.
function ChooserSheet({ request, playback, children }: { request: string | null; playback: string | null; children: ReactNode }) {
  const gate = useContext(SessionGateContext);
  const [opened, setOpened] = useState(false);
  const requested = chooserFor(request, playback, gate?.requestedChooser);
  const open = opened || reopens(gate?.dismissedChooser ?? null, requested);
  return <Sheet open={open} onOpenChange={next => { setOpened(next); if (!next && requested) gate?.dismissChooser(requested); }}>{children}</Sheet>;
}

type Props = { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean> };
// Pressed toggles invert, like focus: the default muted pressed state is nearly invisible on Clock's black.
const inverts = "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background";

/**
 * Where it plays: one Sheet of divided device rows. The fader is the
 * Device's one volume while its sound is in, else 0; 0 takes the sound out and raising it puts the sound in.
 * Sound on several Devices plays in sync over Sendspin. Each request to choose a shared source's
 * receivers opens it, so Play on the publisher leads here.
 */
export function WhereItPlays({ state, connected, run, className }: Props & { className?: string }) {
  const tv = isTvPresentation();
  const { title, hint, inSync, rows } = picker(state, { here: deviceId(), tv });
  return <ChooserSheet key={state.playback} request={chooserRequest(state)} playback={state.playback ?? null}>
    {/* Device icons stand for individual devices; the mixer opens all output rows. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85dvh] scroll-py-6 gap-4 overflow-y-auto px-(--gutter) pb-6 [&_[data-slot=slider]]:min-h-11 [&_[data-slot=toggle]]:min-h-11 [&>[data-slot=sheet-close]]:min-h-11 [&>[data-slot=sheet-close]]:min-w-11">
      <SheetHeader className="shrink-0 gap-0.5 px-0 pr-12 pb-0"><SheetTitle>Where it plays</SheetTitle><SheetDescription className="[overflow-wrap:anywhere]">{title ?? "Nothing is playing."}</SheetDescription></SheetHeader>
      <p className="shrink-0 text-sm text-muted-foreground">{hint}</p>
      <ItemGroup className="shrink-0 gap-0 border-y">
      {/* The band's Volume: one level for the whole Playback, above each device's own. */}
      <Item role="listitem" className="rounded-none border-0 px-0 py-4"><PlaybackVolume state={state} connected={connected} run={run} /></Item>
      {inSync !== undefined && <Item role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-0 border-t px-0 py-4 md:gap-x-6">
        <div><p className="text-base font-medium">In sync</p><p className="text-sm text-muted-foreground">{inSync ? "Devices play together, a few seconds behind the source." : "Each device plays as soon as it receives the source, so devices can be slightly apart."}</p></div>
        <Toggle variant="outline" pressed={inSync} aria-label="Play in sync" onPressedChange={inSync => void run({ type: "inSync", inSync })} className={inverts}>In sync</Toggle>
      </Item>}
        {rows.map(({ device, output: current, mine, capturing, status, private: privately, picture, level, mute, only, sync }) => <Fragment key={device.id}><ItemSeparator className="my-0" /><Item role="listitem" className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-0 px-0 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:gap-x-6", (!current || !device.online) && "text-muted-foreground")}>
            <div className="min-w-0">
              <p className="flex items-start gap-2 text-base font-medium"><DeviceIcon {...signalOf(state, device.id)} className="mt-1" /><span data-output-name className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span></p>
              <p data-output-status className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{status}</p>
              {capturing && <p className="text-sm text-muted-foreground">It plays on the devices you choose here.</p>}
              {current?.buffered && <p className="text-sm text-muted-foreground">Buffered: it couldn't connect directly to this source, so it plays a few seconds behind.</p>}
              {current?.error && <p className="text-sm text-destructive">It couldn't connect directly to this source, and Couch's buffered stream failed: {current.error}</p>}
              {privately && <p className="text-sm text-muted-foreground">{privately === "both" ? "Private" : privately === "picture" ? "Private picture" : "Private sound"}. {mine ? "Only you can change it." : "Only this device can change it."}</p>}
            </div>
            <Toggle variant="outline" pressed={only.on} disabled={!only.enabled} aria-label={`Only on ${device.name}`} onPressedChange={() => void run({ type: "solo", deviceId: device.id })} className={cn("md:col-start-3 md:row-start-1", inverts)}>Only here</Toggle>
            <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <Toggle variant="outline" pressed={picture.on} disabled={!picture.enabled} aria-label={`${device.name} picture`} onPressedChange={on => void run({ type: "output", deviceId: device.id, picture: on })} className={cn("shrink-0", inverts)}><Monitor aria-hidden="true" />Picture</Toggle>
                <div data-volume className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <RangeControl label={`${device.name} volume`} value={level.value} max={100} disabled={!level.enabled} keyboardStep={tv ? 5 : 1} onCommit={value => run({ type: "output", deviceId: device.id, level: value })} />
                  <span className="w-[3ch] shrink-0 text-right tabular-nums">{level.sound ? Math.round(level.value) : "–"}</span>
                </div>
                <Toggle variant="outline" pressed={mute.on} disabled={!mute.enabled} aria-label={`Mute ${device.name}`} onPressedChange={muted => void run({ type: "mute", deviceId: device.id, muted })} className={cn("shrink-0", inverts)}>Mute</Toggle>
              </div>
              {sync && (sync.adjustable ? <Delay name={device.name} delay={sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />
                : <p className="pt-2 text-sm text-muted-foreground">{sync.delay ? `Sync ${sync.delay} ms earlier. ` : ""}Sync adjustment applies when it plays together with other devices.</p>)}
            </div>
          </Item></Fragment>)}
        {!rows.length && <p className="py-4 text-sm text-muted-foreground">No outputs selected. Allow other devices to use a device's speakers or screen to add it here, or choose Play on → This device.</p>}
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
