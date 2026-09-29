import { useState } from "react";
import { Check, Monitor, MonitorUp, Speaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { RangeControl } from "@/components/RangeControl";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState } from "@/session/session";
import type { Action, DeviceSummary, PlaybackSummary } from "../../../shared/protocol";

// Devices, Look at, Send to and the Speakers panel (#644 ticket 9). Every window looks at one
// Playback and controls it; looking never moves its outputs.
type Props = { state: ClientSessionState; run: (action: Action) => Promise<boolean> };

const statusText: Partial<Record<PlaybackSummary["status"], string>> = { loading: "Loading", playing: "Playing", paused: "Paused", ended: "Finished", error: "Can't play" };
const served = (state: ClientSessionState, device: DeviceSummary) => state.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === device.id));
const describe = (playback: PlaybackSummary) => [playback.title ?? "Up next", statusText[playback.status]].filter(Boolean).join(" · ");
const here = (device: DeviceSummary) => device.id === deviceId();
// Online Devices first; offline ones stay listed, and skipped.
const byPresence = (devices: DeviceSummary[] = []) => [...devices].sort((a, b) => Number(b.online) - Number(a.online));

/** Every Device and what it plays. Choosing one looks at its Playback. */
export function DeviceList({ state, run }: Props) {
  const waiting = state.playbacks?.filter(playback => !playback.outputs.length) ?? [];
  const row = (key: string, playback: PlaybackSummary | undefined, name: string, detail: string) => <Button key={key} variant="ghost" className="h-auto w-full justify-between gap-3 rounded-none px-2.5 py-2 text-left font-normal" disabled={!playback} aria-pressed={!!playback && playback.id === state.playback} onClick={() => { if (playback) void run({ type: "look", playback: playback.id }); }}>
    <span className="grid min-w-0"><span className="truncate">{name}</span><span className="truncate text-xs text-muted-foreground">{detail}</span></span>
    {playback && playback.id === state.playback && <Check aria-hidden="true" />}
  </Button>;
  if (!state.devices?.length) return null;
  return <section aria-labelledby="devices-title" className="grid gap-1 border-t pt-3">
    <h3 id="devices-title" className="text-sm font-medium">Devices</h3>
    <div className="-mx-2.5 grid divide-y">
      {byPresence(state.devices).map(device => {
        const playback = served(state, device);
        return row(device.id, playback, `${device.name}${here(device) ? " · Here" : ""}`, !device.online ? "Offline" : playback ? describe(playback) : "Idle");
      })}
      {waiting.map(playback => row(playback.id, playback, playback.title ?? "Up next", "Waiting for a Device"))}
    </div>
  </section>;
}

/** Send to another Device: it takes over the looked-at Playback's outputs. */
export function SendTo({ state, run }: Props) {
  const outputs = state.outputs ?? [];
  // A speaker of a synced Playback can take it over too; only the one Device playing it alone is left out.
  const devices = byPresence(state.devices).filter(device => !(outputs.length && outputs.every(output => output.deviceId === device.id)));
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-11" disabled={!state.playback || !devices.length} aria-label="Send to" title="Send to"><MonitorUp aria-hidden="true" /><span className="max-lg:sr-only">Send to</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-56">
      {devices.map(device => {
        const other = served(state, device);
        return <DropdownMenuItem key={device.id} disabled={!device.online} onSelect={() => void run({ type: "sendTo", deviceId: device.id })}>
          <span className="min-w-0 flex-1 truncate">{device.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{!device.online ? "Offline" : here(device) ? "Here" : other ? statusText[other.status] ?? "Busy" : ""}</span>
        </DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * The Speakers panel: the owner's Mixer. Screens are one-press tiles; sound is a channel strip per
 * Device whose fader adds its sound (0 keeps it silent) and whose switch removes it. Sound on
 * several Devices plays in sync over Sendspin (#644 ticket 10), and each speaker has its own delay.
 */
export function Speakers({ state, run }: Props) {
  const outputs = state.outputs ?? [];
  const devices = byPresence(state.devices).filter(device => device.online || outputs.some(output => output.deviceId === device.id));
  const title = state.queue.find(entry => entry.id === state.currentEntryId)?.title;
  const joinable = (device: DeviceSummary) => device.online || outputs.some(output => output.deviceId === device.id);
  const note = (device: DeviceSummary) => {
    const other = served(state, device);
    return !device.online ? "Offline" : other && other.id !== state.playback ? `Playing ${other.title ?? "something else"}` : here(device) ? "Here" : "";
  };
  return <Sheet>
    <SheetTrigger asChild><Button variant="ghost" size="icon" className="size-11" disabled={!state.playback} aria-label="Speakers" title="Speakers"><Speaker aria-hidden="true" /></Button></SheetTrigger>
    <SheetContent side="bottom" className="max-h-[85dvh] gap-6 overflow-y-auto px-(--gutter) pb-6">
      <SheetHeader className="px-0"><SheetTitle>Speakers</SheetTitle><SheetDescription>{title ?? "Nothing is playing."}</SheetDescription></SheetHeader>
      <section aria-labelledby="screens-title" className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><h3 id="screens-title" className="text-xs font-medium text-muted-foreground">Picture</h3><p className="text-xs text-muted-foreground">Tap a screen to show or hide the picture.</p></div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {devices.map(device => {
            const on = !!outputs.find(output => output.deviceId === device.id)?.picture;
            // Pressed tiles invert, like focus: the default muted pressed state is nearly invisible on Clock's black.
            return <Toggle key={device.id} variant="outline" pressed={on} disabled={!joinable(device)} aria-label={`${device.name} picture`} onPressedChange={picture => void run({ type: "output", deviceId: device.id, picture })}
              className="group h-auto min-w-32 touch:h-auto shrink-0 flex-col items-start gap-2 px-3 py-3 text-left font-normal data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
              <Monitor aria-hidden="true" className="size-5" />
              <span className="grid"><span className="text-sm font-medium">{device.name}</span><span className="text-xs text-muted-foreground group-data-[state=on]:text-background/70">{on ? "Showing" : note(device) || "Off"}</span></span>
            </Toggle>;
          })}
        </div>
      </section>
      <section aria-labelledby="sound-title" className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><h3 id="sound-title" className="text-xs font-medium text-muted-foreground">Sound</h3><p className="text-xs text-muted-foreground">Raise a fader to add a speaker. The switch removes it.</p></div>
        <div className="flex divide-x overflow-x-auto border-y">
          {devices.map(device => {
            const output = outputs.find(item => item.deviceId === device.id);
            const level = output?.level ?? null;
            const disabled = !joinable(device);
            return <div key={device.id} className="grid w-28 shrink-0 justify-items-center gap-2 px-2 py-3" data-in-mix={level !== null || undefined}>
              <span className="text-xl font-medium tabular-nums">{level ?? "–"}</span>
              <div className="h-40"><RangeControl orientation="vertical" label={`${device.name} level`} value={level ?? 0} max={100} disabled={disabled} onCommit={value => run({ type: "output", deviceId: device.id, level: value })} /></div>
              <span className="line-clamp-2 text-center text-sm leading-tight">{device.name}</span>
              <span className="min-h-4 truncate text-xs text-muted-foreground">{note(device)}</span>
              <Switch aria-label={`${device.name} sound`} checked={level !== null} disabled={disabled} onCheckedChange={on => void run({ type: "output", deviceId: device.id, level: on ? 50 : null })} />
              {level !== null && output?.delay !== undefined && <Delay name={device.name} delay={output.delay} onCommit={delay => void run({ type: "output", deviceId: device.id, delay })} />}
            </div>;
          })}
        </div>
      </section>
    </SheetContent>
  </Sheet>;
}

// A speaker that sounds late (Bluetooth, a far room) plays this much earlier to line up.
// It shows its own value while focused, so arrow keys keep stepping from it.
function Delay({ name, delay, onCommit }: { name: string; delay: number; onCommit: (delay: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? delay;
  return <div className="grid w-full gap-1 text-center">
    <span className="text-xs text-muted-foreground tabular-nums">Delay {value} ms</span>
    <Slider aria-label={`${name} delay`} aria-valuetext={`${value} milliseconds`} value={[value]} min={0} max={500} step={10} onValueChange={([next]) => setDraft(next!)} onValueCommit={([next]) => onCommit(next!)} onBlur={() => setDraft(null)} />
  </div>;
}
