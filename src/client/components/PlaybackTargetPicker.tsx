import { useRef, useState } from "react";
import { MonitorSpeaker } from "lucide-react";
import type { PlaybackTarget } from "../../shared/protocol";
import { PlaybackGroupControls } from "./PlaybackGroupControls";
import { SendspinClientDialog } from "./SendspinClientDialog";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useSessionGate } from "../session/session-context";

export function PlaybackTargetPicker() {
  const { state, connected, run, rendererTargetId, playHere, nativeHost, sessionMode = "household", selectSession, sendspin } = useSessionGate();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [replace, setReplace] = useState<PlaybackTarget | null>(null);
  const [sendspinOpen, setSendspinOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sendspinActive = !!sendspin && sendspin.phase !== "idle";
  if (!state?.targets && !sendspinActive) return null;
  const targets = state?.targets ?? [];
  const disabled = !connected || !!state?.handoff;
  const selected = targets.find(target => target.id === state?.targetId);
  const group = targets.find(target => target.id === groupId && target.kind === "group");
  const here = !!rendererTargetId && state?.targetId === rendererTargetId;
  const label = state?.handoff ? "Moving playback…" : selected?.name ?? (rendererTargetId ? "This device" : "Choose devices");
  const move = (target: PlaybackTarget, takeover = false) => {
    setOpen(false);
    void run({ type: "selectTarget", targetId: target.id, ...(takeover ? { takeover: true } : {}) });
  };
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button ref={trigger} variant="ghost" className="min-w-11" disabled={disabled && !sendspinActive} aria-label="Devices"><MonitorSpeaker aria-hidden="true" /><span className="max-sm:hidden">{label}</span></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] max-h-[min(80vh,36rem)] overflow-y-auto" onCloseAutoFocus={event => { if (sendspinOpen || replace) event.preventDefault(); }}>
        <PopoverHeader><PopoverTitle>Devices</PopoverTitle><p className="text-muted-foreground">{sessionMode === "personal" ? "Your playback" : "Shared playback"}{selected ? ` · ${selected.name}` : " · Choose where to play"}</p></PopoverHeader>
        <div className="divide-y border-t">
          {targets.map(target => {
            const current = target.id === state?.targetId;
            const local = target.id === rendererTargetId;
            const listeningGroup = targets.find(group => group.kind === "group" && group.members?.some(member => member.joined && (member as typeof member & { deviceId?: string }).deviceId === target.id));
            const canMove = !disabled && target.connected && !(listeningGroup?.id === state?.targetId) && (!current || state?.player.status === "unavailable");
            return <div key={target.id} className="flex min-w-0 items-center gap-2 py-2">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{target.name}</p><p className="text-xs text-muted-foreground">{!target.connected ? "Disconnected" : current ? "Playing here" : listeningGroup ? `Listening with ${listeningGroup.name}` : target.occupied ? "In use" : target.kind === "group" ? "Shared audio" : "Available"}{local && " · This device"}</p></div>
              {canMove && <Button size="sm" variant="ghost" onClick={() => target.occupied ? (setReplace(target), setOpen(false)) : move(target)}>{target.occupied ? "Replace…" : current ? "Resume" : state?.currentEntryId ? "Move" : "Choose"}</Button>}
              {canMove && target.occupied && target.sessionKind === "household" && sessionMode === "personal" && selectSession && <Button size="sm" variant="ghost" onClick={() => { selectSession("household"); setOpen(false); }}>Control</Button>}
              {target.kind === "group" && target.backend === "sendspin" && <Button size="sm" variant="ghost" onClick={() => setGroupId(groupId === target.id ? null : target.id)} aria-label={`Adjust ${target.name} devices`}>Adjust</Button>}
            </div>;
          })}
          {!targets.length && <p className="py-3 text-muted-foreground">No devices available yet.</p>}
        </div>
        {group && <PlaybackGroupControls key={group.id} target={group} connected={connected} busy={!!state?.handoff} run={run} onClose={() => setGroupId(null)} />}
        {selectSession && <div className="border-t pt-2">
          <Button variant="ghost" className="w-full justify-start px-0" disabled={disabled} onClick={() => { selectSession(sessionMode === "personal" ? "household" : "personal"); setOpen(false); }}>{sessionMode === "personal" ? "Control shared playback" : "Control your playback"}</Button>
          {sessionMode === "household" && (selected?.kind === "group" || sendspinActive) && rendererTargetId && <Button variant="ghost" className="w-full justify-start px-0" disabled={disabled} onClick={() => { selectSession("personal", true); setOpen(false); }}>Play separately on this device</Button>}
        </div>}
        {sendspin && <div className="border-t pt-2"><Button variant="ghost" className="w-full justify-start px-0" onClick={() => { setOpen(false); setSendspinOpen(true); }}>{sendspinActive ? "Listening together" : "Listen together"}</Button></div>}
      </PopoverContent>
    </Popover>
    <AlertDialog open={!!replace} onOpenChange={value => { if (!value) setReplace(null); }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}><AlertDialogHeader><AlertDialogTitle>Replace playback on {replace?.name}?</AlertDialogTitle><AlertDialogDescription>Playback already using this device will stop. Your selected playback will move there.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (replace) move(replace, true); setReplace(null); }}>Replace and move</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {sendspin && <SendspinClientDialog open={sendspinOpen} onOpenChange={setSendspinOpen} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />}
    {!nativeHost && here && state?.player.requiresGesture && <Button disabled={disabled} onClick={playHere}>Listen here</Button>}
  </>;
}
