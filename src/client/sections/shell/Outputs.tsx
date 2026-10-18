import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Circle, CircleCheck, Ellipsis, SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { chooserFor, chooserRequest, picker, reopens, type Control, type Row } from "@/session/where-it-plays";
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
 * Where it plays, the one place to choose it: the Playback's artwork, title and status, its Volume, In sync where it
 * applies, then the devices it plays on, each with its fader, then the other devices, each saying what it plays now.
 * Each request to choose a shared source's receivers opens it, so Play on the publisher leads here. The rules are the
 * model's (session/where-it-plays.ts).
 */
export function WhereItPlays({ state, connected, run, className }: Props & { className?: string }) {
  const tv = isTvPresentation();
  const { title, status, hint, inSync, rows } = picker(state, { here: deviceId(), tv });
  const entry = state.queue.find(item => item.id === state.currentEntryId);
  // The model lists the Playback's devices first. The others take a heading once both are there, so a long list
  // still shows where the faders end; a waiting source's list is all others, and needs none.
  const playing = rows.filter(row => row.output), others = rows.filter(row => !row.output);
  const list = (label: string, items: Row[]) => items.length > 0 && <ul aria-label={label} className="divide-y border-y">{items.map(row => deviceRow({ state, row, run, tv }))}</ul>;
  return <ChooserSheet key={state.playback} request={chooserRequest(state)} playback={state.playback ?? null}>
    {/* Device icons stand for individual devices; the mixer opens all output rows. */}
    <SheetTrigger asChild><Button variant="ghost" size="icon-lg" className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" /></Button></SheetTrigger>
    {/* It opens on the first device you can choose; Up reaches the Volume. */}
    <SheetContent side="bottom" onOpenAutoFocus={event => { const check = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-device-check]:not(:disabled)"); if (check) { event.preventDefault(); check.focus(); } }}
      className="max-h-[85dvh] scroll-py-6 gap-0 overflow-y-auto px-(--gutter) pt-6 pb-8 [&_[data-slot=slider]]:min-h-11 [&>[data-slot=sheet-close]]:min-h-11 [&>[data-slot=sheet-close]]:min-w-11">
      <SyncScope><div className="grid w-full max-w-4xl">
        <SheetHeader className="flex-row items-center gap-4 p-0 pr-12">
          <div className="size-14 shrink-0 overflow-hidden bg-muted [&>*]:size-full [&_img]:object-contain">{entry && <MediaArtwork thumbnail={entry.thumbnail} title={entry.title} />}</div>
          <div className="grid min-w-0 gap-0.5"><SheetTitle className="text-base font-medium [overflow-wrap:anywhere]">{title ?? "Nothing is playing"}</SheetTitle><SheetDescription>{status}</SheetDescription></div>
        </SheetHeader>
        {levels({ state, connected, run, inSync })}
        {/* The TV's fader hint, where its faders start rather than below a long list. */}
        {hint && <p className="pb-4 text-sm text-muted-foreground">{hint}</p>}
        {list("Playing", playing)}
        {playing.length > 0 && others.length > 0 && <h3 className="pt-8 pb-2 text-base font-medium">Other devices</h3>}
        {list(playing.length ? "Other devices" : "Devices", others)}
      </div></SyncScope>
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
 * A device's row: a check (in or out) that adds or removes the device, then while it is in its fader and number,
 * its Sync line while it plays in sync (see Delay), and a "…" menu with Picture, Mute, Only here and Sync…. Called
 * rather than rendered, so tests can walk its controls without a DOM.
 */
function deviceRow({ state, row, run, tv }: Omit<Props, "connected"> & { row: Row; tv: boolean }) {
  const { device, output, status, explanation, check, level, picture, mute, only } = row;
  return <li key={device.id} data-nav-row className={cn(columns, "items-start py-2")}>
    <Button data-device-check variant="ghost" role="checkbox" aria-checked={!!output} aria-label={device.name} aria-describedby={`where-it-plays-${device.id}`} disabled={!check.enabled} onClick={() => { if (check.action) void run(check.action); }}
      className="-ml-2.5 h-auto min-h-11 min-w-0 justify-start gap-3 px-2.5 py-1.5 text-left font-normal whitespace-normal">
      {/* In, a filled check; out, its empty outline, so a row reads as a device you can add, as AirPlay's list does. */}
      {output ? <CircleCheck aria-hidden="true" className="size-5 fill-foreground text-background" /> : <Circle aria-hidden="true" className="size-5 text-muted-foreground" />}
      <DeviceIcon {...signalOf(state, device.id)} />
      <span className="grid min-w-0">
        <span data-output-name className="text-base [overflow-wrap:anywhere]">{device.name}</span>
        <span id={`where-it-plays-${device.id}`} className={cn("grid text-sm [overflow-wrap:anywhere]", output?.error ? "text-destructive" : "text-muted-foreground")}>
          <span data-output-status>{status}</span>
          {explanation && <span>{explanation}</span>}
        </span>
      </span>
    </Button>
    {output && <div data-volume className="col-span-2 row-start-2 flex min-h-11 min-w-0 items-center gap-3 md:col-span-1 md:col-start-2 md:row-start-1">
      <RangeControl label={`${device.name} volume`} value={level.value} max={100} disabled={!level.enabled} keyboardStep={tv ? 5 : 1} onCommit={value => run({ type: "output", deviceId: device.id, level: value })} />
      <span className="w-[3ch] shrink-0 text-right tabular-nums">{level.sound ? Math.round(level.value) : "–"}</span>
    </div>}
    {row.sync && <Delay id={device.id} label={`${device.name} sync`} delay={row.sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
    {output && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-lg" className="col-start-2 row-start-1 mt-0.5 justify-self-end md:col-start-3" aria-label={`Options for ${device.name}`} title="Options"><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
      <Options id={device.id} sync={!!row.sync}>
        <DropdownMenuCheckboxItem aria-label={`${device.name} picture`} checked={picture.on} disabled={!picture.enabled} onCheckedChange={on => void run({ type: "output", deviceId: device.id, picture: on })}>Picture<Why {...picture} /></DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem aria-label={`Mute ${device.name}`} checked={mute.on} disabled={!mute.enabled} onCheckedChange={muted => void run({ type: "mute", deviceId: device.id, muted })}>Mute<Why {...mute} /></DropdownMenuCheckboxItem>
        {/* Pressed again it still commits: a publisher held out for its own capture would otherwise return. */}
        <DropdownMenuCheckboxItem aria-label={`Only on ${device.name}`} checked={only.on} disabled={!only.enabled} onSelect={() => void run({ type: "solo", deviceId: device.id })}>Only here<Why {...only} /></DropdownMenuCheckboxItem>
      </Options>
    </DropdownMenu>}
  </li>;
}

// The Sync line a row's "Sync…" revealed. Local to the open Sheet, so closing it hides the line again.
const RevealedSync = createContext<{ id: string | null; reveal: (id: string | null) => void }>({ id: null, reveal: () => {} });
function SyncScope({ children }: { children: ReactNode }) {
  const [id, reveal] = useState<string | null>(null);
  return <RevealedSync value={{ id, reveal }}>{children}</RevealedSync>;
}

// A row's "…": its items, then Sync… while Sync applies, which reveals the row's Sync line and moves focus to its
// slider rather than back to "…". The items stay children, so tests walk them without a DOM.
function Options({ id, sync, children }: { id: string; sync: boolean; children: ReactNode }) {
  const { reveal } = useContext(RevealedSync);
  const picked = useRef(false);
  return <DropdownMenuContent align="end" onCloseAutoFocus={event => {
    if (!picked.current) return;
    picked.current = false;
    event.preventDefault();
    document.querySelector<HTMLElement>(`[data-sync-line="${id}"] [role="slider"]`)?.focus();
  }}>
    {children}
    {sync && <><DropdownMenuSeparator /><DropdownMenuItem className="pl-8" onSelect={() => { picked.current = true; reveal(id); }}>Sync…</DropdownMenuItem></>}
  </DropdownMenuContent>;
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
// It applies only while the device plays in sync, and its own value shows while focused, so arrow keys keep stepping
// from it. Few people touch it, so a row shows it only while it isn't 0, or once its "…" revealed it.
// A line of the row's own grid (subgrid): its words under the device's status, its slider under the fader, as long.
function Delay({ id, label, delay, onCommit }: { id: string; label: string; delay: number; onCommit: (delay: number) => void }) {
  const revealed = useContext(RevealedSync);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  // A line taken to 0 while its slider is in use stays until focus leaves it, as a revealed one would.
  const shown = revealed.id === id || draft !== null;
  const hides = shown && !delay;
  // Back or Esc on a revealed slider still at 0 hides it, with focus back on "…", rather than closing the Sheet.
  // Radix listens on the document, so this listens on the window first, after the TV fader's own Back has had its turn.
  useEffect(() => {
    if (!hides) return;
    const hide = (event: KeyboardEvent) => {
      const slider = event.target instanceof HTMLElement ? event.target.closest(`[data-sync-line="${id}"] [role="slider"]`) : null;
      if (event.key !== "Escape" || event.defaultPrevented || !slider) return;
      event.preventDefault(); event.stopPropagation();
      slider.closest("li")?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
      revealed.reveal(null);
    };
    window.addEventListener("keydown", hide, true);
    return () => window.removeEventListener("keydown", hide, true);
  }, [hides, id]);
  if (!delay && !shown) return null;
  return <div data-volume data-sync-line={id} className="col-span-2 flex min-h-11 min-w-0 items-center gap-3 md:grid md:grid-cols-subgrid">
    <span className="shrink-0 text-sm text-muted-foreground tabular-nums md:pl-15">Sync {value} ms earlier</span>
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Slider aria-label={label} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
      <span aria-hidden="true" className="w-[3ch] shrink-0" />
    </div>
  </div>;
}
