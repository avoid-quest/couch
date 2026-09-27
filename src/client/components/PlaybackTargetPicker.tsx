import { useRef, useState } from "react";
import { MonitorSpeaker, MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { RangeControl } from "./RangeControl";
import { Switch } from "./ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useSessionGate } from "../session/session-context";

type Device = { id: string; name: string; connected: boolean; playbackId?: string; volume: number; muted: boolean; audio: boolean; requiresGesture?: boolean };

export function PlaybackTargetPicker() {
  const { state, connected, rendererTargetId, assignDevices, newPlayback, setDeviceVolume, activateDeviceAudio, error } = useSessionGate();
  const [open, setOpen] = useState(false);
  const [replace, setReplace] = useState<Device | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const devices = state?.devices ?? [];
  const playbacks = state?.playbacks ?? [];
  const selected = playbacks.find(playback => playback.id === state?.sessionId);
  const videoDeviceId = state?.videoDeviceId;
  const assignedIds = state?.deviceIds ?? selected?.deviceIds ?? [];
  const disabled = !connected || !!state?.handoff || pending !== null;
  const waiting = pending && pending.length > 1 ? pending.map(id => devices.find(device => device.id === id)).filter(device => device?.requiresGesture).map(device => device!.name) : [];
  const assign = (ids: string[], takeover = false, close = true) => {
    setPending(ids);
    void assignDevices(ids, takeover).then(ok => { if (ok && close) setOpen(false); }).finally(() => setPending(null));
  };
  return <>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button ref={trigger} variant="ghost" disabled={!state} aria-label="Output"><MonitorSpeaker aria-hidden="true" /><span>Output</span></Button></SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0" onCloseAutoFocus={event => { if (replace) event.preventDefault(); }}>
        <SheetHeader className="border-b px-6 py-4 pr-16"><SheetTitle>Output</SheetTitle><SheetDescription>{waiting.length ? `Enable audio in Couch on ${waiting.join(", ")} to continue.` : pending !== null ? "Updating devices…" : state?.handoff ? "Moving playback…" : selected?.title ?? "Choose where to play"}</SheetDescription></SheetHeader>
        <div className="overflow-y-auto px-6 pb-6">
          <section aria-label="Devices" className="min-w-0">
            {devices.length ? <div className="flex w-full divide-x overflow-x-auto overscroll-x-contain py-5">{devices.map(device => {
              const local = device.id === rendererTargetId;
              const assigned = assignedIds.includes(device.id);
              const occupied = !!device.playbackId && device.playbackId !== state?.sessionId;
              const otherPlayback = playbacks.find(playback => playback.id === device.playbackId);
              const canToggle = !!selected && !disabled && (assigned || device.connected && !occupied && (device.audio || assignedIds.length === 0));
              const volumeEnabled = assigned && device.connected && !disabled;
              return <div key={device.id} className="flex w-36 shrink-0 flex-col items-center px-4 text-center first:pl-0 last:pr-0">
                <div className="flex h-8 w-full items-center justify-between gap-1"><span className="text-xs tabular-nums text-muted-foreground">{device.muted ? "Muted" : `${device.volume}%`}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Options for ${device.name}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={disabled || !device.connected || occupied || assigned} onSelect={() => { void newPlayback(device.id).then(ok => { if (ok) setOpen(false); }); }}>New playback here</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
                <div className="my-3 h-40 w-11 shrink-0"><RangeControl orientation="vertical" label={`${device.name} volume`} value={device.volume} max={100} disabled={!volumeEnabled} onCommit={volume => setDeviceVolume(device.id, volume, device.muted)} /></div>
                <p className="w-full shrink-0 truncate font-medium" title={device.name}>{device.name}</p>
                <p className="min-h-8 text-xs text-muted-foreground">{!device.connected ? "Disconnected" : occupied ? `Playing ${otherPlayback?.title ?? "another playback"}` : assigned ? videoDeviceId ? device.id === videoDeviceId ? "Picture and sound" : "Sound" : "In this playback" : "Available"}{local && " · This device"}</p>
                <label className="mt-2 flex min-h-11 items-center gap-2 text-xs"><Switch aria-label={`${device.name} output`} checked={assigned} disabled={!canToggle} onCheckedChange={checked => assign(checked ? [...assignedIds, device.id] : assignedIds.filter(id => id !== device.id), false, false)} />{assigned ? "On" : "Off"}</label>
                {assigned && <Button size="sm" variant="ghost" disabled={!volumeEnabled} onClick={() => { void setDeviceVolume(device.id, device.volume, !device.muted); }}>{device.muted ? "Unmute" : "Mute"}</Button>}
                {assigned && assignedIds.length > 1 && local && device.requiresGesture && <Button size="sm" variant="ghost" onClick={() => { void activateDeviceAudio(); }}>Enable audio</Button>}
                {selected && device.connected && (!assigned || assignedIds.length > 1) && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => occupied ? (setReplace(device), setOpen(false)) : assign([device.id])}>{occupied ? "Replace…" : "Move playback here"}</Button>}
              </div>;
            })}</div> : <p className="py-8 text-sm text-muted-foreground">{connected ? "No devices available yet." : "Connecting to devices…"}</p>}
          </section>
          {error && <p role="alert" className="border-t py-3 text-sm text-destructive">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={!!replace} onOpenChange={value => { if (!value) setReplace(null); }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}><AlertDialogHeader><AlertDialogTitle>Replace playback on {replace?.name}?</AlertDialogTitle><AlertDialogDescription>This device is playing another playback. Replacing it will move the selected playback here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (replace) assign([replace.id], true); setReplace(null); }}>Replace and move</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
