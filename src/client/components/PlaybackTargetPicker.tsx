import { useRef, useState } from "react";
import { MonitorSpeaker } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Slider } from "./ui/slider";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useSessionGate } from "../session/session-context";

type Device = { id: string; name: string; connected: boolean; playbackId?: string; volume: number; muted: boolean; audio: boolean; requiresGesture?: boolean };
type Playback = { id: string; title: string; status: string; deviceIds: string[] };

export function PlaybackTargetPicker() {
  const gate = useSessionGate() as ReturnType<typeof useSessionGate> & {
    selectPlayback: (id: string) => void;
    assignDevices: (ids: string[], takeover?: boolean) => Promise<boolean>;
    newPlayback: (deviceId: string) => Promise<boolean>;
    setDeviceVolume: (deviceId: string, volume: number, muted: boolean) => Promise<boolean>;
  };
  const { state, connected, rendererTargetId, selectPlayback, assignDevices, newPlayback, setDeviceVolume } = gate;
  const model = state as typeof state & { devices?: Device[]; playbacks?: Playback[]; deviceIds?: string[] };
  const [open, setOpen] = useState(false);
  const [replace, setReplace] = useState<Device | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!model) return null;
  const devices = model.devices ?? [];
  const playbacks = model.playbacks ?? [];
  const selected = playbacks.find(playback => playback.id === model.sessionId);
  const assignedIds = model.deviceIds ?? selected?.deviceIds ?? [];
  const selectedNames = assignedIds.map(id => devices.find(device => device.id === id)?.name).filter(Boolean);
  const label = model.handoff ? "Moving playback…" : selectedNames.length === 1 ? selectedNames[0] : selectedNames.length ? `${selectedNames.length} devices` : "Choose devices";
  const disabled = !connected || !!model.handoff;
  const move = (ids: string[], takeover = false) => {
    void assignDevices(ids, takeover).then(ok => { if (ok) setOpen(false); });
  };
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button ref={trigger} variant="ghost" className="min-w-11" disabled={!connected} aria-label="Devices"><MonitorSpeaker aria-hidden="true" /><span className="max-sm:hidden">{label}</span></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(25rem,calc(100vw-1rem))] max-h-[min(80vh,36rem)] overflow-y-auto" onCloseAutoFocus={event => { if (replace) event.preventDefault(); }}>
        <PopoverHeader><PopoverTitle>Devices</PopoverTitle><p className="text-muted-foreground">{selected?.title ?? "Choose playback to control"}</p></PopoverHeader>
        {playbacks.length > 0 && <section aria-label="Playbacks" className="divide-y border-t">
          {playbacks.map(playback => <div key={playback.id} className="flex items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate font-medium">{playback.title}</p><p className="text-xs text-muted-foreground">{playback.deviceIds.map(id => devices.find(device => device.id === id)?.name).filter(Boolean).join(", ") || playback.status}</p></div>{playback.id === model.sessionId ? <span className="text-xs text-muted-foreground">Selected</span> : <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { selectPlayback(playback.id); setOpen(false); }}>Control</Button>}</div>)}
        </section>}
        <section aria-label="Available devices" className="divide-y border-t">
          {devices.map(device => {
            const local = device.id === rendererTargetId;
            const assigned = assignedIds.includes(device.id);
            const occupied = !!device.playbackId && device.playbackId !== model.sessionId;
            const otherPlayback = playbacks.find(playback => playback.id === device.playbackId);
            const canAssign = !!selected && !disabled && device.connected && !occupied;
            return <div key={device.id} className="py-2">
              <div className="flex min-w-0 items-center gap-2">
                {selected && device.audio && !occupied && <Checkbox aria-label={`${assigned ? "Remove" : "Add"} ${device.name}`} checked={assigned} disabled={!canAssign} onCheckedChange={checked => move(checked ? [...assignedIds, device.id] : assignedIds.filter(id => id !== device.id))} />}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{device.name}</p><p className="text-xs text-muted-foreground">{!device.connected ? "Disconnected" : occupied ? `Playing ${otherPlayback?.title ?? "another playback"}` : assigned ? "In this playback" : "Available"}{local && " · This device"}</p></div>
                {occupied && otherPlayback && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { selectPlayback(otherPlayback.id); setOpen(false); }}>Control</Button>}
                {selected && !assigned && device.connected && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => occupied ? (setReplace(device), setOpen(false)) : move([device.id])}>{occupied ? "Replace…" : "Move"}</Button>}
                {!occupied && !assigned && device.connected && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { void newPlayback(device.id).then(ok => { if (ok) setOpen(false); }); }}>{local ? "New playback here" : "New playback"}</Button>}
              </div>
              {assigned && device.audio && <div className="flex items-center gap-2 pt-2"><Slider key={`${device.volume}:${device.muted}`} aria-label={`${device.name} volume`} defaultValue={[device.volume]} min={0} max={100} step={1} disabled={disabled || !device.connected} onValueCommit={([volume]) => { void setDeviceVolume(device.id, volume!, device.muted); }} /><Button size="sm" variant="ghost" disabled={disabled || !device.connected} onClick={() => { void setDeviceVolume(device.id, device.volume, !device.muted); }}>{device.muted ? "Unmute" : "Mute"}</Button></div>}
            </div>;
          })}
          {!devices.length && <p className="py-3 text-muted-foreground">No devices available yet.</p>}
        </section>
      </PopoverContent>
    </Popover>
    <AlertDialog open={!!replace} onOpenChange={value => { if (!value) setReplace(null); }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}><AlertDialogHeader><AlertDialogTitle>Replace playback on {replace?.name}?</AlertDialogTitle><AlertDialogDescription>This device is playing another playback. Replacing it will move the selected playback here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (replace) move([replace.id], true); setReplace(null); }}>Replace and move</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
