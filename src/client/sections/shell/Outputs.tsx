import { useContext, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Ellipsis, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DeviceIcon, signalOf } from "@/components/DeviceIcon";
import { MediaArtwork } from "@/components/MediaArtwork";
import { RangeControl } from "@/components/RangeControl";
import { PlaybackVolume, useEndTime } from "@/components/PlaybackTransport";
import { useDetailNavigation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import { formatEndTime } from "@/time-format";
import { deviceId, type playsOn } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import { chooserFor, chooserRequest, overview, picker, reopens, type Control, type Row } from "@/session/where-it-plays";
import type { Action } from "../../../shared/protocol";
import { pathForSection } from "../../../shared/page-paths";
import { settingsPages } from "../../../shared/settings-pages";

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
 * per device, and "Every device" at its foot for the overview. Each request to choose a shared source's receivers
 * opens it, so Play on the publisher leads here. The rules are the model's (session/where-it-plays.ts).
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
        {levels({ state, connected, run, inSync })}
        <ul aria-label="Devices" className="divide-y border-y">{rows.map(row => deviceRow({ state, row, run, tv }))}</ul>
        {hint && <p className="pt-4 text-sm text-muted-foreground">{hint}</p>}
        <SheetClose asChild><EveryDevice variant="ghost" className="-ml-2.5 mt-4 justify-self-start">Every device</EveryDevice></SheetClose>
      </div>
    </SheetContent>
  </ChooserSheet>;
}

// The band's Volume: one level for the whole Playback, above each device's own. Then In sync, where it applies:
// a live input plays directly on each device unless it is chosen (docs/adr/0001).
function levels({ state, connected, run, inSync }: Props & { inSync?: boolean }) {
  return <>
    <div data-nav-row className={cn(columns, "py-4")}><PlaybackVolume state={state} connected={connected} run={run} className="col-span-2 -ml-2.5" /></div>
    {inSync !== undefined && <div data-nav-row className="flex min-h-11 items-center justify-between gap-4 pb-4"><Label htmlFor="where-it-plays-in-sync" className="text-base font-normal">In sync</Label><Switch id="where-it-plays-in-sync" checked={inSync} onCheckedChange={on => void run({ type: "inSync", inSync: on })} /></div>}
  </>;
}

/**
 * A device's row, in the picker and the overview: a check (in or out) that adds or removes the device, then while it
 * is in its fader and number, Sync under them where `sync` asks and it applies, and a "…" menu with Picture, Mute and
 * Only here. Called rather than rendered, so tests can walk its controls without a DOM.
 */
function deviceRow({ state, row, run, tv, sync = false, pageFirst = false }: Omit<Props, "connected"> & { row: Row; tv: boolean; sync?: boolean; pageFirst?: boolean }) {
  const { device, output, status, check, level, picture, mute, only } = row;
  return <li key={device.id} data-nav-row className={cn(columns, "items-start py-2")}>
    <Button data-device-check data-page-first={pageFirst || undefined} variant="ghost" role="checkbox" aria-checked={!!output} aria-label={device.name} aria-describedby={`where-it-plays-${device.id}`} disabled={!check.enabled} onClick={() => { if (check.action) void run(check.action); }}
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
      {sync && row.sync && <Delay label={`${device.name} sync`} delay={row.sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
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
  </li>;
}

// "Every device" opens the overview; Back returns to the page that opened the picker, with focus on its button.
// A component of its own, since the picker renders without hooks in tests.
function EveryDevice(props: ComponentProps<typeof Button>) {
  const navigation = useDetailNavigation();
  return <Button {...props} onClick={event => { props.onClick?.(event); navigation.open(pathForSection("Where it plays"), 'button[aria-label="Where it plays"]'); }} />;
}

/**
 * Where it plays' overview (/where-it-plays): the picker grouped by where each device plays now, since a window acts
 * only on the Playback it controls. That Playback comes first with its Volume and In sync, then each other Playback
 * that plays somewhere, then Not playing. Every row is the picker's, its check meaning "in the Playback you control",
 * with Sync under each in-sync row. Like the picker it renders without hooks, so tests can walk its controls.
 */
export function Overview({ state, connected, run }: Props) {
  const tv = isTvPresentation();
  const { title, status, hint, inSync, rows, elsewhere, free } = overview(state, { here: deviceId(), tv });
  const entry = state.queue.find(item => item.id === state.currentEntryId);
  // The TV starts on the first device you can choose; Up reaches the Volume.
  const first = [...rows, ...elsewhere.flatMap(group => group.rows), ...free].find(row => row.check.enabled)?.device.id;
  const list = (label: string, items: Row[]) => items.length > 0 && <ul aria-labelledby={label} className="divide-y border-y">{items.map(row => deviceRow({ state, row, run, tv, sync: true, pageFirst: row.device.id === first }))}</ul>;
  return <div className="grid w-full max-w-4xl gap-12 [&_[data-slot=slider]]:min-h-11">
    <section>
      <Heading id="where-it-plays-here" thumbnail={entry?.thumbnail} title={title ?? "Nothing is playing"} status={status} time={<EndTime state={state} />} />
      {levels({ state, connected, run, inSync })}
      {list("where-it-plays-here", rows)}
    </section>
    {elsewhere.map(({ playback, status, rows }) => <section key={playback.id}>
      <Heading id={`where-it-plays-${playback.id}`} thumbnail={playback.thumbnail} title={playback.title ?? "Something else"} status={status} time={playback.live ? "Live" : playback.ends && `ends ${formatEndTime(0, playback.ends)}`} />
      {list(`where-it-plays-${playback.id}`, rows)}
    </section>)}
    {free.length > 0 && <section><h2 id="where-it-plays-free" className="pb-4 text-base font-medium">Not playing</h2>{list("where-it-plays-free", free)}</section>}
    <div className="grid justify-items-start gap-4">
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {/* Consent is each device's own: what this one shares. */}
      <Button asChild variant="ghost" className="-ml-2.5"><Link to={settingsPages.sharing.path}>Choose what this device shares</Link></Button>
    </div>
  </div>;
}

// A Playback in the overview, as a line of a departures board: its artwork, title and status, and its end time.
function Heading({ id, thumbnail, title, status, time }: { id: string; thumbnail?: string; title: string; status: string; time: ReactNode }) {
  return <div className="flex items-center gap-4 pb-4">
    <div className="size-14 shrink-0 overflow-hidden bg-muted [&>*]:size-full [&_img]:object-contain"><MediaArtwork thumbnail={thumbnail} title={title} /></div>
    <div className="grid min-w-0 flex-1 gap-0.5"><h2 id={id} className="text-base font-medium [overflow-wrap:anywhere]">{title}</h2><p className="text-sm text-muted-foreground">{status}</p></div>
    <p className="shrink-0 tabular-nums empty:hidden">{time}</p>
  </div>;
}

/** The Playback you control's end time, from its own clock. */
const EndTime = ({ state }: Pick<Props, "state">) => useEndTime(state) ?? null;

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
function Delay({ label, delay, onCommit }: { label: string; delay: number; onCommit: (delay: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  return <div data-volume className="grid w-full gap-1 pb-1">
    <span className="text-sm text-muted-foreground tabular-nums">Sync {value} ms earlier</span>
    <Slider aria-label={label} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
