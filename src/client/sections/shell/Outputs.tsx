import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ellipsis, Monitor, MonitorOff, SlidersVertical, Volume2, VolumeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FilterInput } from "@/components/ContentFilters";
import { RangeControl } from "@/components/RangeControl";
import { PlaybackVolume } from "@/components/PlaybackTransport";
import { cn } from "@/lib/utils";
import { deviceId, type playsOn } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import { arrange, chooserFor, chooserRequest, counts, crowded, orderOf, picker, reopens, soundActions, type Control, type Filter, type Order, type Row } from "@/session/where-it-plays";
import type { Action } from "../../../shared/protocol";

type Props = { state: ClientSessionState; connected: boolean; run: (action: Action) => Promise<boolean> };
type Side = "popover" | "right" | "bottom";

// A desktop's pointer and width: there the panel hangs from its button, so the bar and the transport stay usable.
const desktopQuery = "(min-width: 960px) and (pointer: fine)";
const subscribeDesktop = (onChange: () => void) => { const media = window.matchMedia(desktopQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); };
const isDesktop = () => window.matchMedia(desktopQuery).matches;
/** The longest list a Popover holds; past it the same button opens a right-side Sheet. */
const popoverRows = 10;

/**
 * Where it plays: the mixer for one Couch's devices, its own button in the now-playing bar and the player band.
 * The Volume, the counts, then every device's row, the playback's first. The rules are the model's (session/where-it-plays.ts).
 */
export function WhereItPlays(props: Props & { className?: string; label?: string; sideOffset?: number }) {
  // A new playback starts closed, with its own order.
  return <Panel key={props.state.playback} {...props} />;
}

// The player's band passes a sideOffset so its Popover opens above the whole band, clear of the timeline, as its menus do.
function Panel({ state, connected, run, className, label, sideOffset }: Props & { className?: string; label?: string; sideOffset?: number }) {
  const tv = isTvPresentation();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // Radix's controlled open state: a changed defaultOpen would not open a mounted panel. The session remembers the
  // closed request, so the now-playing bar and Now Playing each open it at most once. Core's request opens every
  // window viewing the playback; this window's own request opens only here.
  const gate = useContext(SessionGateContext);
  const [opened, setOpened] = useState(false);
  const requested = chooserFor(chooserRequest(state), state.playback ?? null, gate?.requestedChooser);
  const open = opened || reopens(gate?.dismissedChooser ?? null, requested);
  // Taken as it opens: rows keep their order and the panel its kind until it closes.
  const [view, setView] = useState<{ order: Order; side: Side } | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const rows = picker(state, { here: deviceId() }).rows;
  const fresh = () => ({ order: orderOf(rows), side: (tv || !desktop ? "bottom" : arrange(rows).listed > popoverRows ? "right" : "popover") as Side });
  if (open && !view) setView(fresh());
  const side = view?.side ?? fresh().side;
  const change = (next: boolean) => {
    setOpened(next);
    if (next) return;
    if (requested) gate?.dismissChooser(requested);
    setView(null); setFilter(null); setQuery("");
  };
  const trigger = <Button variant="ghost" size={label ? "default" : "icon-lg"} className={className} disabled={!state.playback} aria-label="Where it plays" title="Where it plays"><SlidersVertical aria-hidden="true" />{label}</Button>;
  const body = (close?: ReactNode) => <Mixer state={state} connected={connected} run={run} tv={tv} order={view?.order} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} close={close} />;
  // It opens on the first device on the TV, else on the Volume, never on a control that changes where it plays.
  const focusFirst = (event: Event) => {
    const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(tv ? "[data-device-row]" : '[aria-label="Volume"] [role="slider"], [data-device-row]');
    if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
  };
  if (side === "popover") return <Popover open={open} onOpenChange={change}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={sideOffset} aria-label="Where it plays" onOpenAutoFocus={focusFirst}
      className="max-h-[min(40rem,calc(var(--radix-popover-content-available-height)-1rem))] w-[min(34rem,calc(100vw-2rem))] gap-0 overflow-y-auto px-4 pt-2 pb-3"><SyncScope>{body()}</SyncScope></PopoverContent>
  </Popover>;
  return <Sheet open={open} onOpenChange={change}>
    <SheetTrigger asChild>{trigger}</SheetTrigger>
    <SheetContent side={side === "right" ? "right" : "bottom"} aria-describedby={undefined} onOpenAutoFocus={focusFirst} showCloseButton={false}
      className={cn("gap-0 overflow-y-auto px-(--gutter) pb-8", side === "right" ? "data-[side=right]:w-[min(34rem,100vw)] data-[side=right]:sm:max-w-[34rem]" : "max-h-[85dvh] items-center")}>
      <SheetTitle className="sr-only">Where it plays</SheetTitle>
      <SyncScope><div className="grid w-full max-w-3xl bg-inherit">
        {body(<SheetClose asChild><Button variant="ghost" size="icon-lg" className="-mr-2.5 size-11 shrink-0" aria-label="Close" title="Close"><X aria-hidden="true" /></Button></SheetClose>)}
      </div></SyncScope>
    </SheetContent>
  </Sheet>;
}

type MixerProps = Props & { tv?: boolean; order?: Order; filter?: Filter | null; query?: string; onFilter?: (filter: Filter | null) => void; onQuery?: (query: string) => void; close?: ReactNode };

/**
 * The panel's content, without hooks, so tests walk its controls by label without a DOM: the Volume (or, for a
 * shared source waiting for receivers, "Choose where {title} plays"), In sync where it applies, the counts, then the
 * rows, the playback's devices first and the rest after a hairline, offline ones folded into one line.
 */
export function Mixer({ state, connected, run, tv = false, order, filter = null, query = "", onFilter, onQuery, close }: MixerProps) {
  const { choose, inSync, rows } = picker(state, { here: deviceId() });
  const { playing, rest, offline, listed } = arrange(rows, order, filter, query);
  const summary = counts(rows), many = listed > crowded;
  const row = (item: Row) => tv ? tvRow({ row: item, run }) : deviceRow({ row: item, run });
  return <>
    {/* The first line, and with the counts and search, what stays put while a long list scrolls. */}
    <div className="sticky top-0 z-10 grid gap-1 bg-inherit pt-2 pb-2">
      <div data-nav-row className="flex min-h-11 items-center gap-2">
        {choose ? <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">{choose}</p> : <PlaybackVolume state={state} connected={connected} run={run} className="-ml-2.5" />}
        {/* Close, or the "…" column's room, so the numbers line up. */}
        {close ?? <span aria-hidden="true" className="w-11 shrink-0 max-sm:hidden" />}
      </div>
      {inSync !== undefined && <div data-nav-row className="flex min-h-11 items-center justify-between gap-4"><Label htmlFor="where-it-plays-in-sync" className="text-base font-normal">In sync</Label><Switch id="where-it-plays-in-sync" checked={inSync} onCheckedChange={on => void run({ type: "inSync", inSync: on })} /></div>}
      {summary.length > 0 && (many
        ? <ToggleGroup data-nav-row type="single" aria-label="Show" spacing={1} value={filter ?? ""} onValueChange={next => onFilter?.(next ? next as Filter : null)} className="-ml-2 max-w-full flex-wrap">
          {summary.map(item => <ToggleGroupItem key={item.filter} value={item.filter} className="rounded-none border-b-2 border-transparent px-2 font-normal text-muted-foreground data-[state=on]:border-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground">{item.label} <span className="tabular-nums">{item.count}</span></ToggleGroupItem>)}
        </ToggleGroup>
        : <p data-mixer-summary className="text-sm text-muted-foreground tabular-nums">{summary.map(item => `${item.label} ${item.count}`).join(" · ")}</p>)}
      {many && <div data-nav-row className="flex pt-1"><FilterInput label="Find a device" placeholder="Find a device" value={query} onChange={value => onQuery?.(value)} className="sm:max-w-none" /></div>}
    </div>
    {playing.length > 0 && <ul aria-label="Playing" className="grid">{playing.map(row)}</ul>}
    {rest.length > 0 && <ul aria-label="Not playing" className={cn("grid", playing.length > 0 && "mt-2 border-t pt-2")}>{rest.map(row)}</ul>}
    {offline.length > 0 && <p data-offline className="mt-2 border-t pt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">Offline: {offline.map(item => item.device.name).join(", ")}</p>}
  </>;
}

/** A row's change, with the unmute its sound brings (soundActions), each in turn until Core refuses one. */
const send = async (run: Props["run"], row: Row, action: Action) => { for (const next of soundActions(row, action)) if (!await run(next)) return false; return true; };

const statusLine = (row: Row) => row.status && <span id={`where-it-plays-${row.device.id}`} data-output-status className={cn("text-sm [overflow-wrap:anywhere]", row.failed ? "text-destructive" : "text-muted-foreground")}>{row.status}</span>;
const syncLabel = (row: Row) => row.sync?.lip ? "Lip sync" : "Sync";

/**
 * A device's row, the same at every scale: its name and any exception, its Picture and Sound toggles, its fader and
 * number while its sound is on (Move here instead while it isn't in), and "…" while Sync applies. On phones the fader takes a second line.
 * Called rather than rendered, so tests can walk its controls without a DOM.
 */
function deviceRow({ row, run }: { row: Row; run: Props["run"] }) {
  const { device, output, picture, sound, level, move } = row;
  const toggle = (channel: typeof picture, label: string, on: ReactNode, off: ReactNode, name: string) =>
    <Toggle aria-label={`${device.name} ${label}`} title={channel.reason ?? name} pressed={channel.on} disabled={!channel.enabled} onPressedChange={() => void send(run, row, channel.action)}
      className="size-11 data-[state=off]:text-muted-foreground data-[state=on]:bg-transparent">{channel.on ? on : off}</Toggle>;
  return <li key={device.id} data-nav-row data-device={device.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_5.5rem] items-center gap-x-1 py-1 sm:grid-cols-[minmax(0,1fr)_auto_auto_11rem_2.75rem]">
    <span className="grid min-w-0 py-1">
      <span data-output-name className="text-base [overflow-wrap:anywhere]">{device.name}</span>
      {statusLine(row)}
    </span>
    {toggle(picture, "picture", <Monitor aria-hidden="true" />, <MonitorOff aria-hidden="true" />, "Picture")}
    {toggle(sound, "sound", <Volume2 aria-hidden="true" />, <VolumeOff aria-hidden="true" />, "Sound")}
    {output && level.sound && <div data-volume className="col-span-full row-start-2 flex min-h-11 min-w-0 items-center gap-3 sm:col-span-1 sm:col-start-4 sm:row-start-1">
      <RangeControl label={`${device.name} volume`} value={level.value} max={100} disabled={!level.enabled} onCommit={value => send(run, row, { type: "output", deviceId: device.id, level: value })} />
      <span className="w-[3ch] shrink-0 text-right tabular-nums">{Math.round(level.value)}</span>
    </div>}
    {!output && move && <Button variant="ghost" aria-label={`Move here: ${device.name}`} title={move.reason} disabled={!move.enabled} onClick={() => void run({ type: "solo", deviceId: device.id })} className="col-start-4 row-start-1 -mr-2.5 justify-self-end sm:mr-0 sm:justify-self-start">Move here</Button>}
    {row.sync && <Delay id={device.id} label={`${device.name} ${syncLabel(row).toLowerCase()}`} word={syncLabel(row)} delay={row.sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
    {output && row.sync && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-lg" className="col-start-4 row-start-1 -mr-2.5 size-11 justify-self-end sm:col-start-5" aria-label={`Options for ${device.name}`} title="Options"><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
      <Options id={device.id} sync={`${syncLabel(row)}…`} />
    </DropdownMenu>}
  </li>;
}

/**
 * On a TV a row is one focus stop: Left and Right move its level by 5 at once (no OK to take the arrows), OK opens
 * its options with Picture and Sound, and Back closes the panel. Called rather than rendered, as deviceRow is.
 */
function tvRow({ row, run }: { row: Row; run: Props["run"] }) {
  const { device, picture, sound, level } = row;
  const step = (by: number) => { if (level.enabled && level.sound) void send(run, row, { type: "output", deviceId: device.id, level: Math.max(0, Math.min(100, level.value + by)) }); };
  return <li key={device.id} data-nav-row data-device={device.id} className="grid">
    <DropdownMenu>
      {/* A horizontal slider outside a Volume, so Left/Right reach it and Up/Down move on (navigation.ts). */}
      <DropdownMenuTrigger asChild><div data-device-row role="slider" tabIndex={0} aria-label={device.name} aria-describedby={row.status ? `where-it-plays-${device.id}` : undefined}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={level.value} aria-valuetext={level.sound ? `${Math.round(level.value)} percent` : "No sound"}
        onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step(event.key === "ArrowLeft" ? -5 : 5); } }}
        className="-mx-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,11rem)_3ch] items-center gap-x-3 px-2.5 py-2 outline-none">
        <span className="grid min-w-0"><span data-output-name className="text-base [overflow-wrap:anywhere]">{device.name}</span>{statusLine(row)}</span>
        {picture.on ? <Monitor aria-hidden="true" className="size-5" /> : <MonitorOff aria-hidden="true" className="size-5 opacity-50" />}
        {sound.on ? <Volume2 aria-hidden="true" className="size-5" /> : <VolumeOff aria-hidden="true" className="size-5 opacity-50" />}
        {level.sound ? <Progress value={level.value} aria-hidden="true" className="bg-current/20 [&_[data-slot=progress-indicator]]:bg-current" /> : <span />}
        <span className="text-right tabular-nums">{level.sound ? Math.round(level.value) : ""}</span>
      </div></DropdownMenuTrigger>
      <Options id={device.id} sync={row.sync && `${syncLabel(row)}…`}>{channelItems({ row, run })}</Options>
    </DropdownMenu>
    {row.sync && <Delay id={device.id} label={`${device.name} ${syncLabel(row).toLowerCase()}`} word={syncLabel(row)} delay={row.sync.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
  </li>;
}

/** A TV row's Picture and Sound, which its OK opens. Its sound is its Sound and fader's. */
function channelItems({ row, run }: { row: Row; run: Props["run"] }) {
  const { device, picture, sound } = row;
  return <>
    <DropdownMenuCheckboxItem aria-label={`${device.name} picture`} checked={picture.on} disabled={!picture.enabled} onCheckedChange={() => void send(run, row, picture.action)}>Picture<Why {...picture} /></DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem aria-label={`${device.name} sound`} checked={sound.on} disabled={!sound.enabled} onCheckedChange={() => void send(run, row, sound.action)}>Sound<Why {...sound} /></DropdownMenuCheckboxItem>
  </>;
}

// The Sync line a row's "Sync…" revealed. Local to the open panel, so closing it hides the line again.
const RevealedSync = createContext<{ id: string | null; reveal: (id: string | null) => void }>({ id: null, reveal: () => {} });
function SyncScope({ children }: { children: ReactNode }) {
  const [id, reveal] = useState<string | null>(null);
  return <RevealedSync value={{ id, reveal }}>{children}</RevealedSync>;
}

// A row's options (a TV row's Picture and Sound), then Sync… while Sync applies, which reveals the row's Sync line and moves focus to its slider
// rather than back to what opened the menu. The items stay children, so tests walk them without a DOM.
function Options({ id, sync, children }: { id: string; sync?: string; children?: ReactNode }) {
  const { reveal } = useContext(RevealedSync);
  const picked = useRef(false);
  return <DropdownMenuContent align="end" onCloseAutoFocus={event => {
    if (!picked.current) return;
    picked.current = false;
    event.preventDefault();
    document.querySelector<HTMLElement>(`[data-sync-line="${id}"] [role="slider"]`)?.focus();
  }}>
    {children}
    {sync && <>{children && <DropdownMenuSeparator />}<DropdownMenuItem className="pl-8" onSelect={() => { picked.current = true; reveal(id); }}>{sync}</DropdownMenuItem></>}
  </DropdownMenuContent>;
}

/** A disabled menu item's one-word reason, at its end. */
const Why = ({ reason }: Control) => reason ? <span className="ml-auto pl-6 text-xs">{reason}</span> : null;

/**
 * "on {name} +N": where the controlled Playback plays when that isn't only this Device. The now-playing bar and the
 * player say it the same way: first under the title, so it reads on from it, in the ink, not the muted metadata.
 */
export function PlaysOn({ at }: { at: NonNullable<ReturnType<typeof playsOn>> }) {
  return <span data-plays-on className="flex min-w-0 max-w-full shrink-0 gap-1 font-medium text-foreground"><span className="truncate">on {at.name}</span>{!!at.more && <span className="shrink-0">+{at.more}</span>}</span>;
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up with the other devices:
// Sendspin's static delay, 0–500 ms. "Lip sync" while another device shows the picture. It applies only while the
// device plays in sync, and few people touch it, so a row shows it only while it isn't 0, or once "…" revealed it.
// Its slider is horizontal and outside a Volume, so on the TV Left/Right move it at once, as a row's level.
function Delay({ id, label, word, delay, onCommit }: { id: string; label: string; word: string; delay: number; onCommit: (delay: number) => void }) {
  const revealed = useContext(RevealedSync);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  // A line taken to 0 while its slider is in use stays until focus leaves it, as a revealed one would.
  const shown = revealed.id === id || draft !== null;
  const hides = shown && !delay;
  // Back or Esc on a revealed slider still at 0 hides it, with focus back on the row's options, rather than closing
  // the panel. Radix listens on the document, so this listens on the window first.
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
  return <div data-sync-line={id} className="col-span-full flex min-h-11 min-w-0 items-center gap-3 pb-1">
    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{word} {value} ms earlier</span>
    <Slider aria-label={label} aria-valuetext={`${value} milliseconds earlier`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
