import { useRef, useState } from "react";
import { PlaybackGroupControls } from "./PlaybackGroupControls";
import { SendspinClientDialog } from "./SendspinClientDialog";
import { Monitor, Speaker } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useSessionGate } from "../session/session-context";

export function PlaybackTargetPicker() {
  const { state, connected, run, rendererTargetId, playHere, nativeHost, sessionMode = "household", selectSession, sendspin } = useSessionGate();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sendspinOpen, setSendspinOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sendspinActive = !!sendspin && sendspin.phase !== "idle";
  if (!state?.targets && !sendspinActive) return null;
  const targets = state?.targets ?? [];
  const coreDisabled = !connected || !!state?.handoff;
  const group = targets.find(target => target.id === groupId && target.kind === "group");
  const target = targets.find(target => target.id === state?.targetId);
  const here = !!rendererTargetId && state?.targetId === rendererTargetId;
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" className="min-w-11" disabled={coreDisabled && !sendspinActive} aria-label="Playback output"><Speaker aria-hidden="true" /><span className="max-sm:hidden">{state?.handoff ? "Moving playback…" : here ? nativeHost ? "This computer" : "This browser" : target?.name ?? "Playback output"}</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (groupId || sendspinOpen) event.preventDefault(); }}>
        {targets.map(target => <DropdownMenuItem key={target.id} disabled={coreDisabled || !target.connected || !!target.occupied || target.id === state?.targetId && state?.player.status !== "unavailable"} onSelect={() => void run({ type: "selectTarget", targetId: target.id })}>
          <Monitor aria-hidden="true" />{target.id === rendererTargetId ? state?.currentEntryId ? "Move playback here" : nativeHost ? "Play on this computer" : "Play in this browser" : `${state?.currentEntryId ? "Continue on" : "Play on"} ${target.name}`}{!target.connected ? " (disconnected)" : ""}
        </DropdownMenuItem>)}
        {selectSession && sessionMode !== "personal" && rendererTargetId && <DropdownMenuItem disabled={coreDisabled} onSelect={() => selectSession("personal", true)}>Play independently here</DropdownMenuItem>}
        {selectSession && sessionMode === "personal" && <DropdownMenuItem disabled={coreDisabled} onSelect={() => selectSession("household")}>Control household</DropdownMenuItem>}
        {targets.filter(target => target.connected && target.occupied).map(target => target.kind === "group" && target.sessionKind === "household"
          ? selectSession && <DropdownMenuItem key={`join:${target.id}`} disabled={coreDisabled} onSelect={() => selectSession("household")}>Join {target.name}</DropdownMenuItem>
          : <DropdownMenuItem key={`takeover:${target.id}`} disabled={coreDisabled} onSelect={() => void run({ type: "selectTarget", targetId: target.id, takeover: true })}>Take over {target.name}</DropdownMenuItem>)}
        {targets.filter(target => target.kind === "group" && !target.occupied && target.backend === "sendspin").map(target => <DropdownMenuItem key={`manage:${target.id}`} disabled={coreDisabled} onSelect={() => setGroupId(target.id)}>Manage {target.name}</DropdownMenuItem>)}
        {sendspin && <DropdownMenuItem onSelect={() => setSendspinOpen(true)}>{sendspin.phase === "idle" ? "Join Sendspin server…" : "Sendspin playback"}</DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu>
    {group && <PlaybackGroupControls key={group.id} target={group} connected={connected} busy={!!state?.handoff} run={run} onClose={() => setGroupId(null)} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />}
    {sendspin && <SendspinClientDialog open={sendspinOpen} onOpenChange={setSendspinOpen} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} />}
    {!nativeHost && here && state?.player.requiresGesture && <Button disabled={coreDisabled} onClick={playHere}>Play here</Button>}
  </>;
}
