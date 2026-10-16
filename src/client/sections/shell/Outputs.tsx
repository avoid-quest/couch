import { useContext, useState, type ReactNode } from "react";
import { Check, Ellipsis, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DeviceIcon, signalOf } from "@/components/DeviceIcon";
import { MediaArtwork } from "@/components/MediaArtwork";
import { RangeControl } from "@/components/RangeControl";
import { PlaybackVolume } from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import { deviceId, type playsOn } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import { chooserFor, chooserRequest, picker, reopens, type Control } from "@/session/where-it-plays";
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

// A row's check, then its fader and number, then its "…" menu; the Volume spans the first two, so the numbers line up.
const columns = "grid grid-cols-[minmax(0,1fr)_2.75rem] gap-x-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]";

/**
 * Where it plays: the Playback's artwork, title and status, its Volume, In sync where it applies, then one row
 * per device. A row is a check (in or out) that adds or removes the device, then while it is in its fader and a
 * "…" menu with Picture, Mute and Only here. Each request to choose a shared source's receivers opens it, so
 * Play on the publisher leads here. The rules are the model's (session/where-it-plays.ts).
 */
export function WhereItPlays({ state, connected, run, className }: Props & { className?: string }) {
  const tv = isTvPresentation();
  const { title, status, hint, inSync, rows } = picker(state, { here: deviceId(), tv });
  const entry = state.queue.find(item => item.id === state.currentEntryId);
  return <ChooserSheet key={state.playback} request={chooserRequest(state)} playback={state.playback ?? null}>
    {/* Device icons stand for individual devices; the mixer opens all output rows. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    {/* It opens on the first device you can choose; Up reaches the Volume. */}
    <SheetContent side="bottom" onOpenAutoFocus={event => { const check = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-device-check]:not(:disabled)"); if (check) { event.preventDefault(); check.focus(); } }}
      className="max-h-[85dvh] scroll-py-6 gap-0 overflow-y-auto px-(--gutter) pt-6 pb-8 [&_[data-slot=slider]]:min-h-11 [&>[data-slot=sheet-close]]:min-h-11 [&>[data-slot=sheet-close]]:min-w-11">
      <div className="grid w-full max-w-4xl">
        <SheetHeader className="flex-row items-center gap-4 p-0 pr-12">
          <div className="size-14 shrink-0 overflow-hidden bg-muted [&>*]:size-full [&_img]:object-contain">{entry && <MediaArtwork thumbnail={entry.thumbnail} title={entry.title} />}</div>
          <div className="grid min-w-0 gap-0.5"><SheetTitle className="text-base font-medium [overflow-wrap:anywhere]">{title ?? "Nothing is playing"}</SheetTitle><SheetDescription>{status}</SheetDescription></div>
        </SheetHeader>
        {/* The band's Volume: one level for the whole Playback, above each device's own. */}
        <div data-nav-row className={cn(columns, "py-4")}><PlaybackVolume state={state} connected={connected} run={run} className="col-span-2 -ml-2.5" /></div>
        {/* A live input plays directly on each device unless In sync is chosen (docs/adr/0001). */}
        {inSync !== undefined && <div data-nav-row className="flex min-h-11 items-center justify-between gap-4 pb-4"><Label htmlFor="where-it-plays-in-sync" className="text-base font-normal">In sync</Label><Switch id="where-it-plays-in-sync" checked={inSync} onCheckedChange={on => void run({ type: "inSync", inSync: on })} /></div>}
        <ul aria-label="Devices" className="divide-y border-y">
          {rows.map(({ device, output, status, check, level, picture, mute, only, sync }) => <li key={device.id} data-nav-row className={cn(columns, "items-start py-2")}>
            <Button data-device-check variant="ghost" role="checkbox" aria-checked={!!output} aria-label={device.name} aria-describedby={`where-it-plays-${device.id}`} disabled={!check.enabled} onClick={() => { if (check.action) void run(check.action); }}
              className="-ml-2.5 h-auto min-h-11 min-w-0 justify-start gap-3 px-2.5 py-1.5 text-left font-normal whitespace-normal">
              <Check aria-hidden="true" className={output ? undefined : "invisible"} />
              <DeviceIcon {...signalOf(state, device.id)} />
              <span className="grid min-w-0">
                <span data-output-name className="text-base [overflow-wrap:anywhere]">{device.name}</span>
                <span id={`where-it-plays-${device.id}`} data-output-status className={cn("text-sm [overflow-wrap:anywhere]", output?.error ? "text-destructive" : "text-muted-foreground")}>{status}</span>
              </span>
            </Button>
            {output && <div className="col-span-2 row-start-2 grid min-w-0 gap-1 md:col-span-1 md:col-start-2 md:row-start-1">
              <div data-volume className="flex min-h-11 min-w-0 items-center gap-3">
                <RangeControl label={`${device.name} volume`} value={level.value} max={100} disabled={!level.enabled} keyboardStep={tv ? 5 : 1} onCommit={value => run({ type: "output", deviceId: device.id, level: value })} />
                <span className="w-[3ch] shrink-0 text-right tabular-nums">{level.sound ? Math.round(level.value) : "–"}</span>
              </div>
              {sync && <Delay name={device.name} delay={sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
            </div>}
            {output && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-lg" className="col-start-2 row-start-1 mt-0.5 justify-self-end md:col-start-3" aria-label={`Options for ${device.name}`} title="Options"><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem aria-label={`${device.name} picture`} checked={picture.on} disabled={!picture.enabled} onCheckedChange={on => void run({ type: "output", deviceId: device.id, picture: on })}>Picture<Why {...picture} /></DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem aria-label={`Mute ${device.name}`} checked={mute.on} disabled={!mute.enabled} onCheckedChange={muted => void run({ type: "mute", deviceId: device.id, muted })}>Mute<Why {...mute} /></DropdownMenuCheckboxItem>
                {/* Pressed again it still commits: a publisher held out for its own capture would otherwise return. */}
                <DropdownMenuCheckboxItem aria-label={`Only on ${device.name}`} checked={only.on} disabled={!only.enabled} onSelect={() => void run({ type: "solo", deviceId: device.id })}>Only here<Why {...only} /></DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </li>)}
        </ul>
        {hint && <p className="pt-4 text-sm text-muted-foreground">{hint}</p>}
      </div>
    </SheetContent>
  </ChooserSheet>;
}

/** A disabled menu item's one-word reason, at its end. */
const Why = ({ reason }: Control) => reason ? <span className="ml-auto pl-6 text-xs">{reason}</span> : null;

/** "on {name} +N", plain text: where the controlled Playback plays when that isn't only this Device. */
export function PlaysOn({ at }: { at: NonNullable<ReturnType<typeof playsOn>> }) {
  return <span className="flex min-w-0 gap-1"><span className="truncate">on {at.name}</span>{!!at.more && <span className="shrink-0">+{at.more}</span>}</span>;
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up with the other
// devices: Sendspin's static delay. It reads "earlier", because "Delay" suggested the opposite (#644 ticket 12),
// and "Sync" so it isn't mistaken for Playback's audio delay against the picture.
// It shows only while the device plays in sync, and its own value while focused, so arrow keys keep stepping from it.
function Delay({ name, delay, onCommit }: { name: string; delay: number; onCommit: (delay: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  return <div data-volume className="grid w-full gap-1 pb-1">
    <span className="text-sm text-muted-foreground tabular-nums">Sync {value} ms earlier</span>
    <Slider aria-label={`${name} sync`} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
